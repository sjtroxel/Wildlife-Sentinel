# Phase 10 — Expansions & Enhancements

**Goal:** Post-launch improvements. This phase is a living backlog — items are added as they're identified after Phase 9 ships. Not all items need to ship together; they can be batched into sub-releases.

**Status:** In progress — Tracks 1 (bug fixes) and 2 (resizable panels) complete as of 2026-04-06. See PHASE_10_IMPLEMENTATION_PLAN.md for full status.
**Depends on:** Phase 9 complete (system deployed and stable)
**Priority:** Bonus / expansion — system is fully functional at Phase 9 without any of this

---

## How This Phase Works

Unlike Phases 0–9 (which have defined scopes), Phase 10 is a **rolling backlog**. Add items here when you identify something worth building post-launch. Group related items and tackle them in batches.

---

## Expansion Area 0A — Pipeline Pause/Resume (HIGH PRIORITY — portfolio demo QoL)

Discord slash commands `/pause`, `/resume`, `/status` to stop scout agents from publishing new events
overnight or during off hours. Prevents unnecessary LLM charges while the demo is unattended.

**Status:** ✅ COMPLETE (2026-04-07)

**Implementation:**
- `BaseScout.run()` checks `pipeline:paused` Redis key before publishing — covers all 5 scouts
- `/pause` sets the key, `/resume` deletes it, `/status` reports state
- Commands registered as guild slash commands (instant, no propagation delay)
- Requires `DISCORD_CLIENT_ID` env var on Railway

---

## Expansion Area 0 — Data Source Hardening (HIGH PRIORITY)

### Lesson Learned in Phase 9
Data source endpoint failures were discovered post-deploy rather than pre-build. NOAA CRW's VS polygon
endpoint moved (`/vs/gauges/crw_vs_alert_areas.json` → `/product/vs/vs_polygons.json`) with a schema
change (Polygon → Point, `alert_level: number` → `alert: string`). Only caught because it was logging
404 noise in #sentinel-ops after launch.

**Root cause:** The Phase 0 checklist verified API *keys* but not endpoint *health*. Add to Phase 0
spec as a manual verification step before any Phase 1+ implementation.

### A — Endpoint canary check (add to Phase 0 spec)

Manual verification before any Phase 1 work:
```bash
curl -s "https://firms.modaps.eosdis.nasa.gov/api/country/csv/<KEY>/VIIRS_SNPP_NRT/World/1/$(date +%Y-%m-%d)" | head -3
curl -s "https://nhc.noaa.gov/CurrentStorms.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print('NHC OK')"
curl -s "https://waterservices.usgs.gov/nwis/iv/?format=json&parameterCd=00060&sites=01646500" | python3 -c "import sys,json; print('USGS OK')"
curl -s "https://coralreefwatch.noaa.gov/product/vs/vs_polygons.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'CRW: {len(d[\"features\"])} stations')"
```

Also add a `server/tests/integration/scoutEndpoints.test.ts` with `describe.skip` — run manually
pre-deploy to verify all sources are live. See phase-0-foundation.md for the updated checklist item.

### B — Persist circuit breaker state in Redis

`BaseScout.consecutiveFailures` is in-memory and resets to 0 on process restart. Every Railway redeploy
re-triggers the error log for any broken endpoint.

**Fix:** Store circuit open/failures keys in Redis with TTL (see BaseScout.ts). This keeps the circuit
open across restarts — broken endpoint silences itself without per-deployment noise.

### C — `/health/scouts` endpoint

Expose per-scout circuit state so ops can see which scouts are healthy without reading logs:
```json
GET /health/scouts
{
  "nasa_firms":       { "status": "healthy", "consecutiveFailures": 0 },
  "coral_reef_watch": { "status": "circuit_open", "openUntil": "2026-04-02T18:30:00Z" }
}
```
Also surface in the frontend's Agent Activity panel.

---

## Expansion Area 1 — Global Data Sources

Phase 4 shipped three scouts with limited geographic coverage as a deliberate MVP trade-off. This area replaces them with global equivalents.

| Phase 4 Scout | Coverage Gap | Replacement |
|---|---|---|
| NOAA NHC | Atlantic + E. Pacific only | IBTrACS or GDACS (all ocean basins) |
| USGS NWIS | US only | GloFAS / Copernicus (global river discharge) |
| US Drought Monitor | US only | GRACE-FO or CHIRPS (global drought indices) |

NASA FIRMS (wildfire) and NOAA Coral Reef Watch are already global — no replacement needed.

### 1a. Tropical Cyclone — Global Coverage

**Replace:** `NhcScout.ts`
**Target source:** IBTrACS (International Best Track Archive for Climate Stewardship) real-time feed, or direct RSMC feeds:
- RSMC Tokyo (Western Pacific typhoons)
- RSMC New Delhi (North Indian Ocean)
- RSMC La Réunion (South Indian Ocean)
- BOM (Australian region)

**Alternative:** GDACS (Global Disaster Alert and Coordination System) tropical cyclone RSS — single endpoint covering all basins.

**What this unlocks:** Philippine typhoon impacts on tamaraw, pygmy tarsier. Bay of Bengal cyclone impacts on Irrawaddy dolphin, Bengal tiger. Australian cyclones on northern quoll, cassowary.

### 1b. Flood Gauges — Global Coverage

**Replace:** `UsgsScout.ts` + `usgs-sites.json`
**Target source:** GloFAS (Global Flood Awareness System) — Copernicus/ECMWF
- API: `cds.climate.copernicus.eu` (free registration required)
- Provides global river discharge forecasts and flood alerts

**Alternative:** NASA GFMS (same infrastructure as FIRMS, familiar auth pattern)

**What this unlocks:** Amazon (tapir, giant river otter), Congo (forest elephant, gorilla, bonobo), Mekong (Irrawaddy dolphin, giant catfish), Ganges (river dolphin, gharial).

**Implementation note:** Replace static `usgs-sites.json` with a dynamic PostGIS query at startup — find all gauge stations within 75km of any species range. Eliminates hand-maintained static files entirely.

### 1c. Drought — Global Coverage

**Replace:** `DroughtScout.ts` + `drought-fips.json`
**Options (evaluate at implementation time):**
- **GRACE-FO** (NASA): satellite groundwater anomaly, global, monthly cadence
- **CHIRPS**: precipitation anomaly, ~5-day updates, higher temporal resolution
- **GDACS drought alerts**: single endpoint, same pattern as cyclone replacement

**What this unlocks:** Sub-Saharan Africa (African elephant, black rhino, cheetah), Australian outback (bilby, numbat), Central Asian steppes (snow leopard, saiga antelope).

### Migration Strategy for Global Scout Swaps

Build new scouts alongside existing ones. Run both in parallel for 2 weeks to compare event volumes and quality. Disable the old scout once the new one is validated. This allows rollback without any pipeline disruption — the `RawDisasterEvent` schema and all downstream agents are unchanged.

---

## Expansion Area 2 — Frontend Enhancements

Items to improve the Next.js frontend beyond the Phase 8 baseline.

- **Alert history / archive page** — searchable past alerts, filterable by event type, threat level, or species
- **Map layer toggles** — show/hide event types, habitat polygons, GBIF sighting markers independently
- **Dark mode** — Tailwind CSS v4 dark theme variant
- **Alert detail page** — `/alerts/[id]` with full agent reasoning, confidence breakdown, Refiner score history for that event
- **Species profile pages** — `/species/[slug]` — static-generated pages for each species in the DB, showing range map + recent alerts

---

## Expansion Area 3 — Pipeline Enhancements

- **Weekly digest automation** — every Sunday, Synthesis Agent generates a weekly summary of the past 7 days' alerts, posted to #wildlife-alerts (moved here from Phase 9 if not shipped there)
- **Multi-species event correlation** — detect when multiple species in the same habitat are threatened by the same event and generate a combined alert instead of N individual ones
- **Historical trend analysis** — dashboard widget showing threat frequency by region over time

---

## Expansion Area 4 — Additional Data Sources

New disaster or habitat data streams beyond the original five:
- **Seismic events** (USGS Earthquake Hazards Program) — for species in tectonically active habitats
- **Oil spill alerts** (NOAA Emergency Response) — marine and coastal species
- **Deforestation alerts** (Global Forest Watch / GLAD alerts) — near-real-time forest loss detection
- **Air quality** (AirNow / OpenAQ) — for species sensitive to smoke and particulate matter

---

## How to Add New Items

Add a bullet to the relevant area above with:
- What it is (1 line)
- Why it's worth doing (species/habitats unlocked, or user value)
- Any known implementation constraints

Don't over-spec items until they're about to be built.
