/**
 * RAG retrieval functions for species facts and conservation context.
 *
 * Both functions use modelRouter.embed() — no direct AI SDK imports here.
 * Similarity threshold: 0.40 (below this, results are not meaningfully related).
 */
import type { SpeciesFactChunk, ConservationContextChunk } from '@wildlife-sentinel/shared/types';
import { modelRouter } from '../router/ModelRouter.js';
import { sql } from '../db/client.js';

const SIMILARITY_THRESHOLD = 0.40;

/**
 * Retrieve species fact chunks relevant to a query context.
 * Returns up to topK chunks above the similarity threshold, ordered by relevance.
 * Returns [] if the species_facts table is empty or no results meet the threshold.
 */
export async function retrieveSpeciesFacts(
  speciesName: string,
  queryContext: string,
  topK = 5
): Promise<SpeciesFactChunk[]> {
  const queryText = `${speciesName} ecology threats habitat: ${queryContext}`;
  const embeddings = await modelRouter.embed(queryText);
  const embedding = embeddings[0];
  if (!embedding) return [];

  return sql<SpeciesFactChunk[]>`
    SELECT id::text, content, section_type, source_document,
           (1 - (embedding <=> ${JSON.stringify(embedding)}::vector))::float AS similarity
    FROM species_facts
    WHERE species_name = ${speciesName}
      AND (1 - (embedding <=> ${JSON.stringify(embedding)}::vector)) > ${SIMILARITY_THRESHOLD}
    ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
    LIMIT ${topK}
  `;
}

/**
 * Retrieve conservation context chunks relevant to a query.
 * Used by SynthesisAgent for the "why this matters" framing sentence.
 */
export async function retrieveConservationContext(
  queryContext: string,
  topK = 3
): Promise<ConservationContextChunk[]> {
  const embeddings = await modelRouter.embed(queryContext);
  const embedding = embeddings[0];
  if (!embedding) return [];

  return sql<ConservationContextChunk[]>`
    SELECT id::text, content, document_title, source_document,
           (1 - (embedding <=> ${JSON.stringify(embedding)}::vector))::float AS similarity
    FROM conservation_context
    WHERE (1 - (embedding <=> ${JSON.stringify(embedding)}::vector)) > ${SIMILARITY_THRESHOLD}
    ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
    LIMIT ${topK}
  `;
}
