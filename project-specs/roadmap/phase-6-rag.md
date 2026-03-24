# Phase 6 — RAG Knowledge Base

**Goal:** Species Context Agent and Synthesis Agent grounded in real source data. No agent makes uncited claims about species biology or conservation context.

**Status:** 🔲 Not started
**Depends on:** Phase 5 complete

---

## Overview

Two separate vector indices in Neon (pgvector):
- `species_facts` — per-species ecology, threats, habitat requirements, population data
- `conservation_context` — broader conservation framing (Living Planet reports, IPBES assessments)

Embeddings via Google `text-embedding-004` (free tier, 768 dimensions).

---

## 1. Database Tables

```sql
-- Migration: 0004_rag_tables.sql

CREATE TABLE species_facts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  species_name TEXT NOT NULL,
  iucn_species_id TEXT,
  section_type TEXT NOT NULL,  -- 'habitat', 'diet', 'threats', 'conservation_status', 'population', 'ecology'
  content TEXT NOT NULL,
  embedding vector(768),       -- text-embedding-004
  source_document TEXT NOT NULL,
  source_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_species_facts_embedding ON species_facts USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_species_facts_species ON species_facts (species_name);

CREATE TABLE conservation_context (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_title TEXT NOT NULL,
  section_heading TEXT,
  content TEXT NOT NULL,
  embedding vector(768),
  source_document TEXT NOT NULL,
  source_url TEXT,
  publication_year INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conservation_context_embedding ON conservation_context USING ivfflat (embedding vector_cosine_ops);
```

---

## 2. Document Sources

### species_facts
- **IUCN Red List PDFs** — downloadable species assessment PDFs from iucnredlist.org (one per species)
  - Focus on: CR + EN species that have corresponding ranges in PostGIS
  - Sections to extract: Habitat & Ecology, Threats, Conservation Actions, Population
- **WWF Species Profiles** — `wwf.org/species` — HTML scrape or PDF
  - Supplement IUCN data with narrative context
- **Smithsonian NMNH** — `si.edu/encyclopedia` for flagship species

### conservation_context
- **WWF Living Planet Report** (most recent edition) — PDF
- **IPBES Global Assessment Summary** — PDF available from ipbes.net
- **IUCN Red List Index trend reports** — summary statistics on extinction trends

---

## 3. Ingestion Pipeline

### Chunking Strategy

For species_facts:
```typescript
// Chunk per species × section_type
// e.g., one chunk for "Sumatran Orangutan — Threats"
// Max 512 tokens, 50-token overlap between sections
```

For conservation_context:
```typescript
// Chunk by document heading hierarchy
// H1 → H2 → H3 → content block
// Max 512 tokens, 50-token overlap
```

### Embedding Generation
```typescript
// server/src/rag/embedder.ts
import { GoogleGenerativeAI } from '@google/generative-ai';

async function embedText(text: string): Promise<number[]> {
  const model = genai.getGenerativeModel({ model: MODELS.GOOGLE_EMBEDDINGS });
  const result = await model.embedContent(text);
  return result.embedding.values; // 768-dimensional float array
}
```

### Ingest Script
```typescript
// scripts/ingest/ingestSpeciesFacts.ts
// 1. Load source documents from scripts/ingest/sources/species/
// 2. Extract text by section
// 3. Chunk with overlap
// 4. Embed each chunk (with retry + rate limit handling)
// 5. Upsert to species_facts table
// Run: npm run ingest:species
```

---

## 4. Retrieval Pattern

```typescript
// server/src/rag/retrieve.ts
export async function retrieveSpeciesFacts(
  speciesName: string,
  context: string,
  topK = 5
): Promise<SpeciesFactChunk[]> {
  const queryText = `${speciesName} ecology threats habitat: ${context}`;
  const embedding = await embedText(queryText);

  return sql`
    SELECT id, content, section_type, source_document,
           1 - (embedding <=> ${JSON.stringify(embedding)}::vector) AS similarity
    FROM species_facts
    WHERE species_name = ${speciesName}
      AND 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) > 0.40
    ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
    LIMIT ${topK}
  `;
}
```

Minimum similarity threshold: **0.40**. Never cite a chunk below this threshold.

---

## 5. Agent Updates

### Species Context Agent
Update to use `retrieveSpeciesFacts()` before generating the species brief.
System prompt addition:
```
You may only state facts about this species that appear in the retrieved context below.
If retrieved context does not address a question, say "data not available."
Never use your training data to fill gaps about species biology.
For every factual claim, cite the source_document field.
```

### Synthesis Agent
Update to use `retrieveConservationContext()` for the "why this matters" framing.
System prompt addition:
```
Use the conservation context provided to add one sentence of broader significance.
Cite the source document name for any contextual claim.
If no relevant context is retrieved, omit the broader significance sentence.
```

---

## Acceptance Criteria

1. `species_facts` table populated with chunks for all species in `species_ranges` PostGIS table
2. `conservation_context` table populated with WWF + IPBES content
3. Retrieval returns relevant chunks at similarity > 0.40 for representative test queries
4. Species Context Agent cites `source_document` in its output
5. Synthesis Agent uses retrieved conservation context in Discord embeds
6. Neither agent makes uncited factual claims about species biology

---

## Notes / Decisions Log

*(Add notes here as Phase 6 progresses)*
