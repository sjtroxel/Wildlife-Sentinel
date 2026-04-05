# Phase 10 Implementation Plan — Expansions & Enhancements

## Context

Phase 9 is complete as of 2026-04-05. The system is live end-to-end:
- Backend: `https://wildlife-sentinel.up.railway.app`
- Frontend: `https://wildlife-sentinel.vercel.app`
- Pipeline firing real alerts. First end-to-end alert posted 2026-04-04.

Phase 10 addresses confirmed bugs found during the Phase 9 smoke test, plus known backlog items deferred from earlier phases. No new major architecture is introduced — this phase is polish, fixes, and targeted enhancements.

---

## Issues Confirmed During Phase 9 Smoke Test (2026-04-05)

| # | Issue | Type |
|---|---|---|
| 1 | Alert click in feed navigates to a broken page | Bug |
| 2 | Alerts not plotted as markers on the Leaflet map | Bug |
| 3 | Mobile layout proportions feel cramped; user wants resizable panels | Enhancement |
| 4 | Leaflet map tile/marker rough edges (known since Phase 8) | Polish |

## Backlog Items Carried From Earlier Phases

| # | Item | Source |
|---|---|---|
| 5 | #sentinel-ops logs every habitat event even with 0 GBIF sightings — noisy | Phase 9 notes |
| 6 | Cost trend visibility — model_usage table populated; surface it somewhere | Phase 9 notes |

---

## Track 1 — Bug Fixes (do first)

### Step 1.1 — Fix broken alert click navigation

**Symptom:** Clicking a recent alert in the alerts feed navigates to "This page couldn't load."

**Investigation needed:** Read `client/src/components/RecentAlerts.tsx` (or equivalent). Find what `href` or `onClick` is being set. The frontend is read-only — there is no alert detail page. The link should either:
- (a) Do nothing (remove the link entirely if no detail page exists), or
- (b) Open a detail panel/modal inline without navigating away.

**Decision:** Remove navigation entirely for now. If we want an alert detail view, that's a separate tracked feature. A broken link is worse than no link.

**File to fix:** Identify by reading `client/src/` — likely `RecentAlerts.tsx` or `AlertCard.tsx`.

### Step 1.2 — Plot alerts as markers on the Leaflet map

**Symptom:** The map renders correctly (tiles load, habitat polygons show) but recent alerts are not plotted as markers.

**Expected behavior:** Each alert in `/alerts/recent` should appear as a colored marker on the map at its `coordinates`. Color matches the event type (use `EVENT_COLORS` from `frontend.md`):

```typescript
export const EVENT_COLORS = {
  wildfire: '#ef4444',
  tropical_storm: '#3b82f6',
  flood: '#06b6d4',
  drought: '#f59e0b',
  coral_bleaching: '#14b8a6',
} as const;
```

**Marker behavior:**
- Click a marker → show a Leaflet popup with: event type, threat level, species at risk (top 3), confidence score, timestamp.
- Marker size: uniform. Do NOT scale by severity — clutters the map.
- Use `L.circleMarker` for clean rendering (no custom icon image dependencies).

**Implementation location:** `client/src/components/DisasterMap.tsx` (or `DisasterMapInner.tsx`). The component already fetches habitat polygons — add a second fetch for `/alerts/recent` and layer markers on top.

**Data shape to expect from `/alerts/recent`:**

```typescript
interface AlertMarker {
  id: string;
  event_type: string;
  coordinates: string;     // JSON string: '{"lat": 13.7, "lng": 106.7}'
  threat_level: string;
  confidence: string;      // decimal string from DB e.g. "0.74"
  species_at_risk: string; // JSON string: '["Panthera tigris", ...]'
  created_at: string;
}
```

Note: `coordinates` and `species_at_risk` come back as JSON strings from the DB — parse them before use.

**Two-effect pattern (already established in the map component):**
1. Effect 1: initialize Leaflet map on mount
2. Effect 2: fetch habitats + alerts once `map` state is set, add layers

Keep this pattern. Add alerts to Effect 2.

---

## Track 2 — Mobile Layout & Resizable Panels

### Step 2.1 — Audit current mobile layout

Read the current layout component (`client/src/app/page.tsx` or equivalent layout file). Document the current flex/grid structure before changing anything.

### Step 2.2 — Improve default mobile proportions

At 375px (mobile base), the current split is roughly map 25% / alerts 60% / agent-activity 15%. This feels cramped.

**New default proportions (mobile):**
- Map: 40% of viewport height (`h-[40vh]`)
- Alerts feed: scrollable, no fixed height — natural content flow
- Agent activity: scrollable, no fixed height — natural content flow

Alerts and agent activity should scroll independently within their panels, not push each other around.

### Step 2.3 — Resizable panel dividers

Allow the user to drag the border between panels to resize them. This is a significant UX improvement and feasible with CSS + a small amount of JavaScript.

**Approach:** Use the browser-native `resize` CSS property where applicable, or implement a drag-handle divider.

Recommended: a thin drag handle `<div>` between each panel pair. On `mousedown`/`touchstart`, track pointer movement and update panel heights via inline style or a React state variable.

**Libraries to consider:**
- `react-resizable-panels` — purpose-built, well-maintained, small. Install as a client dependency in `client/`.
- Manual implementation — ~50 lines, no dep, but fiddlier on touch.

**Decision:** Use `react-resizable-panels`. It handles touch, keyboard, and accessibility correctly out of the box.

```bash
npm install react-resizable-panels --workspace=client
```

**Layout structure with resizable panels:**

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

<PanelGroup direction="vertical">
  <Panel defaultSize={40} minSize={20}>
    <DisasterMap />
  </Panel>
  <PanelResizeHandle className="h-1 bg-border cursor-row-resize" />
  <Panel defaultSize={35} minSize={15}>
    <RecentAlerts />
  </Panel>
  <PanelResizeHandle className="h-1 bg-border cursor-row-resize" />
  <Panel defaultSize={25} minSize={10}>
    <AgentActivity />
  </Panel>
</PanelGroup>
```

On desktop (`md:` breakpoint), use `direction="horizontal"` for the map vs. right-panel split, then a nested vertical group for alerts + agent activity.

---

## Track 3 — Sentinel-Ops Noise Reduction

### Step 3.1 — Suppress 0-sighting habitat logs

**Location:** `server/src/agents/HabitatAgent.ts`

**Current behavior:** `logToWarRoom` is called for every event processed, including those where GBIF returned 0 sightings. This generates significant noise in #sentinel-ops.

**Fix:** Only log to warRoom when `gbif_recent_sightings.length > 0`. Log 0-sighting results to console only (not Discord).

```typescript
// Before (logs everything to warRoom)
await logToWarRoom({ agent: 'habitat', action: 'gbif_result', detail: `0 sightings for ${species}` });

// After (0 sightings → console only)
if (sightings.length > 0) {
  await logToWarRoom({ agent: 'habitat', action: 'gbif_sightings', detail: `${sightings.length} sightings for ${species}` });
} else {
  console.log(`[habitat] 0 GBIF sightings for ${species} — skipping warRoom log`);
}
```

Apply the same principle: only post to #sentinel-ops when there's something meaningful to report.

---

## Track 4 — Cost Visibility

### Step 4.1 — Add cost summary to weekly digest

The `weeklyDigest.ts` already queries for alert counts and refiner scores. Add a cost line:

```typescript
const costResult = await sql`
  SELECT COALESCE(SUM(estimated_cost_usd), 0)::numeric(6,4) AS total
  FROM model_usage
  WHERE created_at > NOW() - INTERVAL '7 days'
`;
```

Add to the digest embed: `• AI cost this week: $X.XX`

This surfaces the cost trend to you without requiring a separate dashboard visit.

### Step 4.2 — Add `/admin/costs` endpoint response to health page (optional)

The backend already has a `/admin/costs` endpoint (or similar from ModelRouter cost tracking). Consider surfacing the running total in the `/health` response:

```json
{ "status": "ok", ..., "total_cost_usd": 0.87 }
```

Low effort, useful for monitoring. Implement only if the endpoint already exists — do not add a new DB query to the health check.

---

## Acceptance Criteria

1. Clicking an alert in the feed no longer navigates away from the page
2. Recent alerts appear as colored `circleMarker`s on the Leaflet map; clicking a marker shows a popup
3. Mobile layout: map is at least 40vh by default; panels are independently scrollable
4. Drag handles between panels work on both mouse and touch
5. `#sentinel-ops` no longer receives a log entry for every 0-sighting GBIF result
6. Weekly digest includes AI cost for the week

---

## File Manifest

**Modify (client):**
- `client/src/components/RecentAlerts.tsx` (or equivalent) — remove broken navigation
- `client/src/components/DisasterMap.tsx` / `DisasterMapInner.tsx` — add alert markers
- `client/src/app/page.tsx` (or layout file) — resizable panels

**Install (client):**
- `react-resizable-panels`

**Modify (server):**
- `server/src/agents/HabitatAgent.ts` — suppress 0-sighting warRoom logs
- `server/src/discord/weeklyDigest.ts` — add cost line

---

## Session Strategy

| Session | Work |
|---|---|
| A | Track 1: fix broken alert link + add map markers (read map component first) |
| B | Track 2: resizable panels (read current layout first, install dep, implement) |
| C | Track 3 + 4: sentinel-ops noise + cost line in digest (small, quick) |

Read source files before touching anything. The map component has an established two-effect pattern that must be preserved.
