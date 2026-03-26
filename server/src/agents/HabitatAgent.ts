/**
 * Habitat Agent — cross-references disaster events against GBIF occurrence data.
 *
 * Phase 2: uses Gemini 2.5 Flash-Lite directly (no ModelRouter — Phase 3 adds that).
 * Phase 2: calls SpeciesContextAgent directly after processing (sequential).
 *          Phase 5 refactors this into parallel Redis consumers.
 *
 * Confidence is computed from sighting count — never self-reported by the LLM.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
// TODO Phase 3: import { modelRouter } from '../router/ModelRouter.js' and remove direct SDK use
import { MODELS } from '@wildlife-sentinel/shared/models';
import type { EnrichedDisasterEvent, FullyEnrichedEvent, GBIFSighting } from '@wildlife-sentinel/shared/types';
import { config } from '../config.js';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';
import { fetchRecentSightings } from '../scouts/gbif.js';
import { runSpeciesContextAgent } from './SpeciesContextAgent.js';

// TODO Phase 3: replace with ModelRouter call
const genai = new GoogleGenerativeAI(config.googleAiKey);
const geminiModel = genai.getGenerativeModel({
  model: MODELS.GEMINI_FLASH_LITE,
  generationConfig: { responseMimeType: 'application/json' },
});

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
        }
      }
    }
  }
}

async function processEvent(event: EnrichedDisasterEvent): Promise<void> {
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

  const fullyEnriched: FullyEnrichedEvent = {
    ...event,
    gbif_recent_sightings: allSightings,
    species_briefs: [],           // SpeciesContextAgent fills this
    sighting_confidence: analysis.sighting_confidence,
    most_recent_sighting: analysis.most_recent_sighting,
  };

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

  // TODO Phase 5: publish to intermediate stream; SpeciesContextAgent becomes an independent consumer
  await runSpeciesContextAgent(fullyEnriched);
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

  const prompt =
    `Species at risk: ${speciesList}\n\n` +
    `GBIF sightings (${sightings.length} total within 50km, last 2 years):\n${sightingLines}\n\n` +
    'Classify the confidence that these species are recently active in this area. ' +
    'Respond in JSON with exactly these fields: ' +
    '{ "sighting_confidence": "confirmed" | "possible" | "historical_only", ' +
    '"most_recent_sighting": "ISO date string or null if none", ' +
    '"summary": "1-2 sentence summary of sighting data" }';

  try {
    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const parsed = JSON.parse(result.response.text()) as GBIFAnalysis;

    // Validate the confidence value — don't trust LLM output unconditionally
    if (!VALID_CONFIDENCES.has(parsed.sighting_confidence)) {
      parsed.sighting_confidence = sightings.length > 0 ? 'possible' : 'historical_only';
    }

    return parsed;
  } catch (err) {
    console.warn('[habitat] Gemini analysis failed, using fallback classification:', err);
    return {
      sighting_confidence: sightings.length > 0 ? 'possible' : 'historical_only',
      most_recent_sighting: sightings[0]?.eventDate ?? null,
      summary: `${sightings.length} GBIF sightings found for at-risk species near this location.`,
    };
  }
}
