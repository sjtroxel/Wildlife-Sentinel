# API Integrations — Wildlife Sentinel

*Stub — expand with exact endpoint details, response schemas, and error handling patterns during Phase 1–4 implementation.*

---

## Disaster Data APIs

### NASA FIRMS (Phase 1)
- Base: `https://firms.modaps.eosdis.nasa.gov/api/`
- Key endpoint: `/area/csv/{KEY}/VIIRS_SNPP_NRT/{bbox}/1/{date}`
- Auth: Free API key → `NASA_FIRMS_API_KEY` env var
- Rate limit: generous, no documented hard limit
- Response: CSV with lat, lon, bright_t31, frp, acq_date, acq_time, confidence, satellite
- Pre-filter: FRP > 10 MW, confidence = 'nominal' or 'high'

### NOAA NHC (Phase 4)
- Active storms JSON: `https://www.nhc.noaa.gov/CurrentStorms.json`
- RSS Atlantic: `https://www.nhc.noaa.gov/nhc_at1.xml`
- RSS E Pacific: `https://www.nhc.noaa.gov/nhc_ep1.xml`
- Auth: None required
- Response: Storm center, track, wind speed, forecast cone

### USGS NWIS (Phase 4)
- Base: `https://waterservices.usgs.gov/nwis/iv/`
- Key params: `parameterCd=00060` (discharge) or `00065` (gage height), `format=json`
- Auth: None required
- Trigger: gauge reading > flood stage threshold (per-site, in response metadata)
- High volume — pre-filter by bounding boxes near IUCN habitats

### US Drought Monitor (Phase 4)
- Base: `https://droughtmonitor.unl.edu/DmData/GISData.aspx`
- GeoJSON weekly: `?mode=table&aoi=county&statistic=0&date=YYYY-MM-DD`
- Auth: None required
- Update: Every Thursday ~10 AM CT
- Trigger: County drought worsens to D3+ AND county contains IUCN habitat

### NOAA Coral Reef Watch (Phase 4)
- Product: 5km CoralTemp bleaching alert area
- Auth: None required
- Format: CSV / GeoJSON products
- Trigger: Bleaching Alert Level 1+

---

## Species / Habitat APIs

### IUCN Red List API
- Base: `https://apiv3.iucnredlist.org/api/v3/`
- Auth: Free token → `IUCN_API_TOKEN` env var
- Key endpoint: `/species/category/{category}` — list by threat status
- **Primary use: bulk shapefile download (pre-loaded into PostGIS)**
- Live API: fallback for species metadata not in PostGIS

### GBIF Occurrence API (Phase 2)
- Base: `https://api.gbif.org/v1/`
- Key endpoint: `/occurrence/search?decimalLatitude=&decimalLongitude=&radius=50000&limit=10`
- Auth: None required for read
- Response: Darwin Core occurrence records with coordinates + date + species name

### Open-Meteo Weather (Phase 1)
- Base: `https://api.open-meteo.com/v1/forecast`
- Key params: `latitude=&longitude=&hourly=wind_speed_10m,wind_direction_10m,precipitation_probability&forecast_days=1`
- Auth: None required
- Response: Hourly forecast arrays

---

## AI APIs (all via ModelRouter.ts)

### Anthropic (Claude Sonnet 4.6)
- SDK: `@anthropic-ai/sdk`
- Auth: `ANTHROPIC_API_KEY` env var
- Used by: Threat Assessment, Synthesis, Refiner agents

### Google AI (Gemini 2.5 Flash / Flash-Lite + text-embedding-004)
- SDK: `@google/generative-ai`
- Auth: `GOOGLE_AI_API_KEY` env var
- Gemini 2.5 Flash-Lite: Enrichment + Habitat agents (free tier: 1,000 RPD)
- Gemini 2.5 Flash: Species Context agent (free tier: 250 RPD)
- text-embedding-004: RAG embeddings (free tier)

---

## Error Handling Patterns

All external API calls:
1. Retry with exponential backoff (max 3 attempts) for 429/503 errors
2. Do NOT retry 400/401/404 — these are permanent failures
3. On permanent failure: log to `pipeline_events` as 'error', post to #sentinel-ops, do NOT crash
4. Circuit breaker: if 5 consecutive failures from same API, pause that Scout for 30 min

*Detailed retry logic to be implemented in Phase 1 Scout agent base class.*
