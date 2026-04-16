/**
 * Threat Assessment Agent — the primary intelligence layer.
 *
 * Consumes fully-enriched events from alerts:assessed (published by ThreatAssembler).
 * Uses Claude Sonnet 4.6 to assess threat level and predict impact.
 * Confidence is computed from observable fields only — never self-reported by the LLM.
 * Publishes AssessedAlert back to alerts:assessed for the Synthesis Agent to consume.
 */
import { MODELS } from '@wildlife-sentinel/shared/models';
import type { FullyEnrichedEvent, AssessedAlert, ThreatLevel, DisasterSource } from '@wildlife-sentinel/shared/types';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';
import { modelRouter } from '../router/ModelRouter.js';
import { getAgentPrompt } from '../db/agentPrompts.js';
import { logToWarRoom } from '../discord/warRoom.js';
import { getNextThursday } from '../refiner/geoUtils.js';

const VALID_THREAT_LEVELS = new Set<string>(['low', 'medium', 'high', 'critical']);

interface ClaudeThreatResponse {
  threat_level: ThreatLevel;
  predicted_impact: string;
  compounding_factors: string[];
  recommended_action: string;
  reasoning: string;
}

// Source quality scores — government APIs are authoritative, coarser data sources lower
const SOURCE_QUALITY: Record<DisasterSource, number> = {
  nasa_firms: 0.95,
  noaa_nhc: 0.90,
  gdacs: 0.88,
  gdacs_flood: 0.88,
  gdacs_drought: 0.88,
  usgs_nwis: 0.85,
  usgs_earthquake:   0.95,  // USGS EHP — seismograph network, very high quality
  gdacs_volcano:     0.88,  // GDACS VO — volcano observatory network, Orange/Red only
  coral_reef_watch:  0.85,
  drought_monitor:   0.75,
  glad_deforestation: 0.88, // GFW Integrated Alerts — Landsat/Sentinel-2/RADD fusion, high confidence filter
  nsidc_sea_ice:      0.92, // NSIDC NRT Sea Ice Index — satellite passive microwave, highly reliable
  noaa_cpc:           0.95, // NOAA CPC ONI — authoritative ENSO index, monthly scientific consensus
  gfw_fishing:        0.85, // Global Fishing Watch — AIS vessel tracking, high confidence in vessel detection
};

/**
 * Compute confidence from observable data fields — never from LLM self-report.
 * Formula: 0.4 * dataCompleteness + 0.35 * sourceQuality + 0.25 * habitatCertainty
 */
function computeConfidence(event: FullyEnrichedEvent): number {
  const dataCompleteness = [
    event.wind_speed !== null,
    event.wind_direction !== null,
    event.gbif_recent_sightings.length > 0,
    event.species_briefs.length > 0,
    event.habitat_distance_km < 75,
  ].filter(Boolean).length / 5;

  const sourceQuality = SOURCE_QUALITY[event.source] ?? 0.75;

  const habitatCertainty =
    event.habitat_distance_km < 10 ? 1.0
    : event.habitat_distance_km < 25 ? 0.85
    : event.habitat_distance_km < 50 ? 0.65
    : 0.45;

  return parseFloat(
    (0.4 * dataCompleteness + 0.35 * sourceQuality + 0.25 * habitatCertainty).toFixed(3)
  );
}

function buildUserMessage(event: FullyEnrichedEvent): string {
  const stormTrack = event.raw_data['movement_dir_deg'] !== undefined
    ? `Storm track: ${String(event.raw_data['movement_dir_deg'])}° at ${String(event.raw_data['movement_speed_knots'])} knots`
    : '';

  const speciesBriefLines = event.species_briefs
    .map(b => `- ${b.species_name} (${b.iucn_status}): ${b.habitat_description}`)
    .join('\n');

  return [
    `Disaster event requiring threat assessment:`,
    ``,
    `Type: ${event.event_type} | Source: ${event.source}`,
    `Location: ${event.coordinates.lat}, ${event.coordinates.lng}`,
    `Severity: ${(event.severity * 100).toFixed(0)}%`,
    `Timestamp: ${event.timestamp}`,
    ``,
    `Nearest habitat: ${event.habitat_distance_km.toFixed(1)}km`,
    `At-risk species: ${event.species_at_risk.join(', ')}`,
    `Weather: ${event.weather_summary}`,
    ``,
    `GBIF sightings: ${event.sighting_confidence} | Most recent: ${event.most_recent_sighting ?? 'none on record'}`,
    `Sighting count (last 2yr): ${event.gbif_recent_sightings.length}`,
    ``,
    `Species briefs:`,
    speciesBriefLines,
    stormTrack,
  ].filter(line => line !== '').join('\n');
}

export async function startThreatAssessmentAgent(): Promise<void> {
  await ensureConsumerGroup(STREAMS.ASSESSED, CONSUMER_GROUPS.THREAT);
  console.log('[threat-assess] Consumer group ready. Waiting for assembled events...');

  while (true) {
    if (await redis.get('pipeline:paused')) { await new Promise(r => setTimeout(r, 5_000)); continue; }
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.THREAT, 'threat-worker-1',
      'COUNT', '5', 'BLOCK', '5000',
      'STREAMS', STREAMS.ASSESSED, '>'
    ) as [string, [string, string[]][]][] | null;

    if (!messages) continue;

    for (const [, entries] of messages) {
      for (const [messageId, fields] of entries) {
        const data = JSON.parse(fields[1] ?? '{}') as Record<string, unknown>;

        // Skip messages that already have threat_level — those are AssessedAlerts
        // published by this agent, consumed by the synthesis-group on the same stream.
        if ('threat_level' in data) {
          await redis.xack(STREAMS.ASSESSED, CONSUMER_GROUPS.THREAT, messageId);
          continue;
        }

        const event = data as unknown as FullyEnrichedEvent;

        try {
          await processEvent(event);
          await redis.xack(STREAMS.ASSESSED, CONSUMER_GROUPS.THREAT, messageId);
        } catch (err) {
          console.error('[threat-assess] Error processing event:', err);
          await redis.xack(STREAMS.ASSESSED, CONSUMER_GROUPS.THREAT, messageId);
          await logPipelineEvent({
            event_id: event.id,
            source: event.source,
            stage: 'threat',
            status: 'error',
            reason: String(err),
          });
          // Surface failures to #sentinel-ops so they are visible — previously
          // errors were only written to pipeline_events DB, making them invisible.
          await logToWarRoom({
            agent: 'threat_assess',
            action: 'ERROR',
            detail: `${event.event_type} ${event.id} — ${String(err).slice(0, 120)}`,
            level: 'warning',
          });
        }
      }
    }
  }
}

export async function processEvent(event: FullyEnrichedEvent): Promise<void> {
  const systemPrompt = await getAgentPrompt('threat_assessment');
  const userMessage = buildUserMessage(event);

  const response = await modelRouter.complete({
    model: MODELS.CLAUDE_HAIKU,
    systemPrompt,
    userMessage,
    maxTokens: 1500,
    temperature: 0.2,
    jsonMode: true,
  });

  const parsed = JSON.parse(response.content) as ClaudeThreatResponse;

  // Validate threat_level — don't trust LLM output unconditionally
  const threatLevel: ThreatLevel = VALID_THREAT_LEVELS.has(parsed.threat_level)
    ? parsed.threat_level
    : 'medium';

  const confidence = computeConfidence(event);

  // Upsert alert record — store prediction + original raw_data for Refiner to compare against actuals later
  const alertRows = await sql<{ id: string }[]>`
    INSERT INTO alerts (raw_event_id, source, event_type, coordinates, severity, enrichment_data, threat_level, confidence_score, prediction_data, raw_data)
    VALUES (
      ${event.id},
      ${event.source},
      ${event.event_type},
      ${JSON.stringify(event.coordinates)},
      ${event.severity},
      ${JSON.stringify({
        weather: event.weather_summary,
        habitats: event.nearby_habitat_ids,
        species_at_risk: event.species_at_risk,
        habitat_distance_km: event.habitat_distance_km,
        species_status: event.species_briefs[0]?.iucn_status ?? null,
      })},
      ${threatLevel},
      ${confidence},
      ${JSON.stringify({
        predicted_impact: parsed.predicted_impact,
        reasoning: parsed.reasoning,
        compounding_factors: Array.isArray(parsed.compounding_factors) ? parsed.compounding_factors : [],
        recommended_action: parsed.recommended_action ?? null,
      })},
      ${JSON.stringify(event.raw_data)}
    )
    ON CONFLICT (raw_event_id) DO UPDATE SET
      threat_level     = EXCLUDED.threat_level,
      confidence_score = EXCLUDED.confidence_score,
      prediction_data  = EXCLUDED.prediction_data,
      raw_data         = EXCLUDED.raw_data
    RETURNING id
  `;
  const dbAlertId = alertRows[0]?.id ?? event.id;

  const assessed: AssessedAlert = {
    ...event,
    threat_level: threatLevel,
    predicted_impact: parsed.predicted_impact,
    compounding_factors: Array.isArray(parsed.compounding_factors) ? parsed.compounding_factors : [],
    recommended_action: parsed.recommended_action,
    confidence_score: confidence,
    prediction_timestamp: new Date().toISOString(),
    sources: [event.source, 'open_meteo', 'gbif', 'iucn_postgis'],
    db_alert_id: dbAlertId,
  };

  // Queue Refiner evaluations — drought uses weekly cadence (Drought Monitor is Thursday-only)
  if (event.event_type === 'drought') {
    await sql`
      INSERT INTO refiner_queue (alert_id, evaluation_time, run_at)
      SELECT id, 'weekly', ${getNextThursday()} FROM alerts WHERE raw_event_id = ${event.id}
    `;
  } else {
    await sql`
      INSERT INTO refiner_queue (alert_id, evaluation_time, run_at)
      SELECT id, '24h', NOW() + INTERVAL '24 hours' FROM alerts WHERE raw_event_id = ${event.id}
    `;
    await sql`
      INSERT INTO refiner_queue (alert_id, evaluation_time, run_at)
      SELECT id, '48h', NOW() + INTERVAL '48 hours' FROM alerts WHERE raw_event_id = ${event.id}
    `;
  }

  // Publish AssessedAlert to alerts:assessed for Synthesis Agent
  await redis.xadd(STREAMS.ASSESSED, '*', 'data', JSON.stringify(assessed));

  await logPipelineEvent({
    event_id: event.id,
    source: event.source,
    stage: 'threat',
    status: 'published',
    reason: `threat_level: ${threatLevel} | confidence: ${confidence}`,
  });

  await logToWarRoom({
    agent: 'threat_assess',
    action: `THREAT: ${threatLevel.toUpperCase()}`,
    detail: `confidence=${confidence} | ${event.species_at_risk[0] ?? 'unknown'} @ ${event.habitat_distance_km.toFixed(1)}km`,
    level: threatLevel === 'critical' ? 'alert' : threatLevel === 'high' ? 'warning' : 'info',
  });

  console.log(
    `[threat-assess] ${event.id} | threat: ${threatLevel} | confidence: ${confidence} | published`
  );
}
