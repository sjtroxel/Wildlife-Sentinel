# Phase 2 — Full Habitat Coverage + GBIF

**Goal:** All IUCN Critically Endangered + Endangered species ranges in PostGIS. GBIF occurrence API cross-referencing working. Habitat Agent and Species Context Agent skeleton live.

**Status:** Complete (2026-03-26)
**Depends on:** Phase 1 complete, IUCN shapefile download in hand
**Estimated sessions:** 1–2

---

## Overview

Phase 1 loaded ~10 approximate test polygons. Phase 2 replaces them with the full IUCN Red List spatial dataset — thousands of precise species range polygons loaded from the official shapefile. It also adds the GBIF occurrence API to cross-reference whether species have been recently confirmed in a given area, and introduces two new pipeline agents.

---

## 1. IUCN Shapefile Loader

### Prerequisites
- IUCN shapefile downloaded from `iucnredlist.org/resources/spatial-data-download`
- File: `MAMMALS.zip` (~815MB), unzipped to a `data/` directory outside the repo
- Neon database accessible with PostGIS enabled

### `scripts/ingest/loadIUCNShapefiles.ts`

The IUCN shapefile uses `.shp` format (EPSG:4326 / WGS84 — no reprojection needed). Each record is one species polygon with attributes including `binomial` (species name), `id_no` (IUCN ID), and `category` (threat status).

```typescript
import { open } from 'shapefile';
import postgres from 'postgres';

const sql = postgres(process.env['DATABASE_URL']!, { ssl: 'require' });

// Filter to CR + EN only — VU adds volume without improving alerting quality
const TARGET_STATUSES = new Set(['CR', 'EN']);

interface IUCNFeature {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: {
    binomial: string;    // Latin species name
    id_no: number;       // IUCN species ID
    category: string;    // CR, EN, VU, NT, LC...
    marine: string;      // 'true' | 'false'
  };
}

async function load(shapefilePath: string): Promise<void> {
  // Clear test data from Phase 1 before loading real data
  await sql`TRUNCATE TABLE species_ranges`;
  console.log('[iucn-loader] Cleared test data');

  const source = await open(shapefilePath);
  let loaded = 0;
  let skipped = 0;

  let result = await source.read();
  while (!result.done) {
    const feature = result.value as IUCNFeature;

    if (TARGET_STATUSES.has(feature.properties.category)) {
      try {
        await sql`
          INSERT INTO species_ranges (species_name, iucn_species_id, iucn_status, geom)
          VALUES (
            ${feature.properties.binomial},
            ${String(feature.properties.id_no)},
            ${feature.properties.category},
            ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}))
          )
          ON CONFLICT DO NOTHING
        `;
        loaded++;
        if (loaded % 100 === 0) console.log(`[iucn-loader] Loaded ${loaded} species...`);
      } catch (err) {
        console.warn(`[iucn-loader] Failed to load ${feature.properties.binomial}:`, err);
      }
    } else {
      skipped++;
    }

    result = await source.read();
  }

  console.log(`[iucn-loader] Complete. Loaded: ${loaded}, Skipped (non-CR/EN): ${skipped}`);
  await sql.end();
}

const path = process.argv[2];
if (!path) { console.error('Usage: npm run ingest:habitats -- path/to/MAMMALS.shp'); process.exit(1); }
load(path).catch(err => { console.error(err); process.exit(1); });
```

### Performance Verification

After loading, verify the spatial index is working:

```sql
-- Should return in < 200ms for a typical fire coordinate
EXPLAIN ANALYZE
SELECT species_name, iucn_status,
  ST_Distance(geom::geography, ST_Point(104.0, -2.0)::geography) / 1000 AS distance_km
FROM species_ranges
WHERE ST_DWithin(geom::geography, ST_Point(104.0, -2.0)::geography, 75000)
ORDER BY distance_km ASC;
```

If the query plan shows "Seq Scan" instead of "Index Scan", the spatial index needs to be rebuilt:
```sql
REINDEX INDEX idx_species_ranges_geom;
```

---

## 2. GBIF Occurrence API Integration

### API

```
GET https://api.gbif.org/v1/occurrence/search
  ?decimalLatitude={lat}
  &decimalLongitude={lng}
  &radius=50000              <- 50km radius in meters
  &taxonKey={gbif_taxon_id}  <- optional: filter to specific species
  &hasCoordinate=true
  &hasGeospatialIssue=false
  &year=2024,2025            <- last 2 years only
  &limit=10
  &fields=key,scientificName,decimalLatitude,decimalLongitude,eventDate,datasetName,occurrenceID
```

No authentication required. Rate limit: generous (no documented hard limit, but be polite — add 100ms delay between calls).

### Response Shape

```typescript
interface GBIFResponse {
  results: Array<{
    key: number;
    scientificName: string;
    decimalLatitude: number;
    decimalLongitude: number;
    eventDate: string;          // ISO date string, may be partial (e.g., "2024-11")
    datasetName: string;
    occurrenceID: string;
  }>;
  count: number;
  endOfRecords: boolean;
}
```

### `server/src/scouts/gbif.ts` (shared utility)

```typescript
import type { GBIFSighting } from '@wildlife-sentinel/shared/types';
import { fetchWithRetry } from '../scouts/BaseScout.js';

export async function fetchRecentSightings(
  lat: number,
  lng: number,
  speciesName: string
): Promise<GBIFSighting[]> {
  const url = new URL('https://api.gbif.org/v1/occurrence/search');
  url.searchParams.set('decimalLatitude', String(lat));
  url.searchParams.set('decimalLongitude', String(lng));
  url.searchParams.set('radius', '50000');
  url.searchParams.set('hasCoordinate', 'true');
  url.searchParams.set('hasGeospatialIssue', 'false');
  url.searchParams.set('limit', '10');

  const res = await fetchWithRetry(url.toString());
  const data = await res.json() as { results: GBIFResponse['results'] };

  return data.results.map(r => ({
    speciesName: r.scientificName,
    decimalLatitude: r.decimalLatitude,
    decimalLongitude: r.decimalLongitude,
    eventDate: r.eventDate,
    datasetName: r.datasetName,
    occurrenceID: r.occurrenceID,
  }));
}
```

---

## 3. Habitat Agent

**File:** `server/src/agents/HabitatAgent.ts`
**Model:** Gemini 2.5 Flash-Lite (via ModelRouter — Phase 3; Phase 2 uses raw SDK call as placeholder)
**Consumes from:** `disaster:enriched`
**Publishes to:** `disaster:enriched` (same stream — adds GBIF data then re-publishes to assembled queue)

**Note on stream architecture:** In Phase 5, the Habitat Agent and Species Context Agent both consume from `disaster:enriched` in parallel, then their results are assembled before Threat Assessment. In Phase 2, they run sequentially as a simplification — Habitat Agent reads enriched, queries GBIF, then passes to Species Context. This is refactored in Phase 5.

### Key logic

```typescript
// For each species_at_risk in the enriched event:
// 1. Query GBIF for recent confirmed sightings within 50km of the disaster
// 2. Attach to event
// 3. Gemini 2.5 Flash-Lite prompt:
//    "Based on these GBIF sightings, how recently and how consistently has
//     [species] been confirmed near these coordinates? Respond in JSON:
//     { sighting_confidence: 'confirmed' | 'possible' | 'historical_only',
//       most_recent_sighting: ISO date or null,
//       summary: string }"

// Output attached to event:
interface HabitatAgentOutput extends AgentOutput {
  gbif_recent_sightings: GBIFSighting[];
  sighting_confidence: 'confirmed' | 'possible' | 'historical_only';
  most_recent_sighting: string | null;
  gbif_summary: string;
}
```

Confidence formula for this agent:
```typescript
const confidence = sightings.length > 0
  ? Math.min(0.3 + (sightings.length * 0.1), 0.9)  // more sightings = higher confidence
  : 0.2;  // low confidence when no GBIF data at all
```

---

## 4. Species Context Agent (Phase 2 Skeleton — No RAG)

**File:** `server/src/agents/SpeciesContextAgent.ts`
**Model:** Gemini 2.5 Flash (via ModelRouter Phase 3; Phase 2 uses placeholder)
**Input:** Species name + IUCN status from PostGIS data
**Output:** `SpeciesBrief` (without RAG grounding — just model knowledge for now)

Phase 2 version uses only what the model already knows about the species. RAG grounding is added in Phase 6. The system prompt explicitly acknowledges this limitation:

```
System prompt (Phase 2):
"You are a wildlife conservation assistant. Provide a brief factual summary
for the given species. Note: this summary is based on your training data only.
Respond in JSON: { common_name, iucn_status, population_estimate, primary_threats: string[],
habitat_description, confidence_note }"
```

The `source_documents` field in `SpeciesBrief` will be empty in Phase 2 and populated in Phase 6.

---

## 5. Updated Type Definitions

Add to `shared/types.d.ts` (these were stubs in Phase 0):

```typescript
// EnrichedDisasterEvent — finalize Phase 2 fields
// (already declared as stub in Phase 0 — update to add gbif fields)
export interface FullyEnrichedEvent extends EnrichedDisasterEvent {
  gbif_recent_sightings: GBIFSighting[];
  species_briefs: SpeciesBrief[];
  sighting_confidence: 'confirmed' | 'possible' | 'historical_only';
  most_recent_sighting: string | null;
}
```

---

## 6. Pipeline Architecture Note

In Phase 2, the pipeline still flows linearly:
```
disaster:raw → [Enrichment] → disaster:enriched → [Habitat] → [SpeciesContext] → [Discord Publisher]
```

In Phase 5, Habitat and Species Context will consume `disaster:enriched` in parallel and their outputs assembled. The Phase 2 linear design is intentional simplicity — don't build the parallel fan-out until the agents exist and work.

---

## Acceptance Criteria

1. `scripts/ingest/loadIUCNShapefiles.ts` loads all CR + EN species from IUCN shapefile into `species_ranges`
2. PostGIS proximity query returns results in < 200ms at full dataset scale (EXPLAIN ANALYZE shows index scan)
3. GBIF client successfully fetches recent sightings for a representative set of species names
4. Habitat Agent attaches GBIF data to enriched events and produces `gbif_summary`
5. Species Context Agent produces a `SpeciesBrief` for each at-risk species (without RAG — model knowledge only)
6. `FullyEnrichedEvent` type validates correctly against real pipeline output
7. End-to-end: fire near a CR/EN polygon (full IUCN data) → GBIF cross-reference → species brief → Discord

---

## Notes / Decisions Log

- IUCN shapefile uses EPSG:4326 already — no coordinate reprojection needed
- Filter to CR + EN only — VU adds ~30% more data with marginal benefit for Phase 1-2 alerting. VU can be enabled later via a config flag.
- GBIF has no API key requirement — good, one less credential to manage
- Species Context Agent in Phase 2 has no RAG grounding — this is intentional. Calling it out explicitly in the system prompt ("based on training data only") prevents misleading confidence in output claims. Phase 6 upgrades this properly.
- The IUCN shapefile load completed in ~3 minutes (not 10-30) — because only 1,372 of 12,703 records passed the CR/EN filter. Estimate was based on full dataset; filtered set is much smaller.

## Spec Drift / Corrections

- **Field name:** Spec said `binomial` but actual MAMMALS_TERRESTRIAL_ONLY shapefile uses `sci_name`. Loader corrected to `sci_name`.
- **Geography index:** Spec only defined a geometry GIST index. Queries use `::geography` cast which cannot use a geometry index. Added `idx_species_ranges_geom_geography` on `(geom::geography)` — migration `0003_geography_index.sql`. Must run this migration on any new Neon instance.
- **Query performance:** Sub-200ms target is not achievable for geography `ST_DWithin` against complex IUCN polygon boundaries (~1.1s consistent). Index scan confirmed working. Acceptable for background pipeline — not a user-facing query.
- **Publisher stream:** `publisher.ts` was moved from `disaster:enriched` to `discord:queue` before Phase 2 began — corrects premature posting of unenriched events.
- **FullyEnrichedEvent:** Added `sighting_confidence` and `most_recent_sighting` fields (were missing from Phase 0 stub).
