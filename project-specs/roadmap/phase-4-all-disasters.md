# Phase 4 — All Five Disaster Sources

**Goal:** All five Scout agents polling. All event types flow through the same pipeline.

**Status:** 🔲 Not started
**Depends on:** Phase 3 complete

---

## Scouts to Implement

### NOAA NHC — Tropical Storms
- Endpoint: `https://www.nhc.noaa.gov/CurrentStorms.json`
- RSS: `nhc_at1.xml` (Atlantic), `nhc_ep1.xml` (Eastern Pacific)
- Schedule: Every 30 min
- Severity mapping: `wind_speed_mph / 180` (normalized 0–1, category 5 = ~1.0)
- Note: Seasonal. No storms in off-season → Scout polls but publishes nothing

### USGS NWIS — River Flooding
- Endpoint: `https://waterservices.usgs.gov/nwis/iv/?parameterCd=00060&format=json&siteStatus=active`
- Schedule: Every 15 min
- Trigger logic: gauge reading > flood stage threshold (stored per site in USGS response)
- Pre-filter: only gauges within 50km of any IUCN polygon (use bounding box pre-check)
- High volume source — aggressive pre-filtering critical

### US Drought Monitor — Drought
- Endpoint: `https://droughtmonitor.unl.edu/DmData/GISData.aspx?mode=table&aoi=county&date={YYYY-MM-DD}&statistic=0`
- Schedule: Every Thursday at 10:00 AM CT
- Trigger logic: county drought status worsens to D3 or D4 (severe/exceptional drought)
- Or: first time a county containing IUCN habitat reaches D3+

### NOAA Coral Reef Watch — Coral Bleaching
- Endpoint: CoralTemp 5km satellite product (CSV/GeoJSON)
- Schedule: Every 6 hours
- Trigger logic: Bleaching Alert Level 1 or higher at any reef location
- Coordinate all reef locations against marine species ranges in PostGIS

## Shared Normalization

All events normalize to `RawDisasterEvent`. Severity is always 0–1 normalized per source. Add event_type handling to the Enrichment Agent for storm-specific fields (track, landfall prediction) and flood-specific fields (flood stage %).

## Acceptance Criteria

1. All five Scout agents polling on correct schedules
2. All event types publish to `disaster:raw` with correct schemas
3. Pipeline handles all five `event_type` values without errors
4. USGS Scout pre-filtering keeps Redis volume manageable

---

## Notes / Decisions Log
