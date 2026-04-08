# Phase 10 Implementation Plan — Expansions & Enhancements

## Context

Phase 9 complete as of 2026-04-05. System is live end-to-end:
- Backend: `https://wildlife-sentinel.up.railway.app`
- Frontend: `https://wildlife-sentinel.vercel.app`
- Pipeline firing real alerts. 20 alerts in DB as of 2026-04-05.

Phase 10 is a **rolling backlog** — not a fixed scope. Items are grouped into tracks and expansion areas. Near-term tracks address confirmed bugs and polish from the Phase 9 smoke test. Expansion areas are larger improvements added as the system matures post-launch.

See also `PHASE_10_EXPANSIONS.md` for the living backlog document.

---

## Completed ✅

### Expansion 0C — `/health/scouts` Endpoint (2026-04-08)

- ✅ `GET /health/scouts` added to `server/src/routes/health.ts`
- ✅ Reads `circuit:failures:<name>` and `circuit:open_until:<name>` from Redis for all 5 scouts
- ✅ Returns `status: ok | degraded | tripped`, `consecutiveFailures`, and `circuitOpenUntil` per scout
- ✅ Always HTTP 200 — observability endpoint, not a liveness signal
- ✅ 3 new test cases in `server/tests/health.test.ts`

### Expansion 0B — Circuit Breaker Redis Persistence (2026-04-08)

- ✅ Removed in-memory `consecutiveFailures` and `circuitOpenUntil` fields from `BaseScout`
- ✅ Failure counter stored as `circuit:failures:<name>` via INCR + EXPIRE (TTL = circuitOpenMinutes)
- ✅ Circuit state stored as `circuit:open_until:<name>` via SETEX (same TTL)
- ✅ On success: DEL `circuit:failures:<name>` resets the counter
- ✅ Circuit survives Railway redeploys for its full intended duration, then auto-expires
- ✅ `del`, `incr`, `expire` added to all 5 scout test file redis mocks; circuit breaker tests rewritten with stateful mock closures
- ✅ 241 tests passing

### Expansion 0A — Pipeline Pause/Resume (2026-04-07)

- ✅ Discord slash commands: `/pause`, `/resume`, `/status`
- ✅ All 5 scout `run()` methods + all agent loops check `pipeline:paused` Redis key before processing
- ✅ `DISCORD_CLIENT_ID` env var required on Railway (bot's Application ID)
- ✅ `deferReply()` acknowledges within 3s, `editReply()` with result
- ✅ Messages queue safely in Redis Streams while paused; no data loss

### Track 4 — Cost Visibility (2026-04-07)

- ✅ Weekly digest already included cost line in `server/src/discord/weeklyDigest.ts`

### Track 3 — Sentinel-Ops Noise Reduction (2026-04-07)

- ✅ `HabitatAgent.ts`: `logToWarRoom` gated on `sightingCount > 0`
- ✅ 0-sighting GBIF lookups now log to `console.log` only — no war room noise

### Pipeline Hardening + Cost Reduction (2026-04-07)

- ✅ All 3 Claude agents (ThreatAssessment, Synthesis, Refiner) switched to `CLAUDE_HAIKU` (~3.75x cheaper than Sonnet) — **do not revert**
- ✅ ThreatAssessmentAgent `maxTokens` 512 → 1500 (was causing JSON truncation)
- ✅ FirmsScout dedup TTL 2h → 7 days
- ✅ ThreatAssembler assembly TTL 1h → 24h
- ✅ FirmsScout FRP minimum 10 → 25 MW (filters weak/spurious detections)
- ✅ FirmsScout event ID coordinate precision `toFixed(3)` → `toFixed(2)` (~1.1km grid, deduplicates adjacent pixels from same fire)
- ✅ Threat assessment system prompt updated in Neon: CRITICAL requires severity > 10%, low-intensity fires at 0km → HIGH not CRITICAL
- ✅ HIGH alerts now route through HITL (#sentinel-ops review) same as CRITICAL
- ✅ UUID bug fixed: ThreatAssessmentAgent INSERT uses RETURNING id; `db_alert_id` field added to `AssessedAlert` type

### Track 1 — Bug Fixes (2026-04-05/06)

**Root cause:** `coordinates`, `severity`, and `confidence_score` come back from postgres as strings (postgres.js only auto-parses JSONB columns, not JSON). The `AlertRow` type declared the right types but the raw DB response didn't match.

**Fix location:** `server/src/routes/alerts.ts` — normalizes the three fields before `res.json()`.

- ✅ **Alert click → broken page** — Was a runtime crash: expanding an alert tried `string.lat.toFixed()` → `undefined.toFixed` → TypeError → Next.js error page. Fixed by parsing coordinates correctly.
- ✅ **Alert markers missing from map** — `circleMarker([undefined, undefined])` silently failed. Map marker code in `DisasterMapInner.tsx` Effect 3 was already complete — it just needed valid coordinates. Fixed by same route change.
- ✅ **TypeScript errors in alerts.test.ts** — Pre-existing `as never` cast missing on all `mockResolvedValueOnce` calls. Fixed. New test added for string→object coordinates parsing.

**296 tests passing.**

### Track 2 — Resizable Panels (2026-04-06)

- ✅ Installed `react-resizable-panels@4.9.0` (v4 API: `Group`, `Panel`, `Separator`)
- ✅ `client/app/page.tsx` rewritten with drag-to-resize panel dividers
- ✅ Mobile (< 1024px): vertical `Group` — map (40% default) / alerts (35%) / agent activity (15%) / refiner chart (10%). All draggable.
- ✅ Desktop (≥ 1024px): horizontal `Group` (map 65% | right column 35%) with nested vertical `Group` inside the right column.
- ✅ Layout auto-switches on `window.matchMedia('(min-width: 1024px)')` resize.
- ✅ Build passes.

---

## Expansion Area 0 — Data Source Hardening (HIGH PRIORITY)

### Lesson Learned in Phase 9

NOAA CRW's VS polygon endpoint moved after Phase 4 shipped, only caught from 404 noise in #sentinel-ops post-launch. The Phase 0 checklist verified API *keys* but not endpoint *health*.

### 0A — Endpoint canary checks (add to Phase 0 spec)

Add manual verification before any Phase 1+ work (update `phase-0-foundation.md`):

```bash
curl -s "https://firms.modaps.eosdis.nasa.gov/api/country/csv/<KEY>/VIIRS_SNPP_NRT/World/1/$(date +%Y-%m-%d)" | head -3
curl -s "https://nhc.noaa.gov/CurrentStorms.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print('NHC OK')"
curl -s "https://waterservices.usgs.gov/nwis/iv/?format=json&parameterCd=00060&sites=01646500" | python3 -c "import sys,json; print('USGS OK')"
curl -s "https://coralreefwatch.noaa.gov/product/vs/vs_polygons.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'CRW: {len(d[\"features\"])} stations')"
```

Add `server/tests/integration/scoutEndpoints.test.ts` with `describe.skip` — run manually pre-deploy to verify all sources are live.

### 0B — Persist circuit breaker state in Redis ✅ COMPLETE (2026-04-08)

See Completed section above.

### 0C — `/health/scouts` endpoint ✅ COMPLETE (2026-04-08)

See Completed section above.

**Future:** Surface scout health in the frontend Agent Activity panel (`client/components/AgentActivity.tsx`) — deferred to Expansion 2.

---

## Expansion Area 1 — Global Data Sources

Phase 4 shipped scouts with limited geographic coverage as a deliberate MVP trade-off.

| Scout | Coverage Gap | Replacement |
|---|---|---|
| `NhcScout.ts` | Atlantic + E. Pacific only | IBTrACS or GDACS (all ocean basins) |
| `UsgsScout.ts` | US only | GloFAS / Copernicus (global river discharge) |
| `DroughtScout.ts` | US only | GRACE-FO or CHIRPS (global drought indices) |

NASA FIRMS and NOAA Coral Reef Watch are already global — no replacement needed.

**Migration strategy:** Build new scouts alongside existing ones. Run both in parallel for 2 weeks to compare event volumes. Disable the old scout once the new one is validated. `RawDisasterEvent` schema and all downstream agents are unchanged — zero pipeline disruption.

### 1A — Tropical Cyclone: Global Coverage

**Replace:** `NhcScout.ts`

**Target:** GDACS (Global Disaster Alert and Coordination System) tropical cyclone RSS — single endpoint covering all ocean basins. Alternatively, direct RSMC feeds (Tokyo, New Delhi, La Réunion, BOM).

**Species unlocked:** Philippine tamaraw + pygmy tarsier (Pacific typhoons), Irrawaddy dolphin + Bengal tiger (Bay of Bengal cyclones), northern quoll + cassowary (Australian cyclones).

### 1B — Flood Gauges: Global Coverage

**Replace:** `UsgsScout.ts` + `usgs-sites.json`

**Target:** GloFAS (Global Flood Awareness System) via Copernicus/ECMWF CDS API (`cds.climate.copernicus.eu` — free registration). Alternative: NASA GFMS (familiar auth pattern from FIRMS).

**Implementation note:** Replace static `usgs-sites.json` with a dynamic PostGIS query at startup — find all gauge stations within 75km of any species range. Eliminates the hand-maintained static file.

**Species unlocked:** Amazon (giant river otter, tapir), Congo (forest elephant, gorilla, bonobo), Mekong (Irrawaddy dolphin, giant catfish), Ganges (river dolphin, gharial).

### 1C — Drought: Global Coverage

**Replace:** `DroughtScout.ts` + `drought-fips.json`

**Target options (evaluate at build time):**
- GRACE-FO (NASA): satellite groundwater anomaly, global, monthly cadence
- CHIRPS: precipitation anomaly, ~5-day updates, higher temporal resolution
- GDACS drought alerts: same pattern as cyclone replacement — simplest integration

**Species unlocked:** Sub-Saharan Africa (African elephant, black rhino, cheetah), Australian outback (bilby, numbat), Central Asian steppes (snow leopard, saiga antelope).

---

## Expansion Area 2 — Frontend Enhancements

### 2A — Map Layer Toggles

Show/hide map layers independently: event type markers, habitat polygons, GBIF sighting markers. Small toggle panel in the map corner (already has the light/dark toggle as a model).

### 2B — Alert Detail Page

`/alerts/[id]` — full agent reasoning, confidence breakdown, compounding factors, Refiner score history for that specific event (if the Refiner has run on it). Server-rendered with `generateStaticParams` for known alert IDs, fallback to dynamic for new ones.

**Prerequisite:** The alert click in AlertsFeed currently expands inline. Add a "View full detail →" link to the expanded view instead of navigating on the initial click.

### 2C — Alert History / Archive Page

`/alerts` — searchable/filterable list of all past alerts. Filter by event type, threat level, species, or date range. Paginated. Read-only.

### 2D — Species Profile Pages

`/species/[slug]` — one page per species in the DB. Shows:
- IUCN status + range map (from PostGIS polygon)
- Recent alerts involving this species
- Refiner accuracy score trend for predictions about this species

Statically generated at build time (`generateStaticParams` from DB query).

### 2E — Dark Mode

Tailwind CSS v4 dark theme. The map already supports light/dark tile layers — extend this to the full UI. Use the `prefers-color-scheme` media query as the default; add a manual toggle in the header.

---

## Expansion Area 3 — Pipeline Enhancements

### 3A — Multi-Species Event Correlation

When multiple species in the same habitat are threatened by the same event, generate one combined alert instead of N individual ones. The ThreatAssembler currently assembles per-event — add a correlation pass that groups co-located events within a configurable radius (e.g. 50km) and time window (e.g. 1 hour).

### 3B — Historical Trend Analysis

Dashboard widget: threat frequency by region over time. Query `alerts` table grouped by `event_type` and month. Display as a simple line chart (same library as RefinerChart).

---

## Expansion Area 4 — Additional Data Sources

New disaster streams beyond the original five. Add as separate scouts following the same `BaseScout` pattern.

| Source | Why |
|---|---|
| USGS Earthquake Hazards (`earthquake.usgs.gov/fdsnws/event/1/`) | Species in tectonically active habitats (Sumatran rhino, Javan rhino — near active fault zones) |
| NOAA Emergency Response (oil spill alerts) | Marine and coastal species (sea turtles, marine iguanas, seabirds) |
| Global Forest Watch / GLAD alerts | Near-real-time deforestation detection — the slow disaster no other scout covers |
| AirNow / OpenAQ | Species sensitive to wildfire smoke + particulate (great apes, mountain gorilla) |

---

## Session Strategy

| Session | Work |
|---|---|
| A ✅ | Track 1 — bug fixes (coordinates parsing, map markers, alert click crash) |
| B ✅ | Track 2 — resizable panels (react-resizable-panels v4) |
| C ✅ | Track 3 + 4 — sentinel-ops noise + cost line; pipeline hardening + cost reduction |
| D ✅ | Expansion 0A — Discord pause/resume/status slash commands |
| E ✅ | Expansion 0B + 0C — Redis circuit breaker persistence + /health/scouts endpoint |
| F | Expansion 1A — global cyclone scout (GDACS) |
| G | Expansion 1B — global flood scout (GloFAS) |
| H | Expansion 1C — global drought scout |
| I | Expansion 2B — alert detail page |
| J | Expansion 2A + 2E — map layer toggles + dark mode |
| K | Expansion 4 — additional scouts (seismic, oil spill, deforestation, air quality) |

**Next session: F — Expansion 1A (global cyclone coverage via GDACS)**
