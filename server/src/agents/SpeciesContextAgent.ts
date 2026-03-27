/**
 * Species Context Agent — generates a SpeciesBrief for each at-risk species.
 *
 * Uses model training data only (no RAG — Phase 6 adds that).
 * Called directly by HabitatAgent (no consumer loop — Phase 5 adds that).
 *
 * IUCN status is always sourced from the database, not the LLM.
 */
import { MODELS } from '@wildlife-sentinel/shared/models';
import type { FullyEnrichedEvent, SpeciesBrief, IUCNStatus } from '@wildlife-sentinel/shared/types';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';
import { STREAMS } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';
import { modelRouter } from '../router/ModelRouter.js';

const SYSTEM_PROMPT =
  'You are a wildlife conservation assistant. Provide a brief factual summary for the given species. ' +
  'Note: this summary is based on your training data only — no external documents have been retrieved. ' +
  'Respond in JSON with exactly these fields: ' +
  '{ "common_name": string, "population_estimate": string or null, ' +
  '"primary_threats": string[], "habitat_description": string, "confidence_note": string }';

const VALID_IUCN_STATUSES: ReadonlySet<string> = new Set(['EX', 'EW', 'CR', 'EN', 'VU', 'NT', 'LC']);

interface GeminiSpeciesResponse {
  common_name: string;
  population_estimate: string | null;
  primary_threats: string[];
  habitat_description: string;
  confidence_note: string;
}

// TODO Phase 5: add consumer loop — this becomes an independent Redis consumer of disaster:enriched
export async function runSpeciesContextAgent(event: FullyEnrichedEvent): Promise<void> {
  const briefs: SpeciesBrief[] = [];

  for (const speciesName of event.species_at_risk) {
    const brief = await generateSpeciesBrief(speciesName);
    briefs.push(brief);
  }

  const assembled: FullyEnrichedEvent = { ...event, species_briefs: briefs };

  await redis.xadd(STREAMS.DISCORD, '*', 'data', JSON.stringify(assembled));

  await logPipelineEvent({
    event_id: event.id,
    source: event.source,
    stage: 'species',
    status: 'published',
    reason: `${briefs.length} species briefs generated`,
  });

  console.log(
    `[species-context] ${event.id} | briefs: ${briefs.length} | published to discord:queue`
  );
}

async function generateSpeciesBrief(speciesName: string): Promise<SpeciesBrief> {
  // IUCN status from DB — authoritative source, never from the LLM
  const rows = await sql<{ iucn_status: string }[]>`
    SELECT iucn_status FROM species_ranges WHERE species_name = ${speciesName} LIMIT 1
  `;
  const rawStatus = rows[0]?.iucn_status ?? 'LC';
  const iucnStatus: IUCNStatus = VALID_IUCN_STATUSES.has(rawStatus)
    ? (rawStatus as IUCNStatus)
    : 'LC';

  try {
    const result = await modelRouter.complete({
      model: MODELS.GEMINI_FLASH,
      systemPrompt: SYSTEM_PROMPT,
      userMessage: `Species: ${speciesName} (IUCN status: ${iucnStatus})`,
      maxTokens: 512,
      jsonMode: true,
    });

    const parsed = JSON.parse(result.content) as GeminiSpeciesResponse;

    return {
      species_name: speciesName,
      common_name: parsed.common_name,
      iucn_status: iucnStatus,
      population_estimate: parsed.population_estimate ?? null,
      primary_threats: Array.isArray(parsed.primary_threats) ? parsed.primary_threats : [],
      habitat_description: parsed.habitat_description,
      source_documents: [], // Phase 6: RAG retrieval populates this
    };
  } catch (err) {
    console.warn(`[species-context] Failed to generate brief for ${speciesName}:`, err);
    return {
      species_name: speciesName,
      common_name: speciesName,
      iucn_status: iucnStatus,
      population_estimate: null,
      primary_threats: [],
      habitat_description: 'Species information unavailable.',
      source_documents: [],
    };
  }
}
