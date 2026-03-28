# API Integrations — Wildlife Sentinel

This document is the reference for every external API the system calls — endpoint details, response schemas, auth, rate limits, and error handling patterns.

---

## Shared Error Handling Pattern

All external API calls use `fetchWithRetry` from `BaseScout.ts`:

```typescript
// Retry logic:
// - 429 / 503 (transient): retry with exponential backoff, max 3 attempts
// - 400 / 401 / 403 / 404 (permanent): throw immediately, do NOT retry
// - Circuit breaker: 5 consecutive failures → pause Scout for 30 minutes

async function fetchWithRetry(url: string, options?: RequestInit, maxAttempts = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    if ([400, 401, 403, 404].includes(res.status)) throw new Error(`HTTP ${res.status} — permanent failure`);
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 10_000)));
    }
  }
  throw new Error(`Failed after ${maxAttempts} attempts`);
}
```

---

## Disaster Data APIs

### NASA FIRMS — Wildfire

- **Base URL:** `https://firms.modaps.eosdis.nasa.gov/api/`
- **Key endpoint:** `/area/csv/{KEY}/VIIRS_SNPP_NRT/{bbox}/1/{YYYY-MM-DD}`
- **Auth:** Free API key → `NASA_FIRMS_API_KEY` env var
- **Schedule:** Every 10 minutes
- **Rate limit:** No documented hard limit; be polite (5 bboxes per poll cycle)

**Request example:**
```
GET https://firms.modaps.eosdis.nasa.gov/api/area/csv/MYKEY/VIIRS_SNPP_NRT/94,-11,145,25/1/2026-03-24
```

**Response:** CSV with columns:
```
latitude,longitude,bright_t31,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
-3.421,104.213,298.5,0.38,0.38,2026-03-24,0732,S,VIIRS,h,2.0NRT,298.5,87.3,D
```

**Pre-filtering (before publishing to Redis):**
- `frp < 10` → skip (agricultural/small burns)
- `confidence === 'l'` → skip (low confidence)

**Severity formula:** `Math.min(frp / 1000, 1.0)` (1000 MW = severity 1.0)

**Dedup key:** `firms_{acq_date}_{acq_time}_{lat.3dp}_{lng.3dp}` — TTL 2 hours

**Error cases:**
- HTML error page returned instead of CSV when API key is invalid — check that response starts with `latitude` before parsing
- Empty CSV (no fires) = only header row — check `rows.length <= 1`

---

### NOAA NHC — Tropical Storms

- **Base URL:** `https://www.nhc.noaa.gov/`
- **Key endpoints:**
  - `CurrentStorms.json` — active storm list
  - `nhc_at1.xml` — Atlantic RSS feed (advisory details)
  - `nhc_ep1.xml` — Eastern Pacific RSS feed
- **Auth:** None required
- **Schedule:** Every 30 minutes
- **Rate limit:** No documented limit; respectful polling is fine

**`CurrentStorms.json` response structure:**
```json
{
  "activeStorms": [
    {
      "id": "al022026",
      "name": "Bertha",
      "classification": "HU",
      "intensity": "120",
      "pressure": "952",
      "latitude": "18.5N",
      "longitude": "72.3W",
      "movementDir": "315",
      "movementSpeed": "12",
      "lastUpdate": "2026-03-24T12:00:00Z",
      "publicAdvisory": { "advNum": "14" }
    }
  ]
}
```

**Coordinate parsing:**
```typescript
// NHC uses cardinal directions in coordinate strings
const lat = parseFloat(coord.replace('N','').replace('S', match => '-' + match.slice(1)));
// For longitude: NHC Atlantic/E Pacific storms are always W — negate
const lng = -(parseFloat(coord.replace('W','').replace('E', match => '-' + match.slice(1))));
```

**Severity formula:** `Math.min(parseInt(intensity_knots) / 137, 1.0)` (137 knots = Category 5 max)

**Event ID:** `{storm.id}_{advisory_number}` — new advisory = new event (tracks storm progression)

**Seasonal behavior:** Off-season (Dec–May Atlantic), `activeStorms` is an empty array. Scout polls but publishes nothing. This is correct behavior.

---

### USGS NWIS — Flood Gauges

- **Base URL:** `https://waterservices.usgs.gov/nwis/`
- **Key endpoint:** `/iv/?sites={site_codes}&parameterCd=00060&format=json`
- **Auth:** None required
- **Schedule:** Every 15 minutes
- **Rate limit:** No documented hard limit; query only the pre-filtered site list

**Parameter codes:**
- `00060` = discharge in cubic feet per second (cfs)
- `00065` = gage height in feet (optional supplemental)

**Request example:**
```
GET https://waterservices.usgs.gov/nwis/iv/?sites=02084469,02085070&parameterCd=00060&format=json
```

**Response structure (simplified):**
```json
{
  "value": {
    "timeSeries": [
      {
        "sourceInfo": {
          "siteName": "NEUSE RIVER NEAR GOLDSBORO NC",
          "siteCode": [{ "value": "02089000" }],
          "geoLocation": {
            "geogLocation": { "latitude": 35.38, "longitude": -78.02 }
          }
        },
        "variable": { "variableName": "Streamflow, ft&#179;/s" },
        "values": [{ "value": [{ "value": "12500", "dateTime": "2026-03-24T14:30:00.000-05:00" }] }]
      }
    ]
  }
}
```

**Flood stage thresholds:** Stored in `server/src/scouts/usgs-sites.json` — one object per pre-selected site with `{ siteCode, siteName, lat, lng, floodStageCfs }`.

**Severity formula:** `Math.min((currentCfs - floodStageCfs) / floodStageCfs, 1.0)` — percent above flood stage, capped at 1.0

**Pre-filtering:** Only query the ~50–100 sites in `usgs-sites.json`. Never query all 11,000 active gauges.

---

### US Drought Monitor

- **Base URL:** `https://droughtmonitor.unl.edu/DmData/GISData.aspx`
- **Key endpoint:** `?mode=table&aoi=county&statistic=0&date={YYYY-MM-DD}`
- **Auth:** None required
- **Schedule:** Thursday 10:30 AM CT (data releases ~10 AM CT each Thursday)
- **Rate limit:** No documented limit; weekly requests are trivial

**Response:** CSV with columns:
```
FIPS,State,County,None,D0,D1,D2,D3,D4,ValidStart,ValidEnd
48113,TX,Dallas,0.0,0.0,0.0,0.0,100.0,0.0,20260320,20260326
```

**Columns D0–D4:** Percent of county in each drought category (sum = 100)
- D0: Abnormally Dry
- D1: Moderate Drought
- D2: Severe Drought
- D3: Extreme Drought ← trigger threshold
- D4: Exceptional Drought ← trigger threshold

**Trigger:** `D3 > 0 OR D4 > 0` AND FIPS code is in `server/src/scouts/drought-fips.json` (counties near IUCN habitats)

**Severity formula:** `(parseFloat(D3) + parseFloat(D4)) / 100`

**Date parameter:** Use the most recent Thursday's date. Find it with:
```typescript
const today = new Date();
const dayOfWeek = today.getDay(); // 0=Sun, 4=Thu
const daysToLastThursday = dayOfWeek >= 4 ? dayOfWeek - 4 : dayOfWeek + 3;
const lastThursday = new Date(today.getTime() - daysToLastThursday * 86_400_000);
```

---

### NOAA Coral Reef Watch

- **Base URL:** `https://coralreefwatch.noaa.gov/`
- **Key endpoint:** `vs/gauges/crw_vs_alert_areas.json` — current bleaching alert polygons
- **Auth:** None required
- **Schedule:** Every 6 hours
- **Rate limit:** No documented limit

**Response structure:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[136.0, 8.0], [138.0, 8.0], [138.0, 10.0], [136.0, 10.0], [136.0, 8.0]]]
      },
      "properties": {
        "alert_level": 2,
        "alert_label": "Bleaching Alert Level 1",
        "max_dhw": 8.4
      }
    }
  ]
}
```

**Alert levels:**
- 0: No Stress
- 1: Bleaching Watch
- 2: Bleaching Warning ← trigger threshold
- 3: Bleaching Alert Level 1
- 4: Bleaching Alert Level 2

**Trigger:** `alert_level >= 2`

**Severity formula:** `alert_level / 4`

**Coordinates:** Use polygon centroid as the event coordinate:
```typescript
function computeCentroid(coords: number[][]): { lat: number; lng: number } {
  const lng = coords.reduce((s, p) => s + p[0]!, 0) / coords.length;
  const lat = coords.reduce((s, p) => s + p[1]!, 0) / coords.length;
  return { lat, lng };
}
```

---

## Species / Habitat APIs

### IUCN Red List

- **Auth:** Free token → `IUCN_API_TOKEN` env var (used only for shapefile download portal login)
- **Primary use:** Bulk shapefile download (one-time setup, loaded into PostGIS via `loadIUCNShapefiles.ts`)
- **Live API use:** NONE — the v3 and v4 APIs are inaccessible to automated scripts (see below)

**Downloaded data:**
- `MAMMALS_TERRESTRIAL_ONLY.shp` — species range polygons for all terrestrial mammals
- Filtered to CR + EN on load. Stored in PostGIS `species_ranges` table.
- This is the authoritative source for habitat geometry. It does not contain narrative text.

**Why the live API is not used:**
- v3 API (`apiv3.iucnredlist.org`): Blocked by Cloudflare for all automated HTTP clients
- v4 API (`api.iucnredlist.org`): `/narrative` endpoint returns 404 — does not exist in v4
- IUCN Data Repository (`iucnredlist.org/resources/data-repository`): Only paper-specific datasets, no general bulk narrative export

**Species narrative text** (habitat descriptions, threats, conservation measures) is sourced from
GBIF instead — see below.

---

### GBIF Species API

- **Base URL:** `https://api.gbif.org/v1/`
- **Auth:** None required
- **Rate limit:** No hard limit for `/species` single-record lookups (occurrence search is different)
- **Used by:** `scripts/ingest/ingestSpeciesFacts.ts` (one-time setup) + `HabitatAgent` (live)
- **User-Agent:** Set to `wildlife-sentinel/1.0 (conservation monitoring)` per GBIF best practices

**Endpoints used for species narrative ingest:**
```
GET /v1/species/match?name={scientific_name}
  → { usageKey, matchType, confidence }
  → matchType 'NONE' means no match — skip species

GET /v1/species/{usageKey}/descriptions?limit=50
  → { results: [{ type, language, description, source }] }
  → type values used: biology_ecology, conservation, distribution, activity, food_feeding, breeding
  → filter to language='eng' and description length ≥ 50 chars
```

**Section type mapping (GBIF → DB section_type):**
| GBIF `type` | DB `section_type` |
|---|---|
| `biology_ecology` (first entry) | `habitat` |
| `biology_ecology` (subsequent) | `ecology` |
| `conservation` | `conservation_status` |
| `distribution` | `geographic_range` |
| `activity` | `ecology` |
| `food_feeding` | `diet` |
| `breeding` | `ecology` |

**Why GBIF for narrative text:**
GBIF aggregates content from peer-reviewed mammal taxonomy monographs (e.g. Wilson & Mittermeier
*Handbook of the Mammals of the World*). For mammals, coverage and quality is equivalent to IUCN
narratives. Returns 6–9 sections per species including obscure CR/EN taxa.

**Endpoint used for recent sightings (HabitatAgent):**
```
GET /v1/occurrence/search
  decimalLatitude, decimalLongitude, radius (meters), hasCoordinate=true,
  hasGeospatialIssue=false, year=last 2 years, limit=10
```

**Request parameters:**
```
decimalLatitude    <- center lat
decimalLongitude   <- center lng
radius             <- in meters (50000 = 50km)
hasCoordinate      <- true (filter out records without coordinates)
hasGeospatialIssue <- false (filter out known bad coordinates)
year               <- e.g. "2024,2025" (last 2 years)
limit              <- 10 is sufficient per species
```

**Response:**
```json
{
  "results": [{
    "key": 12345,
    "scientificName": "Pongo abelii Lesson, 1827",
    "decimalLatitude": 3.42,
    "decimalLongitude": 97.12,
    "eventDate": "2024-11-15",
    "datasetName": "Global Biodiversity Facility",
    "occurrenceID": "urn:uuid:abc123"
  }],
  "count": 1,
  "endOfRecords": true
}
```

---

### Open-Meteo Weather

- **Base URL:** `https://api.open-meteo.com/v1/forecast`
- **Auth:** None required
- **Rate limit:** No documented limit for free tier

**Request:**
```
GET https://api.open-meteo.com/v1/forecast
  ?latitude={lat}
  &longitude={lng}
  &hourly=wind_speed_10m,wind_direction_10m,precipitation_probability
  &forecast_days=1
  &wind_speed_unit=kmh
```

**Response:**
```json
{
  "latitude": -3.42,
  "longitude": 104.21,
  "hourly": {
    "time": ["2026-03-24T00:00", "2026-03-24T01:00", ...],
    "wind_speed_10m": [12.3, 13.1, ...],
    "wind_direction_10m": [225, 230, ...],
    "precipitation_probability": [5, 5, 10, ...]
  }
}
```

Use index `[0]` for the current hour's values.

---

## AI APIs (all via ModelRouter.ts)

### Anthropic — Claude Sonnet 4.6

- **SDK:** `@anthropic-ai/sdk`
- **Auth:** `ANTHROPIC_API_KEY` env var
- **Used by:** Threat Assessment, Synthesis, Refiner agents

**Key SDK call:**
```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: systemPrompt,
  messages: [{ role: 'user', content: userMessage }],
});
const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
const { input_tokens, output_tokens } = response.usage;
```

**Pricing (March 2026):** ~$3.00/M input, ~$15.00/M output tokens

---

### Google AI — Gemini 2.5 Flash & Flash-Lite

- **SDK:** `@google/generative-ai`
- **Auth:** `GOOGLE_AI_API_KEY` env var
- **Flash:** Gemini 2.5 Flash — free tier 10 RPM / 250 RPD — Species Context Agent
- **Flash-Lite:** Gemini 2.5 Flash-Lite — free tier 15 RPM / 1,000 RPD — Enrichment + Habitat agents

**Key SDK call:**
```typescript
const model = genai.getGenerativeModel({
  model: 'gemini-2.5-flash-lite',
  systemInstruction: systemPrompt,
  generationConfig: { maxOutputTokens: 256, responseMimeType: 'application/json' },
});
const result = await model.generateContent(userMessage);
const text = result.response.text();
const usage = result.response.usageMetadata;
```

**JSON mode:** Set `responseMimeType: 'application/json'` to get clean JSON without markdown fences. Essential for agents that parse LLM output as JSON.

---

### Google AI — text-embedding-004

- **SDK:** `@google/generative-ai` (same SDK as Gemini)
- **Auth:** Same `GOOGLE_AI_API_KEY`
- **Dimensions:** 768
- **Free tier:** Available via Google AI Studio key (confirm current rate limits)

**Key SDK call:**
```typescript
const model = genai.getGenerativeModel({ model: 'text-embedding-004' });
const result = await model.embedContent(text);
const embedding: number[] = result.embedding.values; // 768 floats
```

**Critical:** Use the same model at both ingest time AND query time. If you ingest with `text-embedding-004` and query with anything else, similarity scores will be meaningless.

---

## Error Handling Summary

| Error Type | HTTP Status | Action |
|---|---|---|
| Transient (overloaded) | 429, 503 | Retry with exponential backoff (max 3 attempts) |
| Permanent (bad request) | 400, 401, 403, 404 | Log and throw — do NOT retry |
| Network timeout | N/A | Treat as transient — retry |
| Circuit open | N/A | Skip scout for 30 minutes |
| All failures | Any | Log to `pipeline_events` as 'error', post to #sentinel-ops, do NOT crash process |
