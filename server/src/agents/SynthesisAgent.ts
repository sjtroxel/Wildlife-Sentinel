/**
 * Synthesis Agent — generates the public-facing Discord embed.
 *
 * Consumes AssessedAlerts from alerts:assessed.
 * Drops 'low' threat level events (no Discord post).
 * Routes 'critical' alerts to #sentinel-ops for HITL review.
 * Auto-posts 'medium' and 'high' directly to #wildlife-alerts.
 */
import { EmbedBuilder } from 'discord.js';
import { MODELS } from '@wildlife-sentinel/shared/models';
import type { AssessedAlert, ThreatLevel, DiscordQueueItem } from '@wildlife-sentinel/shared/types';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';
import { modelRouter } from '../router/ModelRouter.js';
import { getAgentPrompt } from '../db/agentPrompts.js';
import { logToWarRoom } from '../discord/warRoom.js';
import { retrieveConservationContext } from '../rag/retrieve.js';
import { config } from '../config.js';

const THREAT_COLORS: Record<ThreatLevel, number> = {
  critical: 0xdc2626,  // red
  high:     0xea580c,  // orange
  medium:   0xd97706,  // amber
  low:      0x6b7280,  // gray — never posted, included for completeness
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  wildfire:        'Wildfire',
  tropical_storm:  'Tropical Storm',
  flood:           'Flood',
  drought:         'Drought',
  coral_bleaching: 'Coral Bleaching',
};

const SOURCE_LABELS: Record<string, string> = {
  nasa_firms:       'NASA FIRMS',
  noaa_nhc:         'NOAA NHC',
  usgs_nwis:        'USGS NWIS',
  drought_monitor:  'US Drought Monitor',
  coral_reef_watch: 'NOAA Coral Reef Watch',
};

interface ClaudeSynthesisResponse {
  title: string;
  narrative: string;
  footer_note: string;
}

export async function startSynthesisAgent(): Promise<void> {
  await ensureConsumerGroup(STREAMS.ASSESSED, CONSUMER_GROUPS.SYNTHESIS);
  console.log('[synthesis] Consumer group ready. Waiting for assessed alerts...');

  while (true) {
    if (await redis.get('pipeline:paused')) { await new Promise(r => setTimeout(r, 5_000)); continue; }
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.SYNTHESIS, 'synthesis-worker-1',
      'COUNT', '5', 'BLOCK', '5000',
      'STREAMS', STREAMS.ASSESSED, '>'
    ) as [string, [string, string[]][]][] | null;

    if (!messages) continue;

    for (const [, entries] of messages) {
      for (const [messageId, fields] of entries) {
        const data = JSON.parse(fields[1] ?? '{}') as Record<string, unknown>;

        // Skip messages without threat_level — those are FullyEnrichedEvents
        // published by ThreatAssembler, not yet assessed.
        if (!('threat_level' in data)) {
          await redis.xack(STREAMS.ASSESSED, CONSUMER_GROUPS.SYNTHESIS, messageId);
          continue;
        }

        const assessed = data as unknown as AssessedAlert;

        try {
          await processAlert(assessed);
          await redis.xack(STREAMS.ASSESSED, CONSUMER_GROUPS.SYNTHESIS, messageId);
        } catch (err) {
          console.error('[synthesis] Error processing alert:', err);
          await redis.xack(STREAMS.ASSESSED, CONSUMER_GROUPS.SYNTHESIS, messageId);
          await logPipelineEvent({
            event_id: assessed.id,
            source: assessed.source,
            stage: 'synthesis',
            status: 'error',
            reason: String(err),
          });
        }
      }
    }
  }
}

export async function processAlert(assessed: AssessedAlert): Promise<void> {
  // Drop low-threat events — never post to Discord
  if (assessed.threat_level === 'low') {
    await logPipelineEvent({
      event_id: assessed.id,
      source: assessed.source,
      stage: 'synthesis',
      status: 'filtered',
      reason: 'threat_level_low',
    });
    console.log(`[synthesis] ${assessed.id} | dropped (low threat)`);
    return;
  }

  let systemPrompt = await getAgentPrompt('synthesis');

  // RAG retrieval — conservation context for "why this matters" framing
  const conservationCtx = await retrieveConservationContext(
    `${assessed.event_type} impact on ${assessed.species_at_risk[0] ?? 'endangered species'} conservation`
  );
  if (conservationCtx.length > 0 && conservationCtx[0]) {
    systemPrompt +=
      '\n\nConservation context (use for the "why this matters" sentence — cite the source):\n' +
      conservationCtx[0].content +
      `\nSource: ${conservationCtx[0].source_document}`;
  }

  const speciesBriefLines = assessed.species_briefs
    .slice(0, 3)
    .map(b => `${b.species_name} (${b.iucn_status}${b.population_estimate ? `, pop ~${b.population_estimate}` : ''}): ${b.habitat_description}`)
    .join('\n');

  const userMessage = [
    `Disaster: ${assessed.event_type} | Source: ${SOURCE_LABELS[assessed.source] ?? assessed.source}`,
    `Severity: ${(assessed.severity * 100).toFixed(0)}% | Threat level: ${assessed.threat_level}`,
    `Location: ${assessed.coordinates.lat.toFixed(2)}, ${assessed.coordinates.lng.toFixed(2)}`,
    `Distance to habitat: ${assessed.habitat_distance_km.toFixed(1)}km`,
    ``,
    `At-risk species: ${assessed.species_at_risk.slice(0, 3).join(', ')}`,
    `Species details:`,
    speciesBriefLines,
    ``,
    `Predicted impact: ${assessed.predicted_impact}`,
    `Compounding factors: ${assessed.compounding_factors.join('; ')}`,
    `Weather: ${assessed.weather_summary}`,
    `GBIF sightings: ${assessed.sighting_confidence} (most recent: ${assessed.most_recent_sighting ?? 'unknown'})`,
  ].join('\n');

  const response = await modelRouter.complete({
    model: MODELS.CLAUDE_HAIKU,
    systemPrompt,
    userMessage,
    maxTokens: 300,
    temperature: 0.4,
    jsonMode: true,
  });

  const synthesis = JSON.parse(response.content) as ClaudeSynthesisResponse;

  const embed = new EmbedBuilder()
    .setColor(THREAT_COLORS[assessed.threat_level])
    .setTitle(synthesis.title)
    .setDescription(synthesis.narrative)
    .addFields(
      { name: 'Disaster Type', value: EVENT_TYPE_LABELS[assessed.event_type] ?? assessed.event_type, inline: true },
      { name: 'Distance to Habitat', value: `${assessed.habitat_distance_km.toFixed(1)} km`, inline: true },
      { name: 'Threat Level', value: assessed.threat_level.toUpperCase(), inline: true },
      { name: 'Species at Risk', value: assessed.species_at_risk.slice(0, 3).join(', ') || 'Unknown', inline: false },
      { name: 'IUCN Status', value: assessed.species_briefs[0]?.iucn_status ?? 'Unknown', inline: true },
      { name: 'Confidence', value: `${(assessed.confidence_score * 100).toFixed(0)}%`, inline: true },
    )
    .setFooter({ text: `Wildlife Sentinel • Data: ${SOURCE_LABELS[assessed.source] ?? assessed.source} • ${synthesis.footer_note}` })
    .setTimestamp();

  if (config.frontendUrl) {
    embed.setURL(`${config.frontendUrl}/alerts/${assessed.db_alert_id}`);
  }

  const channel: DiscordQueueItem['channel'] =
    assessed.threat_level === 'critical' || assessed.threat_level === 'high'
      ? 'sentinel-ops-review'
      : 'wildlife-alerts';

  const queueItem: DiscordQueueItem = {
    alert_id: assessed.id,
    channel,
    embed: embed.toJSON() as Record<string, unknown>,
    threat_level: assessed.threat_level,
    stored_alert_id: assessed.db_alert_id,
  };

  await redis.xadd(STREAMS.DISCORD, '*', 'data', JSON.stringify(queueItem));

  await logPipelineEvent({
    event_id: assessed.id,
    source: assessed.source,
    stage: 'synthesis',
    status: 'published',
    reason: `routing to: ${channel}`,
  });

  await logToWarRoom({
    agent: 'synthesis',
    action: 'Generating embed',
    detail: `routing to #${channel === 'sentinel-ops-review' ? 'sentinel-ops' : channel} | threat: ${assessed.threat_level}`,
    level: assessed.threat_level === 'critical' ? 'alert' : 'info',
  });

  console.log(`[synthesis] ${assessed.id} | embed generated | channel: ${channel}`);
}
