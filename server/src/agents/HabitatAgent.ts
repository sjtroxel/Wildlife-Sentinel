/**
 * Habitat Agent — cross-references disaster events against GBIF occurrence data.
 *
 * Confidence is computed from sighting count — never self-reported by the LLM.
 * TODO Phase 5: calls SpeciesContextAgent directly (sequential).
 *              Phase 5 refactors this into parallel Redis consumers.
 */
import { MODELS } from '@wildlife-sentinel/shared/models';
import type { EnrichedDisasterEvent, GBIFSighting } from '@wildlife-sentinel/shared/types';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';
import { fetchRecentSightings } from '../scouts/gbif.js';
import { modelRouter } from '../router/ModelRouter.js';
import { storeHabitatResult } from '../pipeline/ThreatAssembler.js';
import { logToWarRoom } from '../discord/warRoom.js';

const SLEEP_MS = 100; // polite delay between GBIF calls
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface GBIFAnalysis {
  sighting_confidence: 'confirmed' | 'possible' | 'historical_only';
  most_recent_sighting: string | null;
  summary: string;
}

const VALID_CONFIDENCES = new Set(['confirmed', 'possible', 'historical_only']);

export async function startHabitatAgent(): Promise<void> {
  await ensureConsumerGroup(STREAMS.ENRICHED, CONSUMER_GROUPS.HABITAT);
  console.log('[habitat] Consumer group ready. Waiting for enriched events...');

  while (true) {
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.HABITAT, 'habitat-worker-1',
      'COUNT', '10', 'BLOCK', '5000',
      'STREAMS', STREAMS.ENRICHED, '>'
    ) as [string, [string, string[]][]][] | null;

    if (!messages) continue;

    for (const [, entries] of messages) {
      for (const [messageId, fields] of entries) {
        const event = JSON.parse(fields[1] ?? '{}') as EnrichedDisasterEvent;

        try {
          await processEvent(event);
          // ACK only after the full chain (habitat + species context) completes
          await redis.xack(STREAMS.ENRICHED, CONSUMER_GROUPS.HABITAT, messageId);
        } catch (err) {
          console.error('[habitat] Error processing event:', err);
          await redis.xack(STREAMS.ENRICHED, CONSUMER_GROUPS.HABITAT, messageId);
          await logPipelineEvent({
            event_id: event.id,
            source: event.source,
            stage: 'habitat',
            status: 'error',
            reason: String(err),
          });
          await logToWarRoom({
            agent: 'habitat',
            action: 'ERROR',
            detail: `${event.id} — ${String(err).slice(0, 120)}`,
            level: 'warning',
          });
        }
      }
    }
  }
}

async function processEvent(event: EnrichedDisasterEvent): Promise<void> {
  // Skip backlog events whose assembly hash doesn't exist.
  // The EnrichmentAgent stores assembly:{id} BEFORE publishing to disaster:enriched.
  // If the hash is absent, this is an old message published before that logic was added —
  // processing it would create a partial hash (habitat-only) that tricks species-context
  // into processing the same stale event, leaving the assembly permanently without 'event'.
  const assemblyExists = await redis.exists(`assembly:${event.id}`);
  if (!assemblyExists) {
    console.log(`[habitat] Skipping ${event.id} — no assembly hash (backlog event)`);
    return;
  }

  const { lat, lng } = event.coordinates;

  // Collect GBIF sightings for all at-risk species
  const allSightings: GBIFSighting[] = [];
  for (const speciesName of event.species_at_risk) {
    const sightings = await fetchRecentSightings(lat, lng, speciesName);
    allSightings.push(...sightings);
    await sleep(SLEEP_MS);
  }

  // Confidence computed from sighting count — deterministic, no self-report
  const sightingCount = allSightings.length;
  const computedConfidence = sightingCount > 0
    ? Math.min(0.3 + sightingCount * 0.1, 0.9)
    : 0.2;

  // LLM classifies what the sightings mean
  const analysis = await analyzeGBIFSightings(event.species_at_risk, allSightings);

  await logPipelineEvent({
    event_id: event.id,
    source: event.source,
    stage: 'habitat',
    status: 'published',
    reason: `sightings: ${sightingCount} | computed_confidence: ${computedConfidence.toFixed(2)} | classification: ${analysis.sighting_confidence}`,
  });

  console.log(
    `[habitat] ${event.id} | sightings: ${sightingCount} | ` +
    `confidence: ${analysis.sighting_confidence} | most_recent: ${analysis.most_recent_sighting ?? 'none'}`
  );

  if (sightingCount > 0) {
    await logToWarRoom({
      agent: 'habitat',
      action: 'GBIF',
      detail: `${sightingCount} sightings | confidence: ${analysis.sighting_confidence} | most_recent: ${analysis.most_recent_sighting ?? 'none'}`,
    });
  }

  await storeHabitatResult(event.id, {
    gbif_recent_sightings: allSightings,
    sighting_confidence: analysis.sighting_confidence,
    most_recent_sighting: analysis.most_recent_sighting,
  });
}

async function analyzeGBIFSightings(
  speciesNames: string[],
  sightings: GBIFSighting[]
): Promise<GBIFAnalysis> {
  const speciesList = speciesNames.join(', ');

  const sightingLines = sightings.length > 0
    ? sightings
        .map(s => `- ${s.speciesName} at ${s.decimalLatitude},${s.decimalLongitude} on ${s.eventDate} (${s.datasetName})`)
        .join('\n')
    : 'No recent GBIF sightings found within 50km of the disaster location.';

  const userMessage =
    `Species at risk: ${speciesList}\n\n` +
    `GBIF sightings (${sightings.length} total within 50km, last 2 years):\n${sightingLines}`;

  try {
    const result = await modelRouter.complete({
      model: MODELS.GEMINI_FLASH_LITE,
      systemPrompt:
        'Classify the confidence that the listed species are recently active near the disaster location. ' +
        'Respond in JSON with exactly these fields: ' +
        '{ "sighting_confidence": "confirmed" | "possible" | "historical_only", ' +
        '"most_recent_sighting": "ISO date string or null if none", ' +
        '"summary": "1-2 sentence summary of sighting data" }',
      userMessage,
      maxTokens: 256,
      jsonMode: true,
    });

    const parsed = JSON.parse(result.content) as GBIFAnalysis;

    // Validate the confidence value — don't trust LLM output unconditionally
    if (!VALID_CONFIDENCES.has(parsed.sighting_confidence)) {
      parsed.sighting_confidence = sightings.length > 0 ? 'possible' : 'historical_only';
    }

    return parsed;
  } catch (err) {
    console.warn('[habitat] GBIF analysis failed, using fallback classification:', err);
    return {
      sighting_confidence: sightings.length > 0 ? 'possible' : 'historical_only',
      most_recent_sighting: sightings[0]?.eventDate ?? null,
      summary: `${sightings.length} GBIF sightings found for at-risk species near this location.`,
    };
  }
}
