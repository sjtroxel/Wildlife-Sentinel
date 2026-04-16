# Phase 10 — Expansions & Enhancements

**Goal:** Post-launch improvements. This phase is a living backlog — items are added as they're identified after Phase 9 ships. Not all items need to ship together; they can be batched into sub-releases.

**Status:** In progress — Expansions 0A–4E complete as of 2026-04-16. Next: Expansion 5A/5B (architectural complexity — revisit when ready). See PHASE_10_IMPLEMENTATION_PLAN.md for full status.
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

### B — Persist circuit breaker state in Redis ✅ COMPLETE (2026-04-08)

`circuit:failures:<name>` (INCR + EXPIRE) and `circuit:open_until:<name>` (SETEX) in Redis.
TTL = `circuitOpenMinutes * 60` seconds on both keys. Circuit survives Railway redeploys.

### C — `/health/scouts` endpoint ✅ COMPLETE (2026-04-08)

`GET /health/scouts` — returns `status: ok | degraded | tripped`, `consecutiveFailures`, and
`circuitOpenUntil` for each of the 5 scouts. Always HTTP 200 (observability, not liveness).
Frontend Agent Activity panel surface deferred to Expansion 2.

---

## Expansion Area 1 — Global Data Sources

Phase 4 shipped three scouts with limited geographic coverage as a deliberate MVP trade-off. This area replaces them with global equivalents.

| Phase 4 Scout | Coverage Gap | Replacement |
|---|---|---|
| NOAA NHC | Atlantic + E. Pacific only | IBTrACS or GDACS (all ocean basins) |
| USGS NWIS | US only | GloFAS / Copernicus (global river discharge) |
| US Drought Monitor | US only | GRACE-FO or CHIRPS (global drought indices) |

NASA FIRMS (wildfire) and NOAA Coral Reef Watch are already global — no replacement needed.

### 1a. Tropical Cyclone — Global Coverage ✅ COMPLETE (2026-04-08)

**Approach:** Supplemented (not replaced) `NhcScout.ts` — both run in parallel.
**Source:** GDACS `geteventlist/TC` endpoint — single JSON feed covering all ocean basins.
**Scout:** `GdacsScout.ts`, `source: 'gdacs'`, 30-min schedule, same dedup/circuit-breaker pattern.
**Migration:** NhcScout retained for Atlantic/E. Pacific continuity. Disable NhcScout once GDACS is validated over 2+ weeks.

**What this unlocks:** Philippine typhoon impacts on tamaraw, pygmy tarsier. Bay of Bengal cyclone impacts on Irrawaddy dolphin, Bengal tiger. Australian cyclones on northern quoll, cassowary.

### 1b. Flood Gauges — Global Coverage ✅ COMPLETE (2026-04-08)

**Approach:** Supplemented (not replaced) `UsgsScout.ts` — both run in parallel.
**Source:** GDACS `geteventlist/FL` endpoint — global major flood events.
**Scout:** `GdacsFloodScout.ts`, `source: 'gdacs_flood'`, 30-min schedule.
**Severity:** `alertscore / 3.0` (GDACS composite, 0–3); falls back to alertlevel map (Green=0.25, Orange=0.60, Red=0.90) when alertscore is absent.
**Note:** GloFAS (Copernicus CDS) would provide more granular river discharge data but requires a Python CDS client — not practical for TypeScript. GDACS covers major flood events globally. UsgsScout retained for fine-grained US gauge data.

**What this unlocks:** Amazon (tapir, giant river otter), Congo (forest elephant, gorilla, bonobo), Mekong (Irrawaddy dolphin, giant catfish), Ganges (river dolphin, gharial).

### 1c. Drought — Global Coverage ✅ COMPLETE (2026-04-08)

**Approach:** Supplemented (not replaced) `DroughtScout.ts` — both run in parallel.
**Source:** GDACS `geteventlist/DR` endpoint — global active drought events.
**Scout:** `GdacsDroughtScout.ts`, `source: 'gdacs_drought'`, every 6 hours.
**Severity:** `alertscore / 3.0`; fallback alertlevel map (Green=0.25, Orange=0.60, Red=0.90).
**Note:** GRACE-FO (monthly) and CHIRPS (NetCDF/GeoTIFF) are impractical for TypeScript without a wrapper service. GDACS covers declared major drought events. DroughtScout retained for fine-grained US county-level D3/D4 data.

**What this unlocks:** Sub-Saharan Africa (African elephant, black rhino, cheetah), Australian outback (bilby, numbat), Central Asian steppes (snow leopard, saiga antelope).

### Migration Strategy for Global Scout Swaps

Build new scouts alongside existing ones. Run both in parallel for 2 weeks to compare event volumes and quality. Disable the old scout once the new one is validated. This allows rollback without any pipeline disruption — the `RawDisasterEvent` schema and all downstream agents are unchanged.

---

## Expansion Area 2 — Frontend Enhancements

Items to improve the Next.js frontend beyond the Phase 8 baseline.

- ✅ **2A — Alert detail page** — `/alerts/[id]` with full agent reasoning, confidence breakdown, Refiner score history. Discord embeds gain clickable title link via `embed.setURL()`. (2026-04-09)
- ✅ **2B — Dark mode** — Tailwind CSS v4 `@custom-variant dark` + system-preference default + manual toggle (localStorage). (2026-04-10)
- ✅ **2C — Map layer toggles** — show/hide event types independently; toggle state in DisasterMap, prop-drilled to DisasterMapInner. (2026-04-10)
- ✅ **2D — Alert history / archive page** — `/alerts` filterable by event type, threat level; paginated with "Load more". (2026-04-10)
- ✅ **2E — Species profile pages** — `/species/[slug]` — dynamic pages per species in DB, showing range map + recent alerts. `/species` index lists all monitored species ordered by IUCN threat status. (2026-04-11)
- ✅ **2F — Discord `/species` slash command** — Color-coded embed with IUCN status, alert count, centroid, link to web profile. Autocomplete queries `species_ranges` as user types (up to 25 suggestions). (2026-04-11)
- ✅ **2G — Discord `/help` slash command** — Onboarding embed: system description, channel guide, threat level key, all slash commands. Static content, no DB queries. (2026-04-11)

---

## Expansion Area 3 — Pipeline Enhancements

- ✅ **Weekly digest automation** — already shipped in weeklyDigest.ts (Phase 9)
- ✅ **3A — Multi-species event correlation** — `correlationKey()` in EnrichmentAgent.ts; 0.45° bins (~50km), 1h TTL Redis key per `(event_type, cell)`; duplicate events dropped before any LLM work begins. (2026-04-12)
- ✅ **3B — Historical trend analysis** — `GET /stats/trends?days=30`, stacked BarChart widget (recharts), Discord `/trends [days]` slash command. (2026-04-13)

---

## Expansion Area 4 — Additional Global Data Sources

New disaster or habitat data streams beyond the original scouts. All five are genuinely global in coverage — no US-only sources. Ordered by build priority.

### 4A — Seismic Events (USGS Earthquake Hazards Program)

**Source:** `https://earthquake.usgs.gov/fdsnws/event/1/query` — JSON REST API, free, no auth.
**Scout:** `UsgsEarthquakeScout.ts`, `source: 'usgs_earthquake'`, `event_type: 'earthquake'`, every 15 min.
**Filter:** `minmagnitude=5.5` — below this threshold habitat damage is minimal.
**Severity:** `(magnitude - 5.5) / 3.5` clamped 0–1 (M5.5 → 0.0, M9.0 → 1.0).
**What this unlocks:** Mountain gorilla near Virunga (DRC), Sumatran rhino/orangutan near Sumatra subduction zone, giant panda in Sichuan seismic belt, snow leopard in Hindu Kush/Karakoram.

### 4B — Volcanic Eruptions (Smithsonian Global Volcanism Program)

**Source:** GVP Weekly Volcanic Activity Report + USGS Volcano Hazards Program JSON feed.
**Scout:** `GvpVolcanoScout.ts`, `source: 'gvp_volcano'`, `event_type: 'volcanic_eruption'`, every 6 hours.
**Filter:** Alert level `Orange` or `Red` only (Yellow = unrest, not eruption).
**Severity:** `normal=0.5, orange=0.7, red=1.0` from USGS aviation color code.
**What this unlocks:** Galápagos finches/tortoises near active calderas, Hawaiian honeycreeper, mountain gorillas near Nyiragongo, Sumatran species near Sinabung/Merapi. Island endemic species are uniquely vulnerable — no escape corridor.

### 4C — Desert Locust Swarms (FAO Desert Locust Watch) ~~DROPPED~~

**Status:** DROPPED (2026-04-15) — `locust.fao.org` DNS dead, no viable replacement found.

### 4D — Deforestation Alerts (Global Forest Watch / GLAD) ✅ COMPLETE (2026-04-16)

**Source:** GFW Integrated Alerts API (`resourcewatch.org` — GLAD-L + GLAD-S2 + RADD fusion). Auth via `GFW_API_KEY` (Resource Watch account, key expires 2027-04-13).
**Scout:** `GladDeforestationScout.ts`, `source: 'glad_deforestation'`, `event_type: 'deforestation'`, 24h cron at 08:00 UTC.
**Implementation:** Queries `gadm__integrated_alerts__adm1_daily_alerts` — confidence IN ('high','highest'), primary forest only, ≥50 alerts/region/day. `gladRegions.json` bundled lookup: (iso, adm1_int) → centroid (lat, lng, name) for 16 tropical forest countries. Dedup key: `glad_{ISO}_{adm1}_{YYYYMMDD}` — 7-day TTL.
**Severity:** `high=0.75, highest=0.95`. SOURCE_QUALITY=0.88. Brown `#78350f` map markers.
**What this unlocks:** Highest conservation impact of any addition — Amazon (giant river otter, jaguar, tapir), Congo Basin (forest elephant, bonobo, okapi), Borneo/Sumatra (orangutan, pygmy elephant, clouded leopard), Mesoamerica (Baird's tapir, scarlet macaw). Deforestation is the #1 driver of species extinction globally.

### 4E — Sea Ice Extent (NSIDC) ✅ COMPLETE (2026-04-16)

**Source:** NSIDC Near-Real-Time Sea Ice Index v3 — daily extent CSV, publicly accessible, no auth.
**Scout:** `NsidcSeaIceScout.ts`, `source: 'nsidc_sea_ice'`, `event_type: 'sea_ice_loss'`, 24h cron at 09:00 UTC.
**Implementation:** Fetches `N_seaice_extent_daily_v3.0.csv` and `S_seaice_extent_daily_v3.0.csv` for both hemispheres. Compares most recent reading against bundled `seaIceClimatology.json` (1981–2010 monthly median + std_dev). Fires when sigma ≤ -1.0 (extent more than 1σ below median). Weekly dedup key prevents daily spam during persistent anomaly periods.
**Severity:** `|sigma| / 3.0` clamped to 1.0. SOURCE_QUALITY=0.92 (satellite passive microwave — highly reliable).
**Coordinates:** Arctic (80°N, 0°E) — Svalbard area; Antarctic (-73°S, 0°E) — Weddell Sea area.
**Color:** Icy blue `#bfdbfe` — map markers + trend chart.
**What this unlocks:** An entire class of species with zero prior coverage — polar bear, walrus, narwhal, ringed seal (Arctic); emperor penguin, Weddell seal, leopard seal (Antarctic).

---

### Future — Expansion 5 (Architectural Complexity — Revisit After 4A–4E)

These two are compelling but require more design thought before building:

**5A — ENSO Anomaly Declarations (NOAA CPC)**
NOAA's Climate Prediction Center issues El Niño/La Niña watches, advisories, and declarations. Unlike the scouts above, ENSO is a *macro-signal* — not a point-event at a coordinate, but a global condition that cascades across dozens of ecosystems simultaneously (coral bleaching, Galápagos prey collapse, African drought, Pacific salmon disruption). Requires a different pipeline pattern: a system-wide risk assessment trigger rather than a single `RawDisasterEvent`. High value, novel framing, worth solving the architecture.

**5B — Illegal Fishing in MPAs (Global Fishing Watch)**
GFW has a public API (free research tier) tracking fishing vessel AIS transponder data globally. The scout would flag vessels detected fishing inside IUCN Marine Protected Area polygons already stored in PostGIS. Unlocks a wholly different threat class — **anthropogenic, not natural disaster** — for marine species: whale shark, manta ray, sea turtle, vaquita. Requires spatial intersection of vessel tracks against MPA boundaries in PostGIS; may warrant a separate `anthropogenic:alerts` stream distinct from `disaster:raw`.

---

## How to Add New Items

Add a bullet to the relevant area above with:
- What it is (1 line)
- Why it's worth doing (species/habitats unlocked, or user value)
- Any known implementation constraints

Don't over-spec items until they're about to be built.
