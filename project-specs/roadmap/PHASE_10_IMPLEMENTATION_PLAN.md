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

### 2G — Discord `/help` Slash Command ✅ COMPLETE (2026-04-11)

- ✅ `server/src/discord/helpContent.ts` — `SLASH_COMMANDS` array; embed rebuilt from array so adding a command is one line
- ✅ `/help` registered in commands.ts alongside `/pause`, `/resume`, `/status`, `/species`
- ✅ `bot.ts` handles `interactionCreate` for `/help`: `deferReply()` → `editReply({ embeds: [embed] })`
- ✅ `FRONTEND_URL` set → web dashboard field added to embed; unset → field omitted
- ✅ `server/tests/discord/helpCommand.test.ts` — embed fields test; conditional dashboard field test

### 2F — Discord `/species` Slash Command ✅ COMPLETE (2026-04-11)

- ✅ `/species <name>` registered with `addStringOption` + `setAutocomplete(true)`
- ✅ Lookup by slug or common name; fallback "not found" reply
- ✅ Second query: alert count for species via `enrichment_data @> jsonb_build_array($name)`
- ✅ Embed: IUCN-color-coded, common name title, Latin binomial description, status/alert count/centroid fields; `setURL()` to web profile when `FRONTEND_URL` set
- ✅ Autocomplete: `ILIKE %input%` on both name fields, `DISTINCT ON`, up to 25 results
- ✅ `server/tests/discord/speciesCommand.test.ts` — found → embed, not found → error, autocomplete suggestions

### 2E — Species Profile Pages ✅ COMPLETE (2026-04-10)

**Backend (`server/src/routes/species.ts` — new, registered in `app.ts`):**
- `GET /species?limit=50&offset=0` — distinct species from `species_ranges`, ordered by IUCN severity (CR→EN→VU→NT→LC), then name. Slug derived via `REPLACE(LOWER(species_name), ' ', '-')`.
- `GET /species/:slug` — species detail: name, common name, IUCN status, centroid (`ST_X`/`ST_Y` on `ST_Centroid(ST_Collect(geom))`), range GeoJSON (`ST_AsGeoJSON(ST_Collect(geom))::jsonb`), recent alerts via `enrichment_data->'species_at_risk' @> jsonb_build_array($name)`.
- Returns 404 if slug matches no species; 400 if slug contains non-`[a-z0-9-]` characters.

**Shared (`shared/types.d.ts`):** Added `SpeciesListItem`, `SpeciesDetail`.

**Client:**
- `client/lib/api.ts` — `getSpeciesList(limit, offset)` and `getSpecies(slug)` added.
- `client/app/species/page.tsx` — responsive card grid (1 col → 2 col → 3 col), IUCN badge, paginated "Load more".
- `client/app/species/[slug]/page.tsx` — detail: IUCN status badge, Leaflet range map, recent alerts list (each linking to `/alerts/[id]`). Skeleton loading + 404 error state.
- `client/components/SpeciesRangeMapInner.tsx` — Leaflet map: green range polygon (`L.geoJSON`), auto-fit bounds, dark/light tile toggle (mirrors `DisasterMapInner` pattern).
- `client/components/SpeciesRangeMap.tsx` — `dynamic()` wrapper (`ssr: false`).
- `client/app/page.tsx` header — "Alerts" and "Species" nav links added.

**Tests:** `server/tests/routes/species.test.ts` — 10 tests (list, detail, 404, 400 validation, numeric normalization).

**349 tests passing.**

---

### 2F — Discord `/species` Slash Command

**Goal:** Give Discord users a way to look up any monitored species directly in the bot, without leaving Discord. Returns a rich embed: species name, IUCN status (color-coded), centroid, recent alert count, and a link to the web profile page.

#### Command definition

```typescript
new SlashCommandBuilder()
  .setName('species')
  .setDescription('Look up a monitored species')
  .addStringOption(opt =>
    opt.setName('name')
       .setDescription('Common name or Latin binomial (e.g. "Sumatran Orangutan" or "pongo abelii")')
       .setRequired(true)
       .setAutocomplete(true)
  )
```

#### Lookup logic

Convert the user's input to a slug (`toLowerCase().replace(/ /g, '-')`), then run:
```sql
SELECT species_name, MAX(common_name) AS common_name, MAX(iucn_status) AS iucn_status,
       MAX(iucn_species_id) AS iucn_species_id,
       REPLACE(LOWER(species_name), ' ', '-') AS slug
FROM species_ranges
WHERE REPLACE(LOWER(species_name), ' ', '-') = $slug
   OR LOWER(common_name) = LOWER($input)
GROUP BY species_name
LIMIT 1
```

If not found, reply with "Species not found. Try `/species Sumatran Orangutan`."

#### Recent alert count

Second query:
```sql
SELECT COUNT(*)::int AS alert_count
FROM alerts
WHERE threat_level IS NOT NULL
  AND enrichment_data->'species_at_risk' @> jsonb_build_array($speciesName::text)
```

#### Embed structure

```typescript
const iucnColors: Record<IUCNStatus, number> = {
  EX: 0x3f3f46, EW: 0x52525b, CR: 0xdc2626,
  EN: 0xea580c, VU: 0xd97706, NT: 0xca8a04, LC: 0x16a34a,
};

const embed = new EmbedBuilder()
  .setColor(iucnColors[species.iucn_status] ?? 0x6b7280)
  .setTitle(`${species.common_name ?? species.species_name}`)
  .setDescription(`*${species.species_name}*`)
  .addFields(
    { name: 'IUCN Status', value: `**${species.iucn_status}** · ${IUCN_LABEL[species.iucn_status]}`, inline: true },
    { name: 'Alerts (all time)', value: String(alertCount), inline: true },
    { name: 'Range Centroid', value: `${centroid.lat.toFixed(2)}°, ${centroid.lng.toFixed(2)}°`, inline: true },
  )
  .setFooter({ text: 'Wildlife Sentinel · IUCN Red List / GBIF' });

if (config.frontendUrl && species.slug) {
  embed.setURL(`${config.frontendUrl}/species/${species.slug}`);
}
```

#### Autocomplete handler

When `interaction.isAutocomplete()` and `commandName === 'species'`:
```sql
SELECT DISTINCT ON (COALESCE(common_name, species_name))
  species_name, common_name
FROM species_ranges
WHERE common_name ILIKE ${'%' + input + '%'}
   OR species_name ILIKE ${'%' + input + '%'}
ORDER BY COALESCE(common_name, species_name)
LIMIT 25
```
Return as `{ name: common_name ?? species_name, value: (common_name ?? species_name).toLowerCase() }` — the `value` is what gets sent when the user selects it.

#### Files to change

| File | Change |
|---|---|
| `server/src/discord/commands.ts` (or equivalent) | Register `/species` command alongside `/pause`, `/resume`, `/status` |
| `server/src/discord/bot.ts` | Handle `interactionCreate` for `/species` command + autocomplete |
| `server/src/db/speciesQueries.ts` (new, or inline) | `lookupSpecies(input)` + `getSpeciesAlertCount(name)` |
| `server/tests/discord/speciesCommand.test.ts` | Tests: found → embed, not found → error message, autocomplete returns suggestions |

#### Railway action (user)
No new env vars needed. `FRONTEND_URL` is already set (from 2A). The web profile link in the embed will work immediately.

---

### 2G — Discord `/help` Slash Command

**Goal:** Onboard new Discord server members — anyone who joins the server and wonders what Wildlife Sentinel is or what they can do here gets a single command that answers everything.

**Build order:** After 2F, so the commands list in the embed is complete.

#### Command definition

```typescript
new SlashCommandBuilder()
  .setName('help')
  .setDescription('Learn what Wildlife Sentinel does and how to use this bot')
```

No options — no autocomplete needed. Single static response.

#### Embed structure

Three fields organized as a natural onboarding flow:

```typescript
const embed = new EmbedBuilder()
  .setColor(0x16a34a)                           // green — informational, not an alert
  .setTitle('Wildlife Sentinel — Quick Guide')
  .setDescription(
    'An autonomous 24/7 system that monitors global disaster data streams ' +
    '(wildfires, cyclones, floods, drought, coral bleaching) and fires alerts ' +
    'whenever a disaster threatens IUCN-listed critical habitat.'
  )
  .addFields(
    {
      name: '📢 Channels',
      value:
        '**#wildlife-alerts** — Public alerts for medium/high threat events.\n' +
        '**#sentinel-ops** — Pipeline activity + critical alerts awaiting review (react ✅ to approve).',
    },
    {
      name: '⚠️ Reading an Alert',
      value:
        '**CRITICAL / HIGH** — Severe threat, habitat overlap confirmed.\n' +
        '**MEDIUM** — Moderate threat, species at risk identified.\n' +
        '**LOW** — Logged to DB only, not posted here.\n\n' +
        'IUCN status: **CR** = Critically Endangered · **EN** = Endangered · **VU** = Vulnerable',
    },
    {
      name: '🤖 Slash Commands',
      value:
        '`/species <name>` — Look up any monitored species (autocomplete supported).\n' +
        '`/status` — Show pipeline health and whether monitoring is active.\n' +
        '`/pause` / `/resume` — Pause or resume the pipeline (admin only).\n' +
        '`/help` — Show this message.',
    },
  )
  .setFooter({ text: 'Wildlife Sentinel · Data: NASA FIRMS / NOAA / USGS / IUCN' });

if (config.frontendUrl) {
  embed.addFields({
    name: '🌐 Web Dashboard',
    value: `[wildlife-sentinel.vercel.app](${config.frontendUrl}) — Live map, alert archive, species profiles, and prediction accuracy charts.`,
  });
}
```

#### Maintainability: data-driven command list

The commands field should be built from an array, not hardcoded prose, so adding a future slash command is a one-line change:

```typescript
// server/src/discord/helpContent.ts
export const SLASH_COMMANDS = [
  { name: '/species <name>', description: 'Look up any monitored species (autocomplete supported).' },
  { name: '/status',         description: 'Show pipeline health and whether monitoring is active.' },
  { name: '/pause',          description: 'Pause the pipeline (admin only).' },
  { name: '/resume',         description: 'Resume the pipeline (admin only).' },
  { name: '/help',           description: 'Show this message.' },
] as const;

// Used in the embed:
const commandsValue = SLASH_COMMANDS
  .map(c => `\`${c.name}\` — ${c.description}`)
  .join('\n');
```

When a new command ships, add one entry to `SLASH_COMMANDS`. The embed rebuilds automatically. No prose to hunt down and edit.

#### Files to change

| File | Change |
|---|---|
| `server/src/discord/helpContent.ts` (new) | `SLASH_COMMANDS` array + any other static copy that may need updating over time |
| `server/src/discord/commands.ts` (or equivalent) | Register `/help` command alongside others |
| `server/src/discord/bot.ts` | Handle `interactionCreate` for `/help` — build embed from `helpContent.ts`, call `deferReply()` then `editReply({ embeds: [embed] })` |
| `server/tests/discord/helpCommand.test.ts` | Test: command returns embed with correct fields; `FRONTEND_URL` set → web dashboard field present; not set → absent |

**No DB queries. No new env vars.** Entirely self-contained. Fastest command to ship.

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

**Problem:** NASA FIRMS reports large wildfires as many separate pixel events. FirmsScout deduplicates within a ~1.1km grid (toFixed(2) coordinate precision), but a 20km-wide fire generates multiple distinct events that survive dedup. Each flows through the full pipeline — Gemini enrichment, GBIF lookup, Claude Haiku threat assessment + synthesis — and generates a separate Discord alert for the same physical fire.

**Fix:** After the habitat query confirms overlap, check whether a recent event of the same type already passed through the same geographic area. If yes, drop the new event before any expensive downstream work begins.

#### Where to implement

**`EnrichmentAgent.ts`** — after habitat query, before weather fetch.

This is the earliest possible point where we know (a) the event overlaps a habitat, and (b) the event type. Dropping here saves all downstream costs: Gemini weather summary, GBIF lookup, Species Context RAG, Claude Haiku threat + synthesis.

#### Correlation bucket key

```typescript
function correlationKey(event: RawDisasterEvent): string {
  const latBin = (Math.round(event.coordinates.lat / 0.45) * 0.45).toFixed(2);
  const lngBin = (Math.round(event.coordinates.lng / 0.45) * 0.45).toFixed(2);
  return `corr:${event.event_type}:${latBin}:${lngBin}`;
}
```

- 0.45° ≈ 50km bins (equatorial). Matches the spec's 50km radius.
- Key encodes `event_type` so a flood doesn't correlate with a wildfire in the same cell.

#### Check + set in processEvent()

Insert this block **after** the `habitats.length === 0` early return, **before** `fetchWeather()`:

```typescript
// Correlation check — drop duplicate events from the same disaster (50km / 1h window)
const corrKey = correlationKey(event);
const existingId = await redis.get(corrKey);
if (existingId) {
  console.log(`[enrichment] ${event.id} correlated with ${existingId} (${event.event_type} within 50km/1h) — dropping`);
  await logPipelineEvent({
    event_id: event.id,
    source: event.source,
    stage: 'enrichment',
    status: 'filtered',
    reason: `correlated_with:${existingId}`,
  });
  return;
}
await redis.setex(corrKey, 3600, event.id);
```

No new imports needed — `redis` and `logPipelineEvent` are already imported.

#### Redis mock update (test file only)

Add `setex` to the redis mock in `server/tests/agents/EnrichmentAgent.test.ts`:

```typescript
setex: vi.fn().mockResolvedValue('OK'),
```

#### New tests

**Test A** — correlated event is dropped:
- `redis.get` returns an existing event ID
- Verify `redis.xadd` NOT called, `storeEventForAssembly` NOT called
- Verify `logPipelineEvent` called with `status: 'filtered'`, reason containing `'correlated_with'`

**Test B** — non-correlated event proceeds:
- `redis.get` returns `null`
- Verify `redis.setex` called with `corr:wildfire:...` key and TTL `3600`
- Verify `redis.xadd` called normally

**Test C** — different event_type in same cell is not correlated:
- Separate corr keys per event_type — flood at same coords as wildfire proceeds independently

#### Files changed

| File | Change |
|---|---|
| `server/src/agents/EnrichmentAgent.ts` | Add `correlationKey()` helper + check/set block in `processEvent()` |
| `server/tests/agents/EnrichmentAgent.test.ts` | Add `setex` to redis mock; add 3 new correlation tests |

#### Verification

```bash
npm test -- --reporter=verbose
npm run typecheck
```

- All existing EnrichmentAgent tests still pass; 3 new correlation tests green
- Deploy: large active fire → one Discord alert per 1h window instead of multiples

---

### 3B — Historical Trend Analysis ✅ COMPLETE (2026-04-13)

Dashboard widget + Discord `/trends` slash command showing alert frequency breakdown by event type over the last 30 days.

#### Backend

**`server/src/db/statsQueries.ts`** (new) — shared query function:
```typescript
export async function getAlertTrends(days: number): Promise<TrendPoint[]>
```
SQL: `COUNT(*) FILTER (WHERE event_type = ...)` pivot — one row per day, one column per event type.
Normalizes `bigint` → `number` via `parseInt(String(...), 10)`.

**`server/src/routes/stats.ts`** (new):
- `GET /stats/trends?days=30` — default 30, capped at 90, 400 on `days < 1`
- Calls `getAlertTrends(days)`, returns `TrendPoint[]`

**`server/src/app.ts`** — registered `statsRouter` at `/stats`.

**`shared/types.d.ts`** — added `TrendPoint` interface.

#### Frontend

**`client/lib/api.ts`** — added `getTrends(days = 30): Promise<TrendPoint[]>` → `GET /stats/trends`.

**`client/components/TrendChart.tsx`** (new) — recharts `BarChart` (stacked):
- 30-day window; one bar per day; segments colored by event type using `EVENT_COLORS`
- X-axis date labels formatted MM/DD; Y-axis integer counts
- Dark/light styling mirrors `RefinerChart.tsx` pattern
- Renders nothing when data is empty

**`client/app/page.tsx`** — TrendChart added as 4th panel in right column:
- Desktop: AlertsFeed(45%), AgentActivity(18%), RefinerChart(17%), TrendChart(20%)
- Mobile: Map(35%), AlertsFeed(28%), AgentActivity(13%), RefinerChart(12%), TrendChart(12%)

#### Discord

**`server/src/discord/helpContent.ts`** — added `/trends [days]` to `SLASH_COMMANDS`.

**`server/src/discord/bot.ts`**:
- `/trends` command registered with optional `days` integer option (choices: 7, 14, 30, 90)
- `handleTrendsCommand()` calls `getAlertTrends(days)`, sums totals, builds embed:
  - Inline field per event type: count + percentage
  - Footer: total alerts, active days of N
  - `embed.setURL(config.frontendUrl)` when set
  - Plain string reply when total = 0

#### Tests

**`server/tests/routes/stats.test.ts`** (new, 5 tests):
- 200 + trend rows; empty array; days param forwarded; days capped at 90; 400 on days=0

**`server/tests/discord/trendsCommand.test.ts`** (new, 5 tests):
- embed has all 5 event-type fields; correct counts/percentages; empty string when no data;
  footer shows active days; URL omitted when frontendUrl empty

**369 tests passing** (up from 359).

---

## Expansion Area 4 — Additional Global Data Sources

New disaster streams beyond the original scouts. All five are genuinely global. Ordered by build priority.
Oil spill (NOAA ER) and air quality (AirNow) were dropped — US-only coverage, not worth the effort.

| # | Source | Scout | Species Unlocked |
|---|---|---|---|
| 4A ✅ | USGS Earthquake Hazards (`earthquake.usgs.gov/fdsnws`) | `UsgsEarthquakeScout.ts` M5.5+, 15-min | Mountain gorilla near Virunga, giant panda (Sichuan), Sumatran rhino |
| 4B ✅ | GDACS Volcanic Eruptions (via `GdacsRssScout.ts` RSS migration) | Orange/Red only, handled in `GdacsRssScout.ts` 6h | Galápagos finches/tortoises, Hawaiian honeycreeper, gorillas near Nyiragongo |
| 4C ~~DROPPED~~ | FAO Desert Locust Watch — `locust.fao.org` DNS dead, no viable replacement | — | — |
| 4D ✅ | Global Forest Watch GLAD alerts | `GladDeforestationScout.ts` daily (2026-04-16) | Orangutan, jaguar, bonobo, okapi — highest conservation impact addition |
| 4E ✅ | NSIDC Sea Ice Index (daily anomaly trigger) | `NsidcSeaIceScout.ts` daily | Polar bear, walrus, emperor penguin — zero current coverage |

### Expansion 5A — ENSO Anomaly Declarations (NOAA CPC) ✅ COMPLETE (2026-04-16)

See completed section below for implementation notes.

### Future — Expansion 5B (revisit after 5A)

| # | Source | Notes |
|---|---|---|
| 5B | Global Fishing Watch (illegal fishing in MPAs) | Anthropogenic threat class; needs MPA spatial join against PostGIS; needs WDPA MPA polygon ingest |

---

## Expansion 5A — ENSO Anomaly Declarations (NOAA CPC) ✅ COMPLETE (2026-04-16)

### Architecture: Fan-Out + Redis Modifier Pattern

ENSO is not a point event — it's a global climate phase that cascades across dozens of ecosystems simultaneously. The pattern used here:

1. **Fan-out scout**: On active El Niño or La Niña, generate one `RawDisasterEvent` per high-impact ecosystem zone. Each flows through the normal pipeline independently.
2. **Redis modifier**: Scout also sets `enso:current_phase` and `enso:oni_anomaly` keys. The EnrichmentAgent reads these to append ENSO context to the weather summary for ALL events processed during an active ENSO period — zero extra LLM cost.

### Data Source

- URL: `https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt`
- Format: ASCII table — seasonal (3-month) Oceanic Niño Index values, updated monthly
- No auth required

### Phase Classification

| Tier | El Niño (ONI °C) | La Niña (ONI °C) | Severity |
|---|---|---|---|
| Watch | +0.5 to +0.9 | −0.5 to −0.9 | 0.35 |
| Advisory | +1.0 to +1.4 | −1.0 to −1.4 | 0.55 |
| Warning | +1.5 to +1.9 | −1.5 to −1.9 | 0.75 |
| Extreme | ≥ +2.0 | ≤ −2.0 | 0.95 |
| Neutral | −0.5 to +0.5 | — | no events |

### Fan-Out Impact Zones (`ensoImpactZones.json`)

**El Niño zones** (fire when ONI ≥ +0.5):

| Zone ID | Coordinates | Ecosystem | Key Species |
|---|---|---|---|
| `galapagos` | −0.62, −90.42 | Marine food web | Galápagos penguin, marine iguana, Galápagos sea lion |
| `borneo_sumatra` | 0.5, 113.0 | Tropical peat forest | Bornean orangutan, Sumatran tiger, pygmy elephant |
| `peruvian_amazon` | −5.0, −75.0 | Amazonian floodplain | Amazon river dolphin, giant river otter, tapir |
| `east_africa` | −2.5, 37.0 | East African savanna | African elephant, lion, African wild dog |
| `great_barrier_reef` | −18.0, 147.5 | Coral reef (bleaching amplifier) | Dugong, sea turtle, coral |

**La Niña zones** (fire when ONI ≤ −0.5):

| Zone ID | Coordinates | Ecosystem | Key Species |
|---|---|---|---|
| `southern_africa` | −18.0, 30.0 | Southern African savanna | African elephant, black rhino, cheetah |
| `philippine_archipelago` | 12.0, 122.0 | Philippine forests | Philippine eagle, tamaraw, Visayan warty pig |
| `eastern_australia` | −17.0, 145.5 | Queensland rainforest | Cassowary, koala, platypus |
| `amazon_colombia` | 2.0, −67.0 | Northern Amazon | Giant river otter, boto dolphin, Orinoco crocodile |
| `mekong_basin` | 14.0, 105.0 | Mekong floodplain | Irrawaddy dolphin, giant Mekong catfish, gharial |

### Dedup Strategy

Event ID pattern: `enso_{phase}_{tier}_{zone_id}_{YYYYMM}`
Example: `enso_el_nino_advisory_galapagos_202604`

TTL: 28 days — fires once per calendar month per zone per phase+tier. If the phase escalates mid-month (watch → advisory), the new tier ID fires a fresh event for each zone (escalation is conservation-meaningful).

BaseScout's built-in `isDuplicate()`/`markSeen()` handles the dedup: key pattern is `dedup:noaa_cpc:{eventId}`.

### Redis Modifier Keys

Set by scout in `fetchEvents()` on every run regardless of dedup:
- `enso:current_phase`: `'el_nino'` | `'la_nina'` | `'neutral'` — TTL 35 days
- `enso:oni_anomaly`: raw ONI float as string, e.g. `"1.4"` — TTL 35 days
- On neutral phase: both keys deleted (`redis.del`)

### EnrichmentAgent Integration

In `processEvent()`, after correlation check and before `fetchWeather()`, read ENSO keys in parallel:
```typescript
const [ensoPhase, ensoAnomaly] = await Promise.all([
  redis.get('enso:current_phase'),
  redis.get('enso:oni_anomaly'),
]);
```

Pass to `generateWeatherSummary()` as optional extra params. If active ENSO, append to the Gemini user message:
> `"Active El Niño (ONI: +1.4°C) currently in effect — factor compounding climate stress into the summary."`

This costs zero extra LLM calls — it's appended to an existing call.

### Color: Indigo `#6366f1`

Distinct from all 9 existing event type colors. Suggests macro/climate (not a point disaster).

### Files Changed

| File | Change |
|---|---|
| `server/src/scouts/NoaaCpcEnsoScout.ts` | New scout — ONI parse, phase/tier, Redis modifier, fan-out |
| `server/src/scouts/ensoImpactZones.json` | Static El Niño + La Niña zone definitions |
| `shared/types.d.ts` | `'noaa_cpc'` → DisasterSource; `'climate_anomaly'` → EventType; `climate_anomaly: number` → TrendPoint |
| `server/src/scouts/index.ts` | Register + daily 10:00 UTC schedule; startup run included |
| `server/src/routes/health.ts` | Add `'noaa_cpc'` to SCOUT_NAMES (10 scouts total) |
| `server/src/agents/EnrichmentAgent.ts` | Read enso keys; pass ENSO context to generateWeatherSummary() |
| `server/src/db/statsQueries.ts` | Add `climate_anomaly` column to trend pivot query |
| `client/components/DisasterMapInner.tsx` | Add `climate_anomaly` to EVENT_TYPES + `'#6366f1'` to EVENT_COLORS |
| `client/components/DisasterMap.tsx` | Add `climate_anomaly` to EVENT_TYPES array |
| `client/components/TrendChart.tsx` | Add `climate_anomaly` color + label entries |
| `server/tests/scouts/NoaaCpcEnsoScout.test.ts` | New: ~12 tests covering phase/tier, fan-out count, dedup, Redis modifier, neutral, parse failure, circuit breaker |
| `server/tests/agents/EnrichmentAgent.test.ts` | Add `enso:current_phase`/`enso:oni_anomaly` get mock calls; 2 new ENSO context tests |

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
| J ✅ | Expansion 2B + 2C — dark mode + map layer toggles (2026-04-10) |
| K ✅ | Expansion 2D — alert history/archive page (2026-04-10) |
| L ✅ | Expansion 2E — species profile pages (2026-04-10) |
| M ✅ | Expansion 2F — Discord `/species` slash command (2026-04-11) |
| N ✅ | Expansion 2G — Discord `/help` slash command (2026-04-11) |
| O ✅ | Expansion 3A — multi-event correlation in EnrichmentAgent (50km / 1h dedup) (2026-04-12) |
| P ✅ | Expansion 3B — historical trend analysis widget + `/trends` Discord command (2026-04-13) |
| Q ✅ | Expansion 4A — seismic scout (USGS EHP, global M5.5+, purple map markers) (2026-04-14) |
| R ✅ | Expansion 4B — volcanic eruption scout (GDACS VO, Orange/Red only) (2026-04-15) |
| S | ~~Expansion 4C — desert locust scout (FAO)~~ DROPPED — API dead |
| T ✅ | Expansion 4D — deforestation scout (Global Forest Watch GLAD, daily) (2026-04-16) |
| U ✅ | Expansion 4E — sea ice scout (NSIDC NRT Sea Ice Index, daily anomaly trigger) (2026-04-16) |
| V ✅ | Expansion 5A — ENSO declarations (fan-out + Redis modifier pattern) (2026-04-16) |
| W ✅ | Expansion 5B — illegal fishing in MPAs (Global Fishing Watch API) (2026-04-16) |

**Expansions 0A–5B complete (2026-04-16). 434 tests passing.**

---

## Expansion 5B — Illegal Fishing in MPAs (Global Fishing Watch)

### Goal

Add a scout that detects fishing vessels operating inside Marine Protected Areas globally and fires `illegal_fishing` events into the pipeline. This unlocks a wholly different threat class — **anthropogenic, not natural disaster** — covering marine species that have no prior coverage: whale shark, manta ray, sea turtle, vaquita, dugong.

**API:** Global Fishing Watch (`gateway.api.globalfishingwatch.org/v3`) — free research tier, different org from Global Forest Watch.
**New env var (user must set):** `FISHING_WATCH_API_KEY` — register at `globalfishingwatch.org/our-apis/tokens`

---

### Architecture Decision: Curated JSON vs. Full WDPA Ingest

The original spec called for a PostGIS `marine_protected_areas` table loaded from the WDPA bulk dataset. This is impractical for two reasons:

1. **WDPA categories I–IV alone is tens of thousands of polygons** — a full bulk ingest is disproportionate to the value.
2. **Marine species are not in `species_ranges`** — the IUCN shapefile we loaded was "Terrestrial Mammals." Whale shark, manta ray, sea turtle, vaquita have no PostGIS ranges. `EnrichmentAgent`'s `ST_DWithin` would drop every GFW event as "no habitat overlap."

**Adopted approach:** `mpaRegions.json` — curated ~25 critical MPAs (centroids + `radius_km` + `key_species[]`), exactly matching the `gladRegions.json` and `ensoImpactZones.json` patterns. No PostGIS migration needed.

**EnrichmentAgent bypass:** When `event_type === 'illegal_fishing'` and the PostGIS query returns 0 habitats, use `raw_data.key_species` (set by the scout) as `species_at_risk` with `habitat_distance_km: 0`. This is the only `event_type` that needs this bypass — every other scout targets regions where terrestrial species already exist in PostGIS.

The PostGIS `marine_protected_areas` table can be added as a future enhancement for boundary-precision checking.

---

### MPA Regions (`mpaRegions.json`)

25 curated MPAs, selected to cover the four primary target species and their most critical protected ranges:

| ID | Name | Country | Centroid | Radius | Key Species |
|---|---|---|---|---|---|
| `upper_gulf_california` | Upper Gulf of California Biosphere Reserve | MEX | 31.2°N, 114.3°W | 100 km | Vaquita, Gulf totoaba |
| `ningaloo_marine_park` | Ningaloo Marine Park | AUS | 22.7°S, 113.7°E | 100 km | Whale shark, dugong, manta ray |
| `galapagos_marine_reserve` | Galápagos Marine Reserve | ECU | 0.4°S, 90.5°W | 150 km | Whale shark, Galápagos sea lion, manta ray |
| `mafia_island_marine_park` | Mafia Island Marine Park | TZA | 7.9°S, 39.8°E | 60 km | Whale shark, dugong, sea turtle |
| `gladden_spit` | Gladden Spit and Silk Cayes Marine Reserve | BLZ | 16.5°N, 87.4°W | 40 km | Whale shark, sea turtle |
| `komodo_national_park` | Komodo National Park | IDN | 8.6°S, 119.5°E | 80 km | Manta ray, dugong, sea turtle |
| `tubbataha_reef` | Tubbataha Reef Natural Park | PHL | 8.9°N, 119.9°E | 60 km | Manta ray, whale shark, hawksbill sea turtle |
| `chagos_mpa` | Chagos / BIOT Marine Protected Area | GBR | 6.4°S, 71.8°E | 200 km | Manta ray, whale shark, sea turtle |
| `raja_ampat` | Raja Ampat Marine Protected Area Network | IDN | 0.5°S, 130.6°E | 100 km | Manta ray, dugong, whale shark |
| `great_barrier_reef` | Great Barrier Reef Marine Park | AUS | 18.5°S, 148.0°E | 200 km | Dugong, sea turtle, manta ray |
| `shark_bay` | Shark Bay Marine Park | AUS | 25.5°S, 113.5°E | 80 km | Dugong, sea turtle, whale shark |
| `tortuguero` | Tortuguero National Park | CRI | 10.5°N, 83.5°W | 50 km | Green sea turtle, hawksbill sea turtle |
| `archie_carr_nwr` | Archie Carr National Wildlife Refuge | USA | 27.8°N, 80.4°W | 30 km | Loggerhead sea turtle, leatherback sea turtle |
| `turtle_islands` | Turtle Islands Heritage Protected Area | PHL | 6.3°N, 118.2°E | 60 km | Green sea turtle, hawksbill sea turtle |
| `aldabra_atoll` | Aldabra Atoll Special Reserve | SYC | 9.4°S, 46.3°E | 50 km | Green sea turtle, dugong |
| `papahanaumokuakea` | Papahānaumokuākea Marine National Monument | USA | 25.0°N, 170.0°W | 300 km | Hawksbill sea turtle, Hawaiian monk seal |
| `malpelo_sanctuary` | Malpelo Fauna and Flora Sanctuary | COL | 3.9°N, 81.6°W | 60 km | Whale shark, hammerhead shark, manta ray |
| `cocos_island` | Cocos Island National Park | CRI | 5.5°N, 87.1°W | 60 km | Whale shark, hammerhead shark, manta ray |
| `coral_sea_parks` | Coral Sea Marine Park | AUS | 16.0°S, 155.0°E | 200 km | Sea turtle, manta ray, whale shark |
| `phoenix_islands` | Phoenix Islands Protected Area | KIR | 3.5°S, 172.0°W | 150 km | Sea turtle, manta ray, whale shark |
| `cabo_pulmo` | Cabo Pulmo National Park | MEX | 23.4°N, 109.4°W | 30 km | Manta ray, sea turtle, hammerhead shark |
| `flower_garden_banks` | Flower Garden Banks National Marine Sanctuary | USA | 27.9°N, 93.6°W | 40 km | Whale shark, manta ray, sea turtle |
| `mesoamerican_reef` | Mesoamerican Reef | BLZ | 17.0°N, 87.8°W | 150 km | Whale shark, sea turtle, manta ray |
| `similan_islands` | Similan Islands Marine National Park | THA | 8.7°N, 97.6°E | 40 km | Whale shark, manta ray, dugong |
| `bazaruto_archipelago` | Bazaruto Archipelago National Park | MOZ | 21.6°S, 35.5°E | 60 km | Dugong, whale shark, sea turtle |

---

### GFW Events API

**Endpoint:** `GET https://gateway.api.globalfishingwatch.org/v3/events`

**Params per MPA:**
```
datasets[0]=public-global-fishing-events:latest
start-date=YYYY-MM-DD    (yesterday)
end-date=YYYY-MM-DD      (today)
latitude=<centroid.lat>
longitude=<centroid.lng>
radius=<radius_km>
limit=200
offset=0
```

**Auth:** `Authorization: Bearer <FISHING_WATCH_API_KEY>`

**Response:**
```typescript
interface GfwEventsResponse {
  entries: GfwVesselEvent[];
  total: number;
  limit: number;
  offset: number;
}

interface GfwVesselEvent {
  id: string;
  type: string;             // 'fishing'
  position: { lat: number; lon: number };
  start: string;            // ISO 8601
  end: string;
  vessel: {
    id: string;
    ssvid: string;          // MMSI
    flag: string;           // ISO 3-letter country code
  };
}
```

**Severity:** `Math.min(vesselCount / 10.0, 1.0)` — 10+ unique vessels = maximum severity.

**Threshold:** Only fire an event when `vesselCount >= 1`. Any fishing vessel in an MPA is by definition illegal if the MPA prohibits fishing (most IUCN category I–IV MPAs do).

---

### Dedup Strategy

Weekly per MPA — prevents daily spam when the same vessels persistently fish in an area:

```typescript
function weekStartKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

const eventId = `gfw_fishing_${mpa.id}_${weekStartKey(new Date())}`;
// 7-day TTL (BaseScout dedupTtlSeconds = 7 * 24 * 3600)
```

---

### EnrichmentAgent Bypass

Marine species (whale shark, vaquita, etc.) are absent from `species_ranges` (IUCN terrestrial mammals shapefile only). Without a bypass, every `illegal_fishing` event would be dropped at the habitat check.

**Change in `processEvent()`** — after the `habitats.length === 0` check, before the `return`:

```typescript
if (habitats.length === 0) {
  // Bypass for illegal_fishing: scout pre-populates key_species in raw_data
  // since marine species ranges are not in the PostGIS terrestrial mammal shapefile.
  if (
    event.event_type === 'illegal_fishing' &&
    Array.isArray(event.raw_data['key_species']) &&
    (event.raw_data['key_species'] as unknown[]).length > 0
  ) {
    // Use scout-provided species list; treat as on-site (distance = 0)
    speciesFromRawData = event.raw_data['key_species'] as string[];
    habitatDistanceKmOverride = 0;
    // Fall through to enrichment — do NOT return
  } else {
    await logPipelineEvent({ event_id: event.id, source: event.source,
      stage: 'enrichment', status: 'filtered', reason: 'no_habitat_overlap' });
    return;
  }
}
```

Then when building the `EnrichedDisasterEvent`:
```typescript
nearby_habitat_ids: habitats.length > 0 ? habitats.map(h => h.id) : [],
species_at_risk:    habitats.length > 0
  ? [...new Set(habitats.map(h => h.species_name))]
  : (speciesFromRawData ?? []),
habitat_distance_km: habitats.length > 0 ? habitats[0]!.distance_km : (habitatDistanceKmOverride ?? 0),
```

---

### Color

`#be185d` — rose-700 / dark crimson-pink. Distinct from all 10 existing event type colors. Suggests anthropogenic violation rather than natural disaster.

| Event Type | Color |
|---|---|
| wildfire | `#ef4444` red |
| tropical_storm | `#3b82f6` blue |
| flood | `#06b6d4` cyan |
| drought | `#f59e0b` amber |
| coral_bleaching | `#14b8a6` teal |
| earthquake | `#8b5cf6` purple |
| volcanic_eruption | `#f97316` orange |
| deforestation | `#78350f` brown |
| sea_ice_loss | `#bfdbfe` icy blue |
| climate_anomaly | `#6366f1` indigo |
| **illegal_fishing** | **`#be185d` rose** |

---

### Files to Create

| File | Description |
|---|---|
| `server/src/scouts/GfwFishingScout.ts` | Scout — queries GFW Events API per MPA, fires `illegal_fishing` events |
| `server/src/scouts/mpaRegions.json` | 25 curated MPAs with id, name, country, centroid, radius_km, key_species[] |
| `server/tests/scouts/GfwFishingScout.test.ts` | ~10 tests: events published per MPA with vessels; empty response skipped; dedup; circuit breaker; source/event_type; severity clamped; 0-vessel skip |
| `server/tests/fixtures/gfw-fishing-events-response.json` | Fixture: 2 MPAs, one with 3 vessels, one with 0 (for skip test) |

### Files to Modify

| File | Change |
|---|---|
| `shared/types.d.ts` | Add `'gfw_fishing'` to DisasterSource; `'illegal_fishing'` to EventType; `illegal_fishing: number` to TrendPoint |
| `server/src/config.ts` | Add `fishingWatchApiKey: optionalEnv('FISHING_WATCH_API_KEY', '')` — optional so missing key doesn't crash server; scout logs warning + skips |
| `server/src/scouts/index.ts` | Import + instantiate `GfwFishingScout`; schedule daily 11:00 UTC; add to startup run list |
| `server/src/routes/health.ts` | Add `'gfw_fishing'` to SCOUT_NAMES (11 scouts total) |
| `server/src/db/statsQueries.ts` | Add `COUNT(*) FILTER (WHERE event_type = 'illegal_fishing') AS illegal_fishing` to pivot; add `illegal_fishing` to result map |
| `server/src/agents/EnrichmentAgent.ts` | Add `illegal_fishing` bypass (see above) |
| `server/src/discord/bot.ts` | Add `illegal_fishing: '🐟 Illegal Fishing'` to EVENT_LABELS; add `climate_anomaly` and `illegal_fishing` accumulator vars + embed fields to `handleTrendsCommand` |
| `client/components/DisasterMapInner.tsx` | Add `'illegal_fishing'` to EVENT_TYPES array; add `illegal_fishing: '#be185d'` to EVENT_COLORS |
| `client/components/DisasterMap.tsx` | Add `'illegal_fishing'` to EVENT_TYPES array |
| `client/components/TrendChart.tsx` | Add `illegal_fishing: '#be185d'` to EVENT_COLORS; add `'Illegal Fishing'` to EVENT_LABELS |
| `project-specs/roadmap/PHASE_10_EXPANSIONS.md` | Mark 5B complete with date |
| `project-specs/roadmap/ROADMAP.md` | Update Phase 10 notes to reflect 5A complete, 5B in progress |

---

### Test Plan (~10 new tests)

| Test | Assertion |
|---|---|
| Publishes one event per MPA with ≥1 vessel detected | `redis.xadd` called once per matching MPA |
| Sets `source: 'gfw_fishing'` and `event_type: 'illegal_fishing'` | Field values on published event |
| Skips MPA with 0 vessels in response | `redis.xadd` NOT called for that MPA |
| Severity = vesselCount / 10, clamped to 1.0 | 3 vessels → 0.3; 15 vessels → 1.0 |
| Deduplicates same MPA within same week | `redis.get` returns existing ID → `redis.xadd` not called |
| `raw_data.key_species` matches mpaRegions entry | Spot-check vaquita MPA key_species |
| `raw_data.vessel_count` matches unique MMSI count | `vessel_count: 3` for fixture with 3 vessels |
| Empty API response (no entries) → no events | `redis.xadd` not called at all |
| Circuit breaker trips on 3 consecutive fetch failures | `redis.incr` called; `xadd` not called after circuit opens |
| Skips gracefully when `FISHING_WATCH_API_KEY` is empty | Logs warning; `fetch` not called |

---

### Railway Action (User)

After deploy, add to Railway → server service → Variables:
```
FISHING_WATCH_API_KEY=<token from globalfishingwatch.org/our-apis/tokens>
```

The server will start without the key (it is `optionalEnv`). The scout will log a warning on each scheduled run and skip. Once the key is set and Railway redeploys, the scout activates automatically.

---

### Verification

```bash
npm test -- --reporter=verbose
npm run typecheck
cd client && npm run typecheck
npm run lint
```

- All existing 414 tests pass; ~10 new GfwFishingScout tests green
- TypeScript: zero errors in both server + client
- Frontend: `illegal_fishing` toggle visible in map layer controls, rose-colored markers
- TrendChart: rose bar segment appears in chart when illegal_fishing alerts exist
- Discord `/trends`: `🐟 Illegal Fishing` field present in embed
