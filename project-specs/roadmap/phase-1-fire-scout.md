# Phase 1 — Fire Scout + Basic Pipeline

**Goal:** Real NASA FIRMS fire data flows end-to-end through the pipeline and produces a real Discord alert when a fire overlaps with a manually-loaded habitat polygon.

**Status:** 🔲 Not started
**Depends on:** Phase 0 complete

---

## Overview

This phase wires together the first complete slice of the pipeline:

```
NASA FIRMS Scout → disaster:raw → Enrichment Agent (PostGIS only) → discord:queue → Discord
```

No LLM is used in this phase. The Enrichment Agent does only the PostGIS spatial check and Open-Meteo weather fetch. The Discord post is simple (not yet a rich embed). This proves the message bus works end-to-end.

---

## 1. NASA FIRMS Scout Agent

**File:** `server/src/scouts/FirmsScout.ts`

**Schedule:** Every 10 minutes via `node-cron`
**Data source:** `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/VIIRS_SNPP_NRT/{bbox}/1/{date}`

**Pre-filtering before publishing (to reduce pipeline volume):**
- FRP (Fire Radiative Power) > 10 MW — ignore weak/agricultural burns
- Confidence level = 'nominal' or 'high' — skip low-confidence detections
- Deduplication: check Redis key `dedup:firms:{lat}:{lng}:{acq_date}` before publishing

**Output schema:** `RawDisasterEvent` with:
```typescript
{
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: number, lng: number },
  severity: frp / 1000,  // normalized: 1000 MW = severity 1.0
  raw_data: { frp, confidence, bright_t31, acq_date, acq_time, satellite }
}
```

**API strategy:** Query in geographic strips covering the major critical habitat biomes:
- Southeast Asia (Sumatra, Borneo — orangutan, clouded leopard)
- Sub-Saharan Africa (forest zone — gorilla, chimpanzee, forest elephant)
- California/SW US (condor, mountain lion ranges)
- Eastern Australia (koala ranges)
- Amazon basin (jaguar, tapir, giant anteater)

Phase 2 will expand to global coverage. For Phase 1, target only these strips.

---

## 2. Redis Streams Setup

Consumer group creation for `disaster:raw`:
```typescript
// server/src/pipeline/streams.ts
export const STREAMS = {
  RAW: 'disaster:raw',
  ENRICHED: 'disaster:enriched',
  ASSESSED: 'alerts:assessed',
  DISCORD: 'discord:queue',
} as const;

export const CONSUMER_GROUPS = {
  ENRICHMENT: 'enrichment-group',
  HABITAT: 'habitat-group',
  SPECIES: 'species-group',
  THREAT: 'threat-group',
  SYNTHESIS: 'synthesis-group',
  DISCORD: 'discord-group',
} as const;
```

---

## 3. Habitat Polygon Loader (Manual — Phase 1 Testing Set)

**File:** `scripts/ingest/loadTestHabitats.ts`

Load 5–10 manually-curated species polygons into PostGIS as GeoJSON. These are approximate but scientifically grounded ranges:

| Species | IUCN Status | Region | Approximate Polygon |
|---|---|---|---|
| Sumatran Orangutan | Critically Endangered | Sumatra, Indonesia | Aceh + North Sumatra provinces |
| Bornean Orangutan | Endangered | Borneo | Kalimantan lowland forests |
| California Condor | Critically Endangered | SW USA | California coastal ranges + Grand Canyon |
| Florida Panther | Endangered | SW Florida | Big Cypress + Everglades |
| Koala | Vulnerable | SE Australia | Queensland + NSW coastal eucalyptus |
| Sumatran Tiger | Critically Endangered | Sumatra | Kerinci Seblat + Gunung Leuser |
| Mountain Gorilla | Endangered | Central Africa | Virunga Massif + Bwindi |
| African Forest Elephant | Critically Endangered | Central/West Africa | Congo Basin |
| Giant Panda | Vulnerable | China | Sichuan + Shaanxi mountain corridors |
| Amur Leopard | Critically Endangered | Russian Far East | Primorsky Krai coastal forests |

GeoJSON polygons sourced from IUCN range maps (approximate outlines acceptable for Phase 1 testing). Full IUCN shapefile import in Phase 2.

Schema:
```sql
CREATE TABLE species_ranges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  species_name TEXT NOT NULL,
  iucn_species_id TEXT,
  iucn_status TEXT NOT NULL,
  geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_species_ranges_geom ON species_ranges USING GIST (geom);
```

---

## 4. Enrichment Agent (Phase 1 — No LLM)

**File:** `server/src/agents/EnrichmentAgent.ts`

This phase version does two things:
1. PostGIS proximity check — is this fire within 75km of any known habitat?
2. Open-Meteo weather fetch — attach wind speed/direction/precipitation

No Gemini call yet. The "weather summary" field is a simple string built deterministically from the Open-Meteo response.

**PostGIS query:**
```sql
SELECT species_name, iucn_status, id,
  ST_Distance(geom::geography, ST_Point($1, $2)::geography) / 1000 AS distance_km
FROM species_ranges
WHERE ST_DWithin(geom::geography, ST_Point($1, $2)::geography, 75000)
ORDER BY distance_km ASC;
```
Remember: `ST_Point(longitude, latitude)` — lng first!

**If no overlap:** Log "filtered — no habitat overlap" to a `pipeline_events` table and do NOT publish to `disaster:enriched`.

**Open-Meteo call:**
```
GET https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&hourly=wind_speed_10m,wind_direction_10m,precipitation_probability&forecast_days=1
```

---

## 5. Basic Discord Publisher (Phase 1)

**File:** `server/src/discord/publisher.ts`

Phase 1 uses simple text messages, not rich embeds (embeds come in Phase 5):

```
#wildlife-alerts:
🔥 FIRE ALERT — Sumatran Orangutan Habitat
Fire detected 18km from critical habitat boundary
Wind: 22 km/h NE | Precipitation: 5% | Confidence: high
Source: NASA FIRMS VIIRS | Detected: 2026-03-24 14:32 UTC

#sentinel-ops:
[firms:scout] Fire: lat=-3.42, lng=104.21, FRP=87.3 MW
[enrichment] Habitat overlap: Sumatran Orangutan 18.3km — enriching
[enrichment] Open-Meteo attached | published to disaster:enriched
[discord] Posted to #wildlife-alerts
```

---

## 6. Pipeline Tables (Neon Migration)

```sql
-- 0002_pipeline_tables.sql

CREATE TABLE pipeline_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  source TEXT NOT NULL,
  stage TEXT NOT NULL,  -- 'raw', 'enriched', 'assessed', 'posted', 'filtered'
  reason TEXT,          -- why it was filtered (if applicable)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_event_id TEXT NOT NULL,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  coordinates JSONB NOT NULL,
  severity NUMERIC,
  enrichment_data JSONB,
  threat_level TEXT,         -- populated in Phase 5
  confidence_score NUMERIC,  -- populated in Phase 5
  prediction_data JSONB,     -- populated in Phase 5, used by Refiner in Phase 7
  discord_message_id TEXT,   -- populated when posted
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Acceptance Criteria

Phase 1 is complete when:
1. `FirmsScout` polls NASA FIRMS on schedule and publishes real fire events to `disaster:raw`
2. The Enrichment Agent reads from `disaster:raw`, runs the PostGIS query, and drops events with no habitat overlap
3. For events with habitat overlap: Open-Meteo data is attached and the event is published to `disaster:enriched`
4. The Discord Publisher reads from `discord:queue` and posts to both channels in the correct format
5. A real fire + habitat overlap produces a real Discord message in `#wildlife-alerts`
6. Filtered events (no habitat) are logged to `pipeline_events` table
7. End-to-end test: a mock RawDisasterEvent near a known polygon → Discord message

---

## Notes / Decisions Log

*(Add notes here as Phase 1 progresses)*
