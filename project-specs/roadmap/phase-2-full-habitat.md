# Phase 2 — Full Habitat Coverage + GBIF

**Goal:** All IUCN Critically Endangered + Endangered species ranges in PostGIS. GBIF cross-reference working. Habitat + Species Context agents live.

**Status:** 🔲 Not started
**Depends on:** Phase 1 complete, IUCN bulk shapefile download received

---

## Key Tasks

- [ ] IUCN shapefile download received and ready for import
- [ ] `scripts/ingest/loadIUCNShapefiles.ts` — reads .shp files, loads into `species_ranges` via PostGIS
  - Filter to: CR (Critically Endangered) + EN (Endangered) species only
  - Attach `iucn_species_id`, `iucn_status`, `species_name`, `common_name`
- [ ] Verify spatial index still performs well at full dataset scale
- [ ] GBIF occurrence API client: `GET https://api.gbif.org/v1/occurrence/search?decimalLatitude=&decimalLongitude=&radius=50000&limit=10`
- [ ] Habitat Agent (Gemini 2.5 Flash-Lite): reads from `disaster:enriched`, queries GBIF for recent sightings per species, attaches to event
- [ ] Species Context Agent (Gemini 2.5 Flash): skeleton only — no RAG yet, uses base species data from PostGIS
- [ ] `EnrichedDisasterEvent` type updated with `gbif_recent_sightings` + `species_briefs`

## IUCN Shapefile Import Notes

IUCN provides shapefiles in EPSG:4326 (WGS84). Load with:
```bash
shp2pgsql -s 4326 -a MAMMALS.shp species_ranges | psql $DATABASE_URL
```
Or use the Node.js `shapefile` + `pg` approach in the ingest script.

Filter to CR + EN only to manage database size. VU (Vulnerable) species can be added in a later phase.

## Acceptance Criteria

1. `species_ranges` table contains all CR + EN species ranges from IUCN
2. PostGIS proximity query still returns results in < 200ms at full scale
3. GBIF sightings attached to enriched events when recent observations exist
4. Species Context Agent produces a basic species brief (without RAG grounding)

---

## Notes / Decisions Log
