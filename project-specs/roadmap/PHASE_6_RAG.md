# Phase 6 — RAG Knowledge Base

**Goal:** Species Context Agent and Synthesis Agent grounded in real published data. No agent makes uncited claims about species biology or conservation context.

**Status:** 🔶 Blocked — infrastructure complete, ingest data source unresolved. See PHASE_6_HANDOFF.md.
**Depends on:** Phase 5 complete
**Estimated sessions:** 2

---

## Overview

Two separate vector indices in Neon (pgvector). Both use Google `text-embedding-004` (768 dimensions, free tier). The indices are kept separate by design — mixing species facts with conservation context would degrade retrieval relevance for both agents.

| Index Table | Content | Used By |
|---|---|---|
| `species_facts` | IUCN species assessments, WWF profiles, Smithsonian records | Species Context Agent |
| `conservation_context` | WWF Living Planet reports, IPBES Global Assessment, IUCN Red List Index trends | Synthesis Agent |

---

## 1. Database Tables

### `server/src/db/migrations/0005_rag_tables.sql`

```sql
-- Migration: 0005_rag_tables

-- Up

CREATE TABLE IF NOT EXISTS species_facts (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  species_name     TEXT        NOT NULL,
  iucn_species_id  TEXT,
  section_type     TEXT        NOT NULL
                   CHECK (section_type IN ('habitat','diet','threats','conservation_status','population','ecology','behavior')),
  content          TEXT        NOT NULL,
  embedding        vector(768),                -- text-embedding-004
  source_document  TEXT        NOT NULL,
  source_url       TEXT,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ivfflat for ANN search on large tables (>10k rows)
-- lists=100 is a good starting point; increase to sqrt(row_count) as table grows
CREATE INDEX IF NOT EXISTS idx_species_facts_embedding
  ON species_facts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_species_facts_species ON species_facts (species_name);

CREATE TABLE IF NOT EXISTS conservation_context (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  document_title   TEXT        NOT NULL,
  section_heading  TEXT,
  content          TEXT        NOT NULL,
  embedding        vector(768),
  source_document  TEXT        NOT NULL,
  source_url       TEXT,
  publication_year INTEGER,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conservation_context_embedding
  ON conservation_context USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Down
-- DROP INDEX IF EXISTS idx_conservation_context_embedding;
-- DROP TABLE IF EXISTS conservation_context;
-- DROP INDEX IF EXISTS idx_species_facts_embedding;
-- DROP TABLE IF EXISTS species_facts;
```

---

## 2. Source Documents

### species_facts sources

| Document | Format | Notes |
|---|---|---|
| IUCN Red List species assessments | PDF per species | Download from iucnredlist.org for each CR/EN species in the PostGIS table |
| WWF Species Directory | HTML / PDF | `wwf.org/species` — one page per species with threats, habitat, status |
| Smithsonian NMNH Encyclopedia | HTML | `si.edu/encyclopedia` — good for flagship megafauna |

**Practical approach:** For each species in `species_ranges`, download the IUCN assessment PDF and any available WWF profile. Store raw files in `scripts/ingest/sources/species/{species_name}/`. Run ingest script once.

Focus first on the species most likely to appear in alerts: Sumatran Orangutan, Sumatran Tiger, Mountain Gorilla, Florida Panther, California Condor — prioritize these for Phase 6, add more in later iterations.

### conservation_context sources

| Document | Format | Notes |
|---|---|---|
| WWF Living Planet Report 2024 | PDF | Available at wwf.org/living-planet-report |
| IPBES Global Assessment Summary for Policymakers | PDF | Available at ipbes.net |
| IUCN Red List Index trend data | HTML/CSV | Available at iucnredlist.org/statistics |

---

## 3. Chunking Utility

### `server/src/rag/chunker.ts`

```typescript
interface Chunk {
  content: string;
  metadata: Record<string, string | number>;
}

const MAX_CHUNK_TOKENS = 512;
const OVERLAP_TOKENS = 50;
// Rough token approximation: 1 token ≈ 4 characters (English text)
const CHARS_PER_TOKEN = 4;

export function chunkBySection(
  text: string,
  sectionType: string,
  speciesName: string,
  sourceDocument: string
): Chunk[] {
  const maxChars = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN;
  const overlapChars = OVERLAP_TOKENS * CHARS_PER_TOKEN;

  const chunks: Chunk[] = [];

  if (text.length <= maxChars) {
    chunks.push({ content: text, metadata: { species_name: speciesName, section_type: sectionType, source_document: sourceDocument } });
    return chunks;
  }

  // Split at paragraph boundaries where possible
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    // Try to end at a paragraph boundary
    const paragraphEnd = text.lastIndexOf('\n\n', end);
    if (paragraphEnd > start + maxChars / 2) {
      end = paragraphEnd;
    }

    chunks.push({
      content: text.slice(start, end),
      metadata: { species_name: speciesName, section_type: sectionType, source_document: sourceDocument, chunk_index: chunks.length },
    });

    start = end - overlapChars;  // overlap for context continuity
  }

  return chunks;
}
```

---

## 4. Embedder

### `server/src/rag/embedder.ts`

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MODELS } from '@wildlife-sentinel/shared/models';
import { config } from '../config.js';

const genai = new GoogleGenerativeAI(config.googleAiKey);

/**
 * Generate embeddings for text.
 * Rate limited internally — text-embedding-004 has free tier rate limits.
 * For ingest scripts, process in batches with delays.
 */
export async function embedText(text: string): Promise<number[]> {
  const model = genai.getGenerativeModel({ model: MODELS.GOOGLE_EMBEDDINGS });
  const result = await model.embedContent(text);
  return result.embedding.values; // 768-dimensional float array
}

/** Batch embed with rate limit protection — for ingest scripts */
export async function embedBatch(
  texts: string[],
  delayMs = 100  // 100ms between calls = max ~10 calls/sec, well within free tier
): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embedText(text));
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}
```

---

## 5. Ingest Scripts

### `scripts/ingest/ingestSpeciesFacts.ts`

High-level structure:

```typescript
// 1. Scan scripts/ingest/sources/species/ directory
// 2. For each species folder, extract text by section (PDF parsing or text files)
// 3. Chunk each section using chunkBySection()
// 4. Embed each chunk using embedBatch() with delay
// 5. Upsert to species_facts table (ON CONFLICT on content + species_name — idempotent)

async function ingestSpecies(speciesDir: string): Promise<void> {
  const speciesName = path.basename(speciesDir);
  const textFiles = readdirSync(speciesDir).filter(f => f.endsWith('.txt'));

  for (const file of textFiles) {
    const sectionType = file.replace('.txt', '');  // e.g., 'threats.txt' → 'threats'
    const content = readFileSync(path.join(speciesDir, file), 'utf8');
    const sourceDoc = `IUCN ${speciesName} Assessment`;

    const chunks = chunkBySection(content, sectionType, speciesName, sourceDoc);
    const embeddings = await embedBatch(chunks.map(c => `${speciesName} ${sectionType}: ${c.content}`));

    for (let i = 0; i < chunks.length; i++) {
      await sql`
        INSERT INTO species_facts (species_name, section_type, content, embedding, source_document)
        VALUES (${speciesName}, ${sectionType}, ${chunks[i]!.content}, ${JSON.stringify(embeddings[i]!)}::vector, ${sourceDoc})
        ON CONFLICT DO NOTHING
      `;
    }
    console.log(`[ingest] ${speciesName}/${sectionType}: ${chunks.length} chunks`);
  }
}
```

**Text file preparation:** For each species, manually copy relevant sections from IUCN PDFs into `scripts/ingest/sources/species/{species_name}/threats.txt`, `habitat.txt`, `population.txt`, etc. This is a one-time preparation step.

---

## 6. Retrieval Functions

### `server/src/rag/retrieve.ts`

```typescript
import { embedText } from './embedder.js';
import { sql } from '../db/client.js';

const SIMILARITY_THRESHOLD = 0.40;

export interface SpeciesFactChunk {
  id: string;
  content: string;
  section_type: string;
  source_document: string;
  similarity: number;
}

export async function retrieveSpeciesFacts(
  speciesName: string,
  queryContext: string,
  topK = 5
): Promise<SpeciesFactChunk[]> {
  const queryText = `${speciesName} ecology threats habitat: ${queryContext}`;
  const embedding = await embedText(queryText);

  return sql<SpeciesFactChunk[]>`
    SELECT id::text, content, section_type, source_document,
           1 - (embedding <=> ${JSON.stringify(embedding)}::vector) AS similarity
    FROM species_facts
    WHERE species_name = ${speciesName}
      AND 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) > ${SIMILARITY_THRESHOLD}
    ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
    LIMIT ${topK}
  `;
}

export async function retrieveConservationContext(
  queryContext: string,
  topK = 3
): Promise<Array<{ id: string; content: string; document_title: string; source_document: string; similarity: number }>> {
  const embedding = await embedText(queryContext);

  return sql`
    SELECT id::text, content, document_title, source_document,
           1 - (embedding <=> ${JSON.stringify(embedding)}::vector) AS similarity
    FROM conservation_context
    WHERE 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) > ${SIMILARITY_THRESHOLD}
    ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
    LIMIT ${topK}
  `;
}
```

---

## 7. Agent Updates

### Species Context Agent — RAG grounding

```typescript
// Before calling Gemini, retrieve relevant facts
const facts = await retrieveSpeciesFacts(speciesName, `threatened by ${event.event_type}`);

if (facts.length === 0) {
  // Fall back to model knowledge but flag it explicitly
  systemPrompt += '\n\nNo RAG context was retrieved for this species. Use training knowledge but indicate uncertainty.';
} else {
  const ragContext = facts.map(f => `[${f.source_document} — ${f.section_type}]\n${f.content}`).join('\n\n');
  systemPrompt += `\n\nRetrieved species context (similarity > 0.40):\n${ragContext}`;
  systemPrompt += '\n\nYou may ONLY state facts that appear in the above retrieved context. For each factual claim, note the source_document. Say "data not available" for anything not covered.';
}
```

### Synthesis Agent — conservation context

```typescript
const conservationCtx = await retrieveConservationContext(
  `${event.event_type} impact on ${event.species_at_risk[0]} endangered species conservation`
);

if (conservationCtx.length > 0) {
  const ctxText = conservationCtx[0]!.content;
  systemPrompt += `\n\nConservation context (use for "why this matters" sentence):\n${ctxText}\nSource: ${conservationCtx[0]!.source_document}`;
}
```

---

## Acceptance Criteria

1. `species_facts` table populated with at least 50 chunks covering top 10 at-risk species
2. `conservation_context` table populated with WWF Living Planet + IPBES content
3. `retrieveSpeciesFacts()` returns similarity > 0.40 chunks for representative queries (test: "Sumatran Orangutan threats deforestation")
4. Species Context Agent output includes `source_documents` field with real document names
5. Synthesis Agent Discord embeds include a conservation framing sentence citing a source document
6. Neither agent makes uncited factual claims — any claim about population numbers or threats cites its source
7. ivfflat index allows retrieval queries to complete in < 50ms

---

## Notes / Decisions Log

- ivfflat (approximate nearest neighbor) chosen over exact HNSW for storage efficiency at this scale — HNSW uses significantly more memory and is overkill at <10k chunks
- 768-dimension embeddings from `text-embedding-004` — matches what will be used at query time (must use same model for both)
- `SIMILARITY_THRESHOLD = 0.40` — tuned empirically in Asteroid Bonanza; below this threshold results are not meaningfully related to the query
- Source documents stored as plain text files, not parsing PDFs programmatically — PDF parsing is fragile and format-specific. Manual extraction to `.txt` is cleaner and one-time.
- Ingest is NOT idempotent by default unless you add `ON CONFLICT DO NOTHING` — include this to allow safe re-runs without creating duplicate chunks
