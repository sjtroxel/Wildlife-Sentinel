# Phase 6 — RAG Ingest Handoff

**Last updated:** 2026-03-28
**Written for:** Fresh Claude session
**Status:** Ingest in progress — run `npm run ingest:species --workspace=scripts` daily until complete.

---

## What Phase 6 Built (All Working)

- `server/src/db/migrations/0006_rag_tables.sql` — applied to Neon ✅
- `server/src/db/migrations/0007_vector_3072.sql` — applied to Neon ✅ (vector(1536), ivfflat index)
- `server/src/rag/chunker.ts` — text chunking utility ✅
- `server/src/rag/retrieve.ts` — `retrieveSpeciesFacts()` + `retrieveConservationContext()` ✅
- `server/src/agents/SpeciesContextAgent.ts` — RAG-grounded with citation enforcement ✅
- `server/src/agents/SynthesisAgent.ts` — conservation context injection ✅
- `scripts/ingest/ingestConservationContext.ts` — reads local `.txt` files, works correctly ✅
- `scripts/ingest/ingestSpeciesFacts.ts` — GBIF + Wikipedia, compiled JS, rate-limit retry ✅
- 72/72 tests pass, TypeScript strict clean ✅

---

## Current Ingest Status (as of 2026-03-28)

- `species_facts`: ~254 species ingested out of 751 total
- `conservation_context`: not yet run (requires 3 .txt files — see below)
- Ingest is **resumable** — re-running skips already-ingested species automatically

### Why it stops mid-run
Google Gemini embedding free tier limits:
- **100 requests/minute** — handled: `EMBED_DELAY_MS = 650ms` + 65s retry on 429
- **~1,500 requests/day** — the daily cap is hit after ~250–300 species per day

**Action:** Run `npm run ingest:species --workspace=scripts` once per day. It will ingest ~250 new species per run. After 3 days, all 751 species will be done.

---

## Bugs Fixed This Session (do not reintroduce)

1. **Infinite loop in `chunkText`** — text lengths between MAX_CHUNK_CHARS (2048) and MAX_CHUNK_CHARS + OVERLAP_CHARS (2248) caused infinite loop. Fixed with `if (end >= trimmed.length) break` before advancing start. Same fix applied to `ingestConservationContext.ts`.

2. **V8 heap OOM from huge GBIF responses** — GBIF can return monograph-sized descriptions. Fixed with `limit=15`, `MAX_DESC_CHARS=4000` cap per description, and 200KB response size check before JSON.parse.

3. **Wikipedia unbounded extract** — added `exchars=8000` to Wikipedia API URL.

4. **tsx memory overhead** — scripts now compile to JS first via `tsc`, then run plain JS. See `scripts/tsconfig.json` and `scripts/package.json` build scripts.

5. **Vector dimension mismatch** — `text-embedding-004` (gone) replaced with `gemini-embedding-001` at 1536 dims (full 3072 exceeds ivfflat limit of 2000). All embed calls use `outputDimensionality: 1536`.

---

## Run Commands (from repo root)

```bash
# Species facts ingest (run daily until 751/751 complete)
npm run ingest:species --workspace=scripts

# Check progress
psql $DATABASE_URL -c "SELECT COUNT(*) FROM species_facts;"
psql $DATABASE_URL -c "SELECT COUNT(DISTINCT species_name) FROM species_facts;"

# Conservation context ingest (run once, after placing .txt files)
npm run ingest:conservation --workspace=scripts
```

---

## Conservation Context .txt Files Still Needed

Place these 3 files in `scripts/ingest/sources/conservation/` before running `ingest:conservation`:
- `ipbes_global_assessment_spm_2019.txt`
- `wwf_living_planet_report_2024.txt`
- `cbd_global_biodiversity_outlook_5_2020.txt`

Download the PDFs from their respective sites, copy the text content into .txt files.

---

## Phase 6 Acceptance Criteria (Remaining)

- [x] Migration 0007 applied to Neon (vector(1536))
- [ ] `ingest:species` runs successfully — `species_facts` populated with ≥50 chunks (in progress, ~254/751 species done)
- [ ] `ingest:conservation` runs — `conservation_context` populated with 3 documents
- [ ] `retrieveSpeciesFacts()` returns similarity > 0.40 for a test query
- [ ] SpeciesContextAgent `source_documents` field populated with real GBIF source names

---

## Env vars required (in server/.env)

```
GOOGLE_AI_API_KEY=...    # for gemini-embedding-001
DATABASE_URL=...         # Neon connection string
```

---

## Scripts Architecture Notes

- `scripts/tsconfig.json` — compiles `ingest/**/*.ts` to `scripts/dist/`
- `scripts/package.json` — `ingest:species` runs `build` then `node dist/ingestSpeciesFacts.js`
- No tsx at runtime — compiled to plain JS to avoid tsx memory overhead (~2GB for 751 species)
- `EMBED_DELAY_MS = 650` — stays under 100 RPM free tier limit
- `embedText()` has 5-retry loop with 65s wait on 429 — handles per-minute bursts
- Daily limit (~1,500 req/day) is the binding constraint; ~250 species per day
