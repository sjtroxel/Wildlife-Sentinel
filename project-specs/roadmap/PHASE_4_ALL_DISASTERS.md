# Phase 4 — All Five Disaster Sources

**Goal:** All four remaining Scout agents implemented and polling. All five event types flow through the same pipeline without errors.

**Status:** Not started
**Depends on:** Phase 3 complete
**Estimated sessions:** 2

---

## Overview

Phase 1 gave us the FIRMS Scout. This phase adds the remaining four, each with its own API, schedule, normalization logic, and pre-filtering strategy. All four extend `BaseScout` and use `fetchWithRetry` from Phase 1.

---

## 1. NOAA NHC — Tropical Storm Scout

**File:** `server/src/scouts/NhcScout.ts`
**Schedule:** Every 30 minutes
**API:** `https://www.nhc.noaa.gov/CurrentStorms.json` (JSON) + RSS XML for active advisories

### API Response Shape

```typescript
interface NHCStorm {
  id: string;           // e.g. "al022025"
  name: string;         // e.g. "Bertha"
  classification: string;  // "TD", "TS", "HU", "EX"
  intensity: string;    // max sustained wind in knots
  pressure: string;     // central pressure in mb
  latitude: string;     // e.g. "18.5N"
  longitude: string;    // e.g. "72.3W"
  movementDir: string;  // degrees
  movementSpeed: string; // knots
  lastUpdate: string;   // timestamp
  publicAdvisory: { advNum: string };
}
```

### Normalization

```typescript
function parseLatLng(lat: string, lng: string): { lat: number; lng: number } {
  const parseLat = parseFloat(lat.replace('N','').replace('S','-'));
  const parseLng = -(parseFloat(lng.replace('W','').replace('E','-')));
  // NHC always uses W longitude for Atlantic/E Pacific — negate
  return { lat: parseLat, lng: parseLng };
}

// Severity: max wind in knots normalized
// Category 5 hurricane = 137+ knots = severity 1.0
severity = Math.min(parseInt(storm.intensity) / 137, 1.0)
```

### Event ID Strategy

Use `storm.id + '_' + advisory_number` — each advisory update is a distinct event. This lets the pipeline detect track changes (new advisory = new event, even same storm).

### Seasonal note

NHC's Atlantic season runs June–November, E Pacific April–November. Outside season, `CurrentStorms.json` returns an empty array. The Scout polls anyway — polling an empty response is cheap and correct.

### raw_data payload

```typescript
raw_data: {
  storm_name: storm.name,
  classification: storm.classification,    // "HU", "TS", "TD", "EX"
  max_wind_knots: parseInt(storm.intensity),
  central_pressure_mb: parseInt(storm.pressure),
  movement_dir_deg: parseInt(storm.movementDir),
  movement_speed_knots: parseInt(storm.movementSpeed),
  advisory_number: storm.publicAdvisory.advNum,
}
```

---

## 2. USGS NWIS — Flood Gauge Scout

**File:** `server/src/scouts/UsgsScout.ts`
**Schedule:** Every 15 minutes
**API:** `https://waterservices.usgs.gov/nwis/iv/?parameterCd=00060&format=json&siteStatus=active`

### Volume Management (Critical)

USGS has ~11,000 active gauge stations. Querying all of them on every poll would generate thousands of events. Pre-filter aggressively:

**Step 1:** Build a static list of gauge site IDs that are near IUCN habitat polygons. Run this query once during setup:
```sql
-- Find all USGS gauges within 100km of any species range
-- (Requires loading a gauges table first — see below)
```

**Better approach for Phase 4:** Hardcode a curated list of ~50–100 gauge IDs in river systems that flow through or near major critical habitat biomes:
- Amazon tributaries (tapir, giant otter habitats)
- Congo River basin (forest elephant, gorilla habitats)
- Mekong River system (Irrawaddy dolphin, Mekong giant catfish)
- Everglades/Big Cypress (Florida panther)
- Northern California coastal rivers (coho salmon critical habitat)

Store in `server/src/scouts/usgs-sites.json` as a static list.

### API call

```
GET https://waterservices.usgs.gov/nwis/iv/
  ?sites=01234567,01234568,...   <- comma-separated list of site IDs
  &parameterCd=00060             <- discharge in cfs
  &format=json
```

### Trigger Logic

```typescript
interface USGSSite {
  siteCode: string;
  siteName: string;
  lat: number;
  lng: number;
  floodStage: number;        // cubic feet per second — stored in usgs-sites.json
}

// Only publish if current discharge > flood stage threshold
const currentDischarge = parseFloat(value.value[0]?.value ?? '0');
if (currentDischarge > site.floodStage) {
  // severity: how far above flood stage?
  severity = Math.min((currentDischarge - site.floodStage) / site.floodStage, 1.0);
  // publish event
}
```

### raw_data payload

```typescript
raw_data: {
  site_code: string,
  site_name: string,
  discharge_cfs: number,
  flood_stage_cfs: number,
  percent_above_flood_stage: number,
  gage_height_ft: number | null,
}
```

---

## 3. US Drought Monitor — Drought Scout

**File:** `server/src/scouts/DroughtScout.ts`
**Schedule:** Every Thursday at 10:30 AM CT (data releases ~10 AM CT)
**API:** `https://droughtmonitor.unl.edu/DmData/GISData.aspx?mode=table&aoi=county&statistic=0&date={YYYY-MM-DD}`

```typescript
// In scouts/index.ts — use cron schedule instead of fixed interval:
cron.schedule('30 10 * * 4', () => {  // Thursday 10:30 AM
  droughtScout.run().catch(...)
}, { timezone: 'America/Chicago' });
```

### Response Shape

The Drought Monitor returns a table of counties with drought categories D0–D4:
```
FIPS,State,County,None,D0,D1,D2,D3,D4,ValidStart,ValidEnd
48113,TX,Dallas,0,0,0,0,100,0,20260320,20260326
```

### Trigger Logic

Only publish events for counties at D3 (Extreme) or D4 (Exceptional) drought:
```typescript
// For each county row:
const isD3orD4 = parseFloat(row.D3) > 0 || parseFloat(row.D4) > 0;

// Severity: proportion in D3/D4
severity = (parseFloat(row.D3) + parseFloat(row.D4)) / 100;

// Only trigger if county contains IUCN habitat — check against a precomputed
// list of FIPS codes that overlap IUCN polygons (built once via PostGIS query)
```

### Pre-filter: FIPS codes near IUCN habitats

Build this list once and store in `server/src/scouts/drought-fips.json`:
```sql
-- Query to generate the list (run once in Neon SQL editor):
SELECT DISTINCT fips_code
FROM drought_counties  -- need to load FIPS→lat/lng lookup table
JOIN species_ranges ON ST_DWithin(
  species_ranges.geom::geography,
  ST_Point(county_lng, county_lat)::geography,
  100000
);
```

### raw_data payload

```typescript
raw_data: {
  fips: string,
  state: string,
  county: string,
  d3_percent: number,
  d4_percent: number,
  valid_start: string,
  valid_end: string,
}
```

---

## 4. NOAA Coral Reef Watch — Bleaching Scout

**File:** `server/src/scouts/CoralScout.ts`
**Schedule:** Every 6 hours
**API:** NOAA CoralTemp 5km bleaching alert product

### Data Access

NOAA CRW provides data via two approaches — use the simpler one:

**Option A (recommended):** Alert Area GeoJSON endpoint:
```
https://coralreefwatch.noaa.gov/vs/gauges/crw_vs_alert_areas.json
```
This returns polygons of current bleaching alert areas with alert levels 0–4.

**Option B:** Pixel-by-pixel CSV (complex, high volume) — avoid in Phase 4.

### Response Shape

```typescript
interface CRWAlertArea {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: {
    alert_level: number;    // 0=no stress, 1=watch, 2=warning, 3=alert1, 4=alert2
    alert_label: string;    // "Bleaching Alert Level 1"
    max_dhw: number;        // max degree heating weeks
  };
}
```

### Trigger Logic

Only publish events for alert_level >= 2 (Warning and above):
```typescript
if (feature.properties.alert_level < 2) continue;

// Severity: alert level normalized
severity = feature.properties.alert_level / 4;

// Coordinates: centroid of the alert polygon
const centroid = computeCentroid(feature.geometry.coordinates[0]!);
```

### Cross-reference with marine habitat

The PostGIS habitat check (via `ST_DWithin`) works for both terrestrial and marine species. Marine species ranges (coral, sea turtle, dugong) are in the same `species_ranges` table. The Enrichment Agent will find them automatically — no special handling needed.

### raw_data payload

```typescript
raw_data: {
  alert_level: number,
  alert_label: string,
  max_dhw: number,
  bleaching_watch: boolean,
  bleaching_warning: boolean,
}
```

---

## 5. Scout Registration Update

### `server/src/scouts/index.ts` (updated)

```typescript
import cron from 'node-cron';
import { FirmsScout } from './FirmsScout.js';
import { NhcScout } from './NhcScout.js';
import { UsgsScout } from './UsgsScout.js';
import { DroughtScout } from './DroughtScout.js';
import { CoralScout } from './CoralScout.js';

const scouts = {
  firms: new FirmsScout(),
  nhc: new NhcScout(),
  usgs: new UsgsScout(),
  drought: new DroughtScout(),
  coral: new CoralScout(),
};

export function startScouts(): void {
  // NASA FIRMS — every 10 min
  cron.schedule('*/10 * * * *', () => scouts.firms.run().catch(console.error));

  // NOAA NHC — every 30 min
  cron.schedule('*/30 * * * *', () => scouts.nhc.run().catch(console.error));

  // USGS NWIS — every 15 min
  cron.schedule('*/15 * * * *', () => scouts.usgs.run().catch(console.error));

  // US Drought Monitor — Thursday 10:30 AM CT
  cron.schedule('30 10 * * 4', () => scouts.drought.run().catch(console.error), { timezone: 'America/Chicago' });

  // NOAA Coral Reef Watch — every 6 hours
  cron.schedule('0 */6 * * *', () => scouts.coral.run().catch(console.error));

  console.log('[scouts] All 5 scouts scheduled');

  // Run each immediately on startup (except Drought — only valid on Thursdays)
  scouts.firms.run().catch(console.error);
  scouts.nhc.run().catch(console.error);
  scouts.usgs.run().catch(console.error);
  scouts.coral.run().catch(console.error);
}
```

---

## 6. Enrichment Agent Updates

The Enrichment Agent needs to handle storm-specific data. Add storm track enrichment:

```typescript
// For tropical_storm events, extract track data from raw_data:
if (event.event_type === 'tropical_storm') {
  const movementDirDeg = event.raw_data['movement_dir_deg'] as number | undefined;
  const movementSpeedKts = event.raw_data['movement_speed_knots'] as number | undefined;

  // Project landfall in 24h based on current track
  if (movementDirDeg !== undefined && movementSpeedKts !== undefined) {
    const distanceKm = (movementSpeedKts * 1.852) * 24; // knots to km, 24h projection
    // Attach projected landfall coordinates to enrichment_data
  }
}
```

---

## Acceptance Criteria

1. All 5 Scout agents scheduled and running without errors
2. Each scout correctly normalizes its response to `RawDisasterEvent` schema
3. Each scout's deduplication prevents same event from publishing twice within TTL window
4. Each scout's circuit breaker opens after 5 consecutive failures and auto-resets after 30 min
5. USGS Scout only triggers for sites in the pre-defined curated list AND only when above flood stage
6. Drought Scout only runs on Thursdays and only publishes D3/D4 events in counties near IUCN habitats
7. All five `event_type` values flow through the Enrichment Agent without TypeScript or runtime errors
8. A real tropical storm event (or test event) produces a Discord alert with storm-specific data

---

## Notes / Decisions Log

- NHC uses advisory number in event ID so each new storm advisory creates a new event — allows tracking storm track changes even for the same named storm
- USGS hardcoded site list in Phase 4 — a future phase could build this list dynamically from PostGIS, but that adds complexity. The static list is good enough for Phase 4.
- Drought events have weekly cadence — they will be rare events in the Discord channel, which is correct. Drought is slow-moving; alerting once per week per county is appropriate.
- Coral Reef Watch alert areas are polygon-based, not point-based — use polygon centroid as the `coordinates` value for compatibility with the PostGIS point query
- Marine species ranges are included in the same `species_ranges` table — no separate handling needed for marine events. The 75km radius check works for both terrestrial and marine geographies.
