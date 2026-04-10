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

### Expansion 2C — Map Layer Toggles (2026-04-10)

- ✅ `DisasterMap.tsx` rewritten as stateful wrapper: holds `activeLayers: Set<EventType>`, renders per-type toggle buttons (top-left overlay, `z-1000`)
- ✅ `DisasterMapInner.tsx`: accepts `activeLayers` prop; markers placed into per-type `L.LayerGroup`; Effect 4 shows/hides groups reactively
- ✅ `page.tsx` dynamic import unchanged — `ssr: false` still covers the entire module

### Expansion 2B — Dark Mode (2026-04-10)

- ✅ `globals.css`: `@custom-variant dark (&:where(.dark, .dark *))` — class-based dark variant
- ✅ `layout.tsx`: anti-flash inline script reads `localStorage` + `prefers-color-scheme` before hydration
- ✅ `ThemeToggle.tsx` (new): lazy `useState` initializer reads `.dark` class; toggle flips class on `<html>` + writes `localStorage`
- ✅ `page.tsx`: ThemeToggle in header; logo uses `dark:hidden`/`dark:block` on two `<Image>` tags; all panel border/bg classes updated
- ✅ `AlertsFeed`, `AgentActivity`, `RefinerChart`: light defaults + `dark:` prefixes throughout
- ✅ Fixed pre-existing lint error: `setIsDesktop` in `useEffect` → lazy `useState` initializer

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

**Implementation order:** 2A → 2B → 2C → 2D → 2E (defer 2E to fresh session if context gets tight)

**Key insight driving ordering:** Discord alerts are getting long and clunky. Making the embed title a clickable link to a detail page keeps embeds tight while offering full observability on the web. This makes 2A the highest-impact item.

---

### 2A — Alert Detail Page + Discord Embed Link

**Problem to solve:** Key alert data (species names, compounding factors, recommended action, habitat distance) is only passed through Redis Streams — it is NOT currently persisted to the `alerts` table. Without fixing this, the detail page can only show coordinates + threat level.

#### Backend changes

**`server/src/agents/ThreatAssessmentAgent.ts`** — Expand the INSERT (~line 183) to persist more data:
```typescript
// enrichment_data: add species detail
JSON.stringify({
  weather: event.weather_summary,
  habitats: event.nearby_habitat_ids,
  species_at_risk: event.species_at_risk,
  habitat_distance_km: event.habitat_distance_km,
  species_status: event.species_briefs[0]?.iucn_status ?? null,
})

// prediction_data: add compounding factors + recommended action
JSON.stringify({
  predicted_impact: parsed.predicted_impact,
  reasoning: parsed.reasoning,
  compounding_factors: Array.isArray(parsed.compounding_factors) ? parsed.compounding_factors : [],
  recommended_action: parsed.recommended_action ?? null,
})
```
Old rows gracefully degrade — missing fields render as "N/A" on the detail page.

**`server/src/config.ts`** — Add optional `FRONTEND_URL` using the existing `optionalEnv()` pattern:
```typescript
frontendUrl: optionalEnv('FRONTEND_URL', ''),
```
Empty string = embed URL disabled. No Railway redeploy needed immediately.

**`server/src/agents/SynthesisAgent.ts`** — After `new EmbedBuilder()` is constructed, add:
```typescript
if (config.frontendUrl) {
  embed.setURL(`${config.frontendUrl}/alerts/${assessed.db_alert_id}`);
}
```
`setURL()` makes the embed title a clickable hyperlink in Discord — no extra real estate used.

**`server/src/routes/alerts.ts`** — Add `GET /alerts/:id` endpoint:
- Full alert: all columns including `enrichment_data`, `prediction_data`, `discord_message_id`
- LEFT JOIN `refiner_scores` → return as `refiner_scores: RefinerScoreRow[]` array
- Parse JSONB fields same pattern as `/recent` (postgres.js returns JSON columns as strings)
- Return 404 if UUID not found

**`server/tests/alerts.test.ts`** — Add tests for `/alerts/:id`:
- 200 + correct field shapes (mocked SQL returns one row + one refiner score row)
- 404 for unknown UUID

#### Frontend changes

**`client/lib/api.ts`** — Add `getAlert(id: string): Promise<AlertDetail>`:
```typescript
getAlert: (id) =>
  fetch(`${BASE}/alerts/${id}`).then(r => {
    if (!r.ok) throw new Error('Not found');
    return r.json();
  }),
```

**`client/app/alerts/[id]/page.tsx`** — New `'use client'` detail page:
- **Header:** back link (`← All Alerts`), event type badge, threat level badge, timestamp
- **Hero:** source name, coordinates with copy-to-clipboard
- **Two-column grid (md+):**
  - Left: Threat Assessment card — `predicted_impact`, `reasoning`, `compounding_factors`, `recommended_action`
  - Right: Event metadata card — source, severity, confidence, `habitat_distance_km`, `species_at_risk`, IUCN status
- **Refiner History** (if `refiner_scores.length > 0`): table — evaluation_time, composite_score bar (animate-pulse while pending), correction_note
- **Loading state:** `animate-pulse bg-zinc-800` skeleton cards
- **Error state:** "Alert not found" message + back link

**`client/components/AlertsFeed.tsx`** — Add `<Link>` in the expanded detail panel:
```tsx
<Link href={`/alerts/${alert.id}`} className="inline-block mt-1 text-[10px] text-blue-400 hover:text-blue-300"
  onClick={e => e.stopPropagation()}>
  View full details →
</Link>
```

#### Railway env var (user action after deploy)
Add `FRONTEND_URL=https://wildlife-sentinel.vercel.app` in Railway → server service → Variables. New embeds will have clickable titles. Existing embeds are unaffected.

---

### 2B — Dark Mode (System Preference + Manual Toggle)

**Approach:** Tailwind v4 `@custom-variant` + `.dark` class on `<html>`. System preference is the default; manual toggle stored in `localStorage`.

**`client/app/globals.css`** — Add after `@import`:
```css
@custom-variant dark (&:where(.dark, .dark *));
```
Add light-mode overrides in `:root` / `html:not(.dark)` blocks using CSS variables. The current app is effectively dark-only — light mode is the new addition; dark stays as-is.

**`client/app/layout.tsx`** — Anti-flash inline script in `<head>` (runs before React hydrates):
```tsx
<script dangerouslySetInnerHTML={{ __html: `
  try {
    var s = localStorage.getItem('theme');
    var d = s === 'dark' || (!s && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', d);
  } catch(e) {}
` }} />
```

**`client/components/ThemeToggle.tsx`** — New component:
- `useState` initialized from `localStorage` + `prefers-color-scheme`
- Toggle: flips `.dark` class on `document.documentElement` + writes to `localStorage`
- Button: `☀` / `🌙` emoji, same button style as existing map dark-mode toggle

**Add ThemeToggle to the header in `client/app/page.tsx`.**

**Update components for light mode:** Add `dark:` variants to hardcoded zinc-950/zinc-900 backgrounds + zinc-200/400 text in:
- `client/app/page.tsx` (main bg, panel bg, separator handles)
- `client/components/AlertsFeed.tsx` (list item bg, text colors, badge)
- `client/components/AgentActivity.tsx` (same pattern)
- `client/components/RefinerChart.tsx` (chart bg)

---

### 2C — Map Layer Toggles

**Approach:** Toggle state lives in `DisasterMap.tsx`, prop-drilled to `DisasterMapInner`.

**`client/components/DisasterMap.tsx`** — Add layer state:
```typescript
const [activeLayers, setActiveLayers] = useState<Set<string>>(new Set(EVENT_TYPES));
const toggleLayer = (type: string) => setActiveLayers(prev => {
  const next = new Set(prev);
  next.has(type) ? next.delete(type) : next.add(type);
  return next;
});
```
Overlay UI (absolute positioned, `z-1000`, top-left of map — same corner pattern as existing dark-mode button):
```tsx
<div className="absolute top-2 left-2 z-1000 flex flex-wrap gap-1">
  {EVENT_TYPES.map(type => (
    <button key={type} onClick={() => toggleLayer(type)}
      style={{ borderColor: EVENT_COLORS[type] }}
      className={`text-[10px] px-2 py-1 rounded border font-medium transition-opacity
        ${activeLayers.has(type) ? 'opacity-100' : 'opacity-30'}`}>
      {type.replace(/_/g, ' ')}
    </button>
  ))}
</div>
```
Pass `activeLayers` as prop to the dynamically-imported `DisasterMapInner`.

**`client/components/DisasterMapInner.tsx`** — Accept `activeLayers: Set<string>` prop. In the marker-rendering loop:
```typescript
if (!activeLayers.has(alert.event_type)) return; // skip hidden layer
```
Update the dynamic import component wrapper in `DisasterMap.tsx` to forward the prop.

---

### 2D — Alert History / Archive Page

**`server/src/routes/alerts.ts`** — Add `GET /alerts` with optional query params:
- `event_type`, `threat_level` — exact match filters (validated against known enums)
- `limit` (default 50, max 100), `offset` (default 0) — pagination
- Returns same `AlertRow` shape as `/recent` for type safety

**`client/lib/api.ts`** — Add `getAlerts(filters: AlertFilters): Promise<AlertRow[]>`.

**`client/app/alerts/page.tsx`** — New `'use client'` archive page:
- **Filter bar** (mobile: stacked, md+: inline row): Event Type dropdown, Threat Level dropdown, Clear Filters button
- **Results list:** same card style as AlertsFeed rows, each linking to `/alerts/[id]`
- **Pagination:** "Load more" button (increments offset by 50, appends to existing results)
- **Empty state:** "No alerts match these filters"

Note: `app/alerts/page.tsx` and `app/alerts/[id]/page.tsx` coexist cleanly — Next.js App Router handles both routes.

**`server/tests/alerts.test.ts`** — Add tests for `GET /alerts` with each filter param.

---

### 2E — Species Profile Pages (defer to fresh session if context tight)

**Backend:**
- `GET /species` — distinct species names from `species_ranges` (sorted alphabetically)
- `GET /species/:slug` — species detail: IUCN status, recent alerts where `enrichment_data->>'species_at_risk'` contains species name

**Frontend:**
- `client/app/species/page.tsx` — species grid/index
- `client/app/species/[slug]/page.tsx` — individual species: range map (Leaflet, `dynamic`/`ssr:false`) + recent alerts list
- Slug convention: species name lowercased, spaces → hyphens (`panthera-tigris`)

---

### Critical Files for Expansion 2

| File | Change |
|---|---|
| `server/src/agents/ThreatAssessmentAgent.ts` | Expand enrichment_data + prediction_data in INSERT |
| `server/src/agents/SynthesisAgent.ts` | `embed.setURL()` using FRONTEND_URL + db_alert_id |
| `server/src/config.ts` | Add optional `frontendUrl` via `optionalEnv()` |
| `server/src/routes/alerts.ts` | Add `GET /alerts/:id` and `GET /alerts` (filtered) |
| `server/tests/alerts.test.ts` | Tests for both new endpoints |
| `client/lib/api.ts` | Add `getAlert(id)` and `getAlerts(filters)` |
| `client/app/alerts/[id]/page.tsx` | New — alert detail page |
| `client/app/alerts/page.tsx` | New — alert archive page |
| `client/app/globals.css` | `@custom-variant dark` + light mode CSS vars |
| `client/app/layout.tsx` | Anti-flash script + ThemeToggle in header |
| `client/components/ThemeToggle.tsx` | New — dark mode toggle button |
| `client/components/AlertsFeed.tsx` | Add "View full details →" Link in expanded row |
| `client/components/DisasterMap.tsx` | Layer toggle state + overlay UI |
| `client/components/DisasterMapInner.tsx` | Accept + apply `activeLayers` prop |
| `client/components/AgentActivity.tsx` | `dark:` variant updates |
| `client/components/RefinerChart.tsx` | `dark:` variant updates |

### Verification

- `npm test` — all existing 268+ tests pass; new endpoint tests green
- `npm run typecheck` — zero errors
- Navigate to `/alerts/[real-uuid]` — detail page loads with all sections; graceful N/A for old rows missing new fields
- Toggle dark mode — no flash on refresh; `localStorage` persists preference
- Map layer toggles — toggle off Wildfire → fire markers disappear, all other types remain visible
- `/alerts` archive page — filter by event_type and threat_level; "Load more" appends results
- After adding `FRONTEND_URL` to Railway: new Discord embeds have clickable alert titles

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
| F ✅ | Expansion 1A — global cyclone scout (GDACS) |
| G ✅ | Expansion 1B — global flood scout (GDACS FL) |
| H ✅ | Expansion 1C — global drought scout (GDACS DR) |
| I ✅ | Expansion 2A — alert detail page + Discord embed link (2026-04-09) |
| J | Expansion 2B + 2C — dark mode + map layer toggles |
| K | Expansion 2D — alert history/archive page |
| L | Expansion 2E — species profile pages |
| M | Expansion 4 — additional scouts (seismic, oil spill, deforestation, air quality) |

**Session J ✅ Complete — Expansion 2B (dark mode) + 2C (map layer toggles) (2026-04-10)**

**Next session: K — Expansion 2D (alert history/archive page)**
