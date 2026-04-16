# RAG Rules

## Two Indices (Never Collapse Into One)

| Index (table) | Content | Used By |
|---|---|---|
| `species_facts` | IUCN species assessments, WWF profiles, NMNH records | Species Context Agent |
| `conservation_context` | WWF Living Planet reports, IPBES assessments, conservation case studies | Synthesis Agent |

These two indices must never be merged into one. The Species Context Agent needs species-specific factual grounding. The Synthesis Agent needs broader conservation framing for the "why this matters" narrative. Mixing them would allow both agents to retrieve context that isn't relevant to their specific job.

## Embedding Model

**`gemini-embedding-001`** via `@google/generative-ai` SDK (constant: `MODELS.GOOGLE_EMBEDDINGS`).
- Dimensions: **1536** (using `outputDimensionality=1536` truncation — stays within pgvector ivfflat limit of 2000)
- DB column: `vector(1536)` — see migration 0007_vector_3072.sql
- Used at ingest time (document chunking) and query time (retrieval)

The same model MUST be used at both ingest and query time. The embedding space must be consistent.

```typescript
const embeddingModel = genai.getGenerativeModel({ model: MODELS.GOOGLE_EMBEDDINGS });
const result = await embeddingModel.embedContent(text);
const embedding: number[] = result.embedding.values; // 1536 dimensions (outputDimensionality truncation)
```

## Chunking Strategy

For species fact documents:
- Per-species documents, chunked by topic section (habitat, diet, threats, conservation status, population)
- Max chunk size: 512 tokens
- Overlap: 50 tokens
- Metadata: `{ species_name, iucn_id, section_type, source_document }`

For conservation context documents:
- Chunked by heading hierarchy (H1 → H2 → H3 structure preserved)
- Max chunk size: 512 tokens
- Overlap: 50 tokens
- Metadata: `{ document_title, section_heading, source_url, publication_year }`

## Retrieval Pattern

```typescript
async function retrieveSpeciesFacts(
  speciesName: string,
  queryContext: string,
  topK = 5
): Promise<SpeciesFactChunk[]> {
  const queryEmbedding = await modelRouter.embed(
    `Species ecology and threats: ${speciesName} — ${queryContext}`
  );

  const chunks = await sql`
    SELECT id, content, metadata,
           1 - (embedding <=> ${JSON.stringify(queryEmbedding[0])}::vector) AS similarity
    FROM species_facts
    WHERE 1 - (embedding <=> ${JSON.stringify(queryEmbedding[0])}::vector) > 0.40
    ORDER BY embedding <=> ${JSON.stringify(queryEmbedding[0])}::vector
    LIMIT ${topK}
  `;

  return chunks;
}
```

Minimum similarity threshold: **0.40**. Results below this threshold are not reliable enough to cite.

## Grounding Rules for Agents

Agents that use RAG must:
1. Only make claims that are supported by retrieved chunks
2. Include `source_id` references in their output for any cited fact
3. Say "insufficient context available" when retrieved similarity is below 0.40 — never hallucinate species biology facts

The Species Context Agent system prompt must include:
> "You may only state facts about this species that appear in the retrieved context. If a retrieved document does not address the question, say so. Do not use your training data to fill gaps about species biology — use only what has been retrieved."

## Ingest Pipeline

The ingestion scripts live in `scripts/ingest/`. They are run once during setup (not on every server start):

1. `scripts/ingest/ingestSpeciesFacts.ts` — loads IUCN PDFs and WWF profiles
2. `scripts/ingest/ingestConservationContext.ts` — loads WWF Living Planet reports etc.

Run: `npm run ingest:species` and `npm run ingest:conservation`

## What NOT to Do

- Do NOT use different embedding models at ingest time vs query time
- Do NOT let agents make claims about species biology without RAG grounding
- Do NOT let agents self-report "I don't have enough context" without actually checking the retrieval score
- Do NOT collapse the two indices — keep `species_facts` and `conservation_context` separate
