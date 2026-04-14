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
| 4B | Smithsonian GVP + USGS Volcano Hazards | `GvpVolcanoScout.ts` Orange/Red only, 6h | Galápagos finches/tortoises, Hawaiian honeycreeper, gorillas near Nyiragongo |
| 4C | FAO Desert Locust Watch (`locust.fao.org/api`) | `FaoLocustScout.ts` 6h | East African savanna species, one-horned rhino, Bengal florican — novel threat class |
| 4D | Global Forest Watch GLAD alerts | `GladDeforestationScout.ts` daily | Orangutan, jaguar, bonobo, okapi — highest conservation impact addition |
| 4E | NSIDC Sea Ice Index (daily anomaly trigger) | `NsidcSeaIceScout.ts` daily | Polar bear, walrus, emperor penguin — zero current coverage |

### Future — Expansion 5 (revisit after 4A–4E)

| # | Source | Notes |
|---|---|---|
| 5A | NOAA CPC ENSO declarations | Macro-signal, not a point event — needs different pipeline pattern |
| 5B | Global Fishing Watch (illegal fishing in MPAs) | Anthropogenic threat class; needs MPA spatial join against PostGIS |

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
| R | Expansion 4B — volcanic eruption scout (Smithsonian GVP, Orange/Red only) |
| S | Expansion 4C — desert locust scout (FAO, Africa/Middle East/South Asia) |
| T | Expansion 4D — deforestation scout (Global Forest Watch GLAD, daily) |
| U | Expansion 4E — sea ice extent scout (NSIDC, daily anomaly trigger) |
| V | Expansion 5A — ENSO declarations (macro-signal, pipeline design needed) |
| W | Expansion 5B — illegal fishing in MPAs (Global Fishing Watch API) |

**Current: Expansion 4A complete (2026-04-14). Next: Expansion 4B (volcanic eruptions).**
