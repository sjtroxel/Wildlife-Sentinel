/**
 * Species Context Agent — generates a SpeciesBrief for each at-risk species.
 *
 * Phase 6: RAG-grounded using species_facts pgvector index.
 * IUCN status is always sourced from the database, not the LLM.
 * Agent may only cite facts from retrieved context — no training data fill-ins.
 */
import { MODELS } from '@wildlife-sentinel/shared/models';
import type { EnrichedDisasterEvent, SpeciesBrief, IUCNStatus, EventType } from '@wildlife-sentinel/shared/types';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';
import { modelRouter } from '../router/ModelRouter.js';
import { storeSpeciesResult } from '../pipeline/ThreatAssembler.js';
import { retrieveSpeciesFacts } from '../rag/retrieve.js';
import { logToWarRoom } from '../discord/warRoom.js';

const BASE_SYSTEM_PROMPT =
  'You are a wildlife conservation assistant. Provide a factual summary for the given species. ' +
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

export async function startSpeciesContextAgent(): Promise<void> {
  await ensureConsumerGroup(STREAMS.ENRICHED, CONSUMER_GROUPS.SPECIES);
  console.log('[species-context] Consumer group ready. Waiting for enriched events...');

  while (true) {
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.SPECIES, 'species-worker-1',
      'COUNT', '10', 'BLOCK', '5000',
      'STREAMS', STREAMS.ENRICHED, '>'
    ) as [string, [string, string[]][]][] | null;

    if (!messages) continue;

    for (const [, entries] of messages) {
      for (const [messageId, fields] of entries) {
        const event = JSON.parse(fields[1] ?? '{}') as EnrichedDisasterEvent;

        try {
          await processSpeciesEvent(event);
          await redis.xack(STREAMS.ENRICHED, CONSUMER_GROUPS.SPECIES, messageId);
        } catch (err) {
          console.error('[species-context] Error processing event:', err);
          await redis.xack(STREAMS.ENRICHED, CONSUMER_GROUPS.SPECIES, messageId);
          await logPipelineEvent({
            event_id: event.id,
            source: event.source,
            stage: 'species',
            status: 'error',
            reason: String(err),
          });
        }
      }
    }
  }
}

async function processSpeciesEvent(event: EnrichedDisasterEvent): Promise<void> {
  const briefs: SpeciesBrief[] = [];

  for (const speciesName of event.species_at_risk) {
    const brief = await generateSpeciesBrief(speciesName, event.event_type);
    briefs.push(brief);
  }

  await storeSpeciesResult(event.id, { species_briefs: briefs });

  await logToWarRoom({
    agent: 'species-context',
    action: 'briefs',
    detail: `${briefs.length} species briefed | ${event.species_at_risk.slice(0, 2).join(', ')}${event.species_at_risk.length > 2 ? ` +${event.species_at_risk.length - 2} more` : ''}`,
  });

  await logPipelineEvent({
    event_id: event.id,
    source: event.source,
    stage: 'species',
    status: 'published',
    reason: `${briefs.length} species briefs generated`,
  });

  console.log(
    `[species-context] ${event.id} | briefs: ${briefs.length} | stored for assembly`
  );
}

async function generateSpeciesBrief(speciesName: string, eventType: EventType): Promise<SpeciesBrief> {
  // IUCN status from DB — authoritative source, never from the LLM
  const rows = await sql<{ iucn_status: string }[]>`
    SELECT iucn_status FROM species_ranges WHERE species_name = ${speciesName} LIMIT 1
  `;
  const rawStatus = rows[0]?.iucn_status ?? 'LC';
  const iucnStatus: IUCNStatus = VALID_IUCN_STATUSES.has(rawStatus)
    ? (rawStatus as IUCNStatus)
    : 'LC';

  // RAG retrieval — ground the agent in real IUCN assessments
  const ragChunks = await retrieveSpeciesFacts(speciesName, `threatened by ${eventType}`);
  const sourceDocuments = [...new Set(ragChunks.map(c => c.source_document))];

  let systemPrompt: string;
  if (ragChunks.length > 0) {
    const ragContext = ragChunks
      .map(c => `[${c.source_document} — ${c.section_type}]\n${c.content}`)
      .join('\n\n');
    systemPrompt =
      BASE_SYSTEM_PROMPT +
      '\n\nRetrieved species context from IUCN Red List (similarity > 0.40):\n\n' +
      ragContext +
      '\n\nYou may ONLY state facts that appear in the above retrieved context. ' +
      'For each factual claim, it must be supported by the retrieved text. ' +
      'If a retrieved document does not address a field, say "data not available". ' +
      'Do not use your training data to fill gaps about species biology.';
  } else {
    systemPrompt =
      BASE_SYSTEM_PROMPT +
      '\n\nNo RAG context was retrieved for this species (index may be empty or below threshold). ' +
      'Use your training knowledge but set confidence_note to "based on training data only — no IUCN documents retrieved".';
  }

  try {
    const result = await modelRouter.complete({
      model: MODELS.GEMINI_FLASH,
      systemPrompt,
      userMessage: `Species: ${speciesName} (IUCN status: ${iucnStatus}, threatened by: ${eventType})`,
      maxTokens: 2048,
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
      source_documents: sourceDocuments,
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
