# Phase 6 — RAG Ingest Handoff

**Written for:** Fresh Claude session
**Context:** Phase 6 code is complete and all 72 tests pass. The only blocker is `ingestSpeciesFacts.ts` — the data source for the `species_facts` RAG index is broken. This document explains the problem, what was tried, and what the fresh session needs to solve.

---

## What Phase 6 Built (All Working)

- `server/src/db/migrations/0006_rag_tables.sql` — applied to Neon ✅
- `server/src/rag/chunker.ts` — text chunking utility ✅
- `server/src/rag/retrieve.ts` — `retrieveSpeciesFacts()` + `retrieveConservationContext()` ✅
- `server/src/agents/SpeciesContextAgent.ts` — RAG-grounded with citation enforcement ✅
- `server/src/agents/SynthesisAgent.ts` — conservation context injection ✅
- `scripts/ingest/ingestConservationContext.ts` — reads local `.txt` files, works correctly ✅
- `scripts/ingest/ingestSpeciesFacts.ts` — **BROKEN** (see below) ❌
- 72/72 tests pass, TypeScript strict clean ✅

---

## The Blocker: `ingestSpeciesFacts.ts`

### What it's supposed to do
Populate the `species_facts` pgvector table with IUCN narrative assessments for all **1,372 Critically Endangered and Endangered species** currently loaded in PostGIS `species_ranges`. For each species, it should store chunked text covering: habitat, threats, population, ecology, conservation_measures — each chunk embedded with Google `text-embedding-004` (768 dims).

### Why it must cover all 1,372 species (not just 10)
The system monitors disasters globally against ALL species in PostGIS. When a wildfire threatens an obscure CR lemur in Madagascar, the SpeciesContextAgent needs grounding facts for that species — not just the 10 most famous ones. Limiting to 10 species defeats the purpose of the entire RAG system.

### What was tried

**Attempt 1 — IUCN Red List API v4**
- URL tried: `https://api.iucnredlist.org/api/v4/species/{taxon_id}/narrative`
- Auth: `Authorization: Token {token}` header
- Result: HTML 404 page for every single species
- Conclusion: The `/species/{id}/narrative` endpoint does not exist at this URL in v4

**Attempt 2 — IUCN Red List API v3**
- URL tried: `https://apiv3.iucnredlist.org/api/v3/species/narrative/id/{id}?token={token}`
- Result: Cloudflare "Just a moment..." bot protection challenge page
- Conclusion: v3 is behind Cloudflare and blocks automated requests (curl, Node.js fetch)

**Confirmed via curl from the user's machine.** Both APIs are inaccessible to automated scripts.

The project has a valid `IUCN_API_TOKEN` (env var `IUCN_API_TOKEN` in `server/.env`).

### Current state of the ingest script
`scripts/ingest/ingestSpeciesFacts.ts` was updated mid-session to try v3 endpoints. It currently has the v3 URL but it will fail the same way. The script architecture (chunking, embedding, upsert) is correct — only the data fetching layer is broken. The key function to fix is `fetchNarrative()`.

---

## What the Fresh Session Needs to Solve

**Goal:** A reliable, automated way to ingest species narrative data for all 1,372 species into `species_facts`. Must be scalable — not manual text files for each species.

### Avenues to investigate (in rough priority order)

**1. IUCN Full Dataset Download (most promising)**
IUCN provides bulk dataset downloads for registered users at `iucnredlist.org/resources/grid`. These include narrative assessments in CSV or XML format — the same data the API returns, but as a single downloadable file. The user already has an IUCN account (they have a token). If a bulk download with narratives is available, `ingestSpeciesFacts.ts` could parse that file locally — no API calls needed, no Cloudflare. This would cover all 1,372 species in one operation.

**2. IUCN API v4 — correct endpoint discovery**
The v4 API exists (`api.iucnredlist.org`) but we never found the correct endpoint. The v4 API is likely assessment-centric rather than species-centric. Possible correct approach:
- `GET /api/v4/taxa/{sis_id}` → find assessment IDs
- `GET /api/v4/assessments/{assessment_id}` → get narrative within assessment
The SIS ID in the database (`iucn_species_id`) should be the same as the v4 taxa ID. Documentation may be at `api.iucnredlist.org` or `developers.iucnredlist.org`. Worth trying with the correct Node.js `fetch()` and headers before assuming it's blocked.

**3. IUCN API v3 with browser-like headers**
Cloudflare bot protection often specifically blocks `curl` User-Agent but allows `node-fetch` or `undici` with a real browser User-Agent. May be worth testing:
```
User-Agent: Mozilla/5.0 (compatible; wildlife-sentinel/1.0)
Accept: application/json
```
If this bypasses Cloudflare, v3 is well-understood and works cleanly.

**4. Encyclopedia of Life (EOL) API**
`eol.org` has species pages with habitat, ecology, threats, conservation info. Free API, no auth required for basic access. Coverage of CR/EN species is good. URL: `https://eol.org/api/`. The tricky part: EOL uses its own IDs, so you'd need to map from IUCN taxon ID → EOL page ID (EOL provides a `provider_ids` lookup endpoint). Less authoritative than IUCN but far more accessible.

**5. Wikipedia API**
Wikipedia has detailed species articles for most CR/EN species. The MediaWiki API (`en.wikipedia.org/w/api.php`) is completely open, no auth, no rate limits for reasonable use. Quality is good for flagship species (orangutans, tigers, gorillas) but patchy for obscure ones. Could serve as fallback for species with no EOL data. Not peer-reviewed but factually accurate for well-known species.

**6. Hybrid approach**
IUCN bulk download (if available) for all species that have assessments + Wikipedia/EOL as fallback for any gaps. This mirrors the Poster Pilot pattern (primary source blocked → use alternative database that has the same data).

---

## Key Files

```
scripts/ingest/ingestSpeciesFacts.ts   ← needs fixing (fetchNarrative function)
scripts/ingest/ingestConservationContext.ts  ← works, reads .txt files
scripts/ingest/sources/conservation/   ← user still needs to place 3 .txt files here:
                                          ipbes_global_assessment_spm_2019.txt
                                          wwf_living_planet_report_2024.txt
                                          cbd_global_biodiversity_outlook_5_2020.txt
server/src/rag/retrieve.ts             ← works correctly, no changes needed
server/src/rag/chunker.ts              ← works correctly, no changes needed
```

## Database

`species_facts` and `conservation_context` tables exist in Neon (migration 0006 applied). Both are empty — ingest has not successfully run yet.

```sql
-- Verify tables exist:
SELECT COUNT(*) FROM species_facts;        -- should return 0
SELECT COUNT(*) FROM conservation_context; -- should return 0

-- Check species available for ingest:
SELECT COUNT(DISTINCT iucn_species_id) FROM species_ranges WHERE iucn_species_id IS NOT NULL;
-- returns ~1,372
```

## Env vars (in server/.env)
```
IUCN_API_TOKEN=...
GOOGLE_AI_API_KEY=...
DATABASE_URL=...
```

## How to run ingest once fixed (from repo root)
```bash
npm run ingest:species       # populates species_facts
npm run ingest:conservation  # populates conservation_context (needs .txt files first)
```

---

## Ingest Script Architecture (What's Correct, Don't Change)

The script structure in `ingestSpeciesFacts.ts` is sound — only `fetchNarrative()` needs replacing:

```typescript
// This function is what needs fixing — the rest of the script is correct
async function fetchNarrative(taxonId: string): Promise<{
  sections: Record<string, string>;  // field_name → narrative text
  year: number | null;
}> { ... }
```

The `SECTION_TYPE_MAP` maps source field names to our DB `section_type` CHECK values:
```typescript
// Allowed section_type values in DB:
'habitat' | 'diet' | 'threats' | 'conservation_status' | 'population' |
'ecology' | 'behavior' | 'conservation_measures' | 'geographic_range'
```

Whatever data source is chosen, `fetchNarrative` just needs to return a `sections` object with string values keyed by any name in the SECTION_TYPE_MAP (or any name that maps to one of the allowed section types).

---

## Phase 6 Acceptance Criteria (Remaining)

- [ ] `species_facts` populated with ≥50 chunks across species (ideally all 1,372)
- [ ] `conservation_context` populated with 3 documents (user needs to place .txt files)
- [ ] `retrieveSpeciesFacts()` returns similarity > 0.40 for test queries
- [ ] SpeciesContextAgent `source_documents` field populated with real source names
- [ ] SynthesisAgent Discord embeds include cited conservation framing

Everything else in Phase 6 is complete.
