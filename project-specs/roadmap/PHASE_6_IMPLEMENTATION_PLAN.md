# Phase 6 — RAG Knowledge Base: Implementation Plan

**Status:** Approved, ready to implement
**Depends on:** Phase 5 complete ✅
**Session estimate:** 1 session (all code), plus user PDF prep for conservation_context

---

## Architectural Decisions

### 1. `retrieve.ts` routes through ModelRouter (not a standalone embedder)
The spec defines a standalone `server/src/rag/embedder.ts` that directly imports `@google/generative-ai`. This violates the model-router rule — ModelRouter.ts is the only file in `server/` that imports AI SDKs. `ModelRouter.embed()` already exists and does the same job. `retrieve.ts` calls `modelRouter.embed()` instead.

### 2. Ingest scripts get their own inline embedder
`scripts/` is a separate npm workspace with no access to the server's ModelRouter. Ingest scripts include an inline `embedBatch()` helper that imports `@google/generative-ai` directly. Acceptable — these are one-shot utility tools, not pipeline agents.

### 3. No programmatic PDF parsing (follows spec's notes)
The spec explicitly calls for plain `.txt` files, not runtime PDF parsing: *"PDF parsing is fragile and format-specific. Manual extraction to .txt is cleaner and one-time."* Conservation context docs are downloaded as PDFs by the user, extracted to `.txt` (pdftotext or equivalent), and placed in `scripts/ingest/sources/conservation/` before running ingest.

### 4. `species_facts` ingest: IUCN Red List API v4 (not local .txt files)
The project has an `IUCN_API_TOKEN`. The IUCN Red List API v4 returns full narrative assessments for each species — habitat, threats, population, ecology, conservation measures. The ingest script calls the API for all 1,372 species already in PostGIS. Source document field: `"IUCN Red List Assessment — {species_name} ({year})"` — real, verifiable, versioned citation.

### 5. Migration numbering: `0006_rag_tables.sql`
Spec said `0005` — already taken by Phase 5. Correct: `0006`.

---

## Files to Create

```
server/src/db/migrations/0006_rag_tables.sql
server/src/rag/chunker.ts
server/src/rag/retrieve.ts
server/tests/rag/chunker.test.ts
server/tests/rag/retrieve.test.ts
scripts/ingest/sources/conservation/         (user places .txt files here)
scripts/ingest/ingestSpeciesFacts.ts
scripts/ingest/ingestConservationContext.ts
```

## Files to Modify

```
shared/types.d.ts                         — add SpeciesFactChunk, ConservationContextChunk
server/src/agents/SpeciesContextAgent.ts  — RAG injection into system prompt
server/src/agents/SynthesisAgent.ts       — RAG injection into system prompt
scripts/package.json                      — add @google/generative-ai + ingest scripts
```

---

## Step-by-Step Implementation

### Step 1 — Migration: `0006_rag_tables.sql`

`species_facts` and `conservation_context` tables as specced.

Section type CHECK extended to include IUCN API fields:
```
('habitat', 'diet', 'threats', 'conservation_status', 'population', 'ecology',
 'behavior', 'conservation_measures', 'geographic_range')
```

Both tables get ivfflat index `WITH (lists = 100)`. ivfflat on empty table is valid.

### Step 2 — Types: `shared/types.d.ts`

Add:
```typescript
export interface SpeciesFactChunk {
  id: string;
  content: string;
  section_type: string;
  source_document: string;
  similarity: number;
}

export interface ConservationContextChunk {
  id: string;
  content: string;
  document_title: string;
  source_document: string;
  similarity: number;
}
```

### Step 3 — `server/src/rag/chunker.ts`

- `chunkBySection(text, sectionType, speciesName, sourceDocument)` — splits at paragraph boundaries, 512-token/50-token-overlap limit. Used by species_facts.
- `chunkByHeadings(text, documentTitle, sourceDocument)` — splits on heading patterns, falls back to chunkBySection per section. Used by conservation_context.
- Pure utility, zero SDK imports — fully testable without mocks.

### Step 4 — `server/src/rag/retrieve.ts`

- `retrieveSpeciesFacts(speciesName, queryContext, topK=5)` — calls `modelRouter.embed()`, queries species_facts with 0.40 similarity threshold.
- `retrieveConservationContext(queryContext, topK=3)` — same pattern for conservation_context.

### Step 5 — `scripts/package.json`

Add:
- `@google/generative-ai` to dependencies (inline embedder for ingest scripts)
- `"ingest:species": "tsx ingest/ingestSpeciesFacts.ts"`
- `"ingest:conservation": "tsx ingest/ingestConservationContext.ts"`

### Step 6 — `scripts/ingest/ingestSpeciesFacts.ts`

1. Validate env: `IUCN_API_TOKEN`, `DATABASE_URL`, `GOOGLE_AI_API_KEY`
2. Query `species_ranges` for all distinct `iucn_species_id` + `species_name`
3. Per species: skip if already has entries in species_facts (resumable)
4. Call `GET https://api.iucnredlist.org/api/v4/species/{taxon_id}/narrative` with `Authorization: Token {token}`
5. Extract narrative sections flexibly — map API field names to section_type values
6. Chunk each section with inline chunking logic
7. Embed chunks with 100ms delay between calls
8. Upsert to `species_facts` with `ON CONFLICT DO NOTHING`
9. Log progress per species

Contains inline `embedText()` + `embedBatch()` helpers (use `text-embedding-004` directly via `@google/generative-ai`).

### Step 7 — `scripts/ingest/ingestConservationContext.ts`

1. Validate env: `DATABASE_URL`, `GOOGLE_AI_API_KEY`
2. Scan `sources/conservation/` for `.txt` files
3. Infer `document_title` + `publication_year` from filename convention: `{title}_{year}.txt`
4. Chunk each file using inline `chunkByHeadings()` logic
5. Embed + upsert to `conservation_context` with `ON CONFLICT DO NOTHING`
6. Skips species-context chunking — uses heading-based chunking for narrative documents

### Step 8 — `SpeciesContextAgent.ts` update

In `generateSpeciesBrief(speciesName, eventType)`:
1. Call `retrieveSpeciesFacts(speciesName, \`threatened by ${eventType}\`)`
2. If chunks returned: inject as formatted context block in system prompt; require agent to cite source_documents; populate `source_documents` from chunk sources
3. If no chunks (empty index or below threshold): fall back to training knowledge with explicit uncertainty note; `source_documents: []`
4. System prompt now enforces citation: *"You may only state facts that appear in the retrieved context"*

### Step 9 — `SynthesisAgent.ts` update

In `processAlert(assessed)`, before calling Claude:
1. Call `retrieveConservationContext(\`${event_type} impact on ${species_at_risk[0]} endangered species\`)`
2. If context found: append to system prompt as *"Conservation context (use for 'why this matters' sentence)"* block with source citation requirement
3. If no context: system prompt unchanged (agent uses training knowledge for framing)

### Step 10 — Tests

**`server/tests/rag/chunker.test.ts`** — pure unit tests, no mocks:
- Short text returns exactly 1 chunk with correct metadata
- Long text (>2048 chars) produces multiple chunks with overlap
- Paragraph boundary preference over mid-sentence splits
- Empty text returns empty array
- `chunkByHeadings` splits on heading patterns correctly

**`server/tests/rag/retrieve.test.ts`** — mock modelRouter + sql:
- `retrieveSpeciesFacts` calls `modelRouter.embed()` with species context prefix
- Results below 0.40 threshold not returned (enforced by SQL WHERE clause)
- Returns `[]` when embed returns empty (graceful)
- `retrieveConservationContext` same patterns

---

## Conservation Context Documents (3 confirmed)

User must download, extract to `.txt`, place in `scripts/ingest/sources/conservation/` before running `npm run ingest:conservation`:

| File | Source | Notes |
|---|---|---|
| `ipbes_global_assessment_spm_2019.txt` | ipbes.net | Gold-standard peer-reviewed biodiversity assessment |
| `wwf_living_planet_report_2024.txt` | wwf.org/living-planet-report | Vertebrate population decline trends |
| `cbd_global_biodiversity_outlook_5_2020.txt` | cbd.int/gbo5 | Policy-level trends, post-2020 framework context |

Filename convention: `{descriptive_name}_{year}.txt` — ingest script extracts year from filename.

---

## Acceptance Criteria

- [ ] `species_facts` table: ≥50 chunks across top species
- [ ] `conservation_context` table: ≥1 document populated
- [ ] `retrieveSpeciesFacts()` returns similarity > 0.40 for "Sumatran Orangutan threats deforestation"
- [ ] SpeciesContextAgent `source_documents` field populated with real IUCN assessment names
- [ ] SynthesisAgent Discord embeds include conservation framing citing a source document
- [ ] No uncited species biology claims in agent output when RAG context available
- [ ] All tests pass, TypeScript strict clean

---

## Post-Implementation: Running Ingest

```bash
# Set env vars (or use .env loading)
export DATABASE_URL="..."
export IUCN_API_TOKEN="..."
export GOOGLE_AI_API_KEY="..."

# Species facts — IUCN API driven (~13-33 min for 1,372 species)
cd scripts && npm run ingest:species

# Conservation context — after placing .txt files in sources/conservation/
npm run ingest:conservation
```

Run migration `0006_rag_tables.sql` before first ingest run.
