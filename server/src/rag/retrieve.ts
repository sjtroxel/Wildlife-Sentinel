/**
 * RAG retrieval functions for species facts and conservation context.
 *
 * Both functions use modelRouter.embed() — no direct AI SDK imports here.
 * Similarity threshold: 0.40 (below this, results are not meaningfully related).
 *
 * Embeddings are cached in Redis for 24h — the same query string (e.g. "Panthera tigris
 * ecology threats habitat: wildfire") appears repeatedly across a fire cluster and would
 * otherwise burn the Google embedding free-tier quota fast.
 */
import type { SpeciesFactChunk, ConservationContextChunk } from '@wildlife-sentinel/shared/types';
import { modelRouter } from '../router/ModelRouter.js';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';

const SIMILARITY_THRESHOLD = 0.40;
const EMBED_CACHE_TTL_SECONDS = 86_400; // 24h — embeddings don't change

function embedCacheKey(query: string): string {
  return `embed:${Buffer.from(query).toString('base64').slice(0, 64)}`;
}

async function getCachedEmbedding(query: string): Promise<number[] | null> {
  const cached = await redis.get(embedCacheKey(query));
  return cached ? (JSON.parse(cached) as number[]) : null;
}

async function setCachedEmbedding(query: string, vector: number[]): Promise<void> {
  await redis.setex(embedCacheKey(query), EMBED_CACHE_TTL_SECONDS, JSON.stringify(vector));
}

async function getEmbedding(query: string): Promise<number[] | null> {
  const cached = await getCachedEmbedding(query);
  if (cached) return cached;

  const embeddings = await modelRouter.embed(query);
  const vector = embeddings[0];
  if (!vector) return null;

  await setCachedEmbedding(query, vector);
  return vector;
}

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
  const embedding = await getEmbedding(queryText);
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
  const embedding = await getEmbedding(queryContext);
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
