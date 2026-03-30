# Phase 8 Implementation Plan — Frontend (Next.js)

## Context

Phase 8 delivers the portfolio-quality read-only web frontend and the 4 Express API routes that feed it. The backend pipeline (Phases 0–7) is complete. This phase makes the system visible to visitors who aren't on Discord: a world map of disaster events, a live alerts feed, a real-time agent activity panel, and a refiner accuracy chart. It also adds 4 Express routes that the frontend needs and wires `warRoom.ts` into Redis pub/sub for the SSE stream.

sjtroxel's first Next.js project — patterns must be clean and explicit.

---

## Pre-Implementation Checks (must pass before writing any component)

1. `npm run dev` from `server/` starts without errors
2. `curl http://localhost:3000/alerts/recent` returns JSON (after backend routes are added)
3. `curl http://localhost:3000/refiner/scores` returns JSON
4. `curl -N http://localhost:3000/agent-activity` stays open (SSE)

---

## Track 1 — Backend API Routes ✅ COMPLETE

Do these first. The frontend is blocked on them.

### Step 1.1 — `server/src/routes/alerts.ts` ✅

```
GET /recent?limit=20   (cap at 50)

Query:
  SELECT id, source, event_type, coordinates, severity, threat_level,
         confidence_score, enrichment_data, created_at, discord_message_id
  FROM alerts
  WHERE threat_level IS NOT NULL
  ORDER BY created_at DESC
  LIMIT ${limit}
```

- Parse `limit` from query string: `Math.min(parseInt(String(req.query['limit'] ?? '20')), 50)`
- Return `res.json(alerts)`
- Export: `export const alertsRouter = Router()`

### Step 1.2 — `server/src/routes/refiner.ts` ✅

```
GET /scores

Query:
  SELECT r.composite_score, r.direction_accuracy, r.magnitude_accuracy,
         r.evaluation_time, r.evaluated_at,
         a.event_type, a.source
  FROM refiner_scores r
  JOIN alerts a ON r.alert_id = a.id
  ORDER BY r.evaluated_at DESC
  LIMIT 100
```

- Export: `export const refinerRouter = Router()`

### Step 1.3 — `server/src/routes/habitats.ts` ✅

```
GET /?minLng=&minLat=&maxLng=&maxLat=

Validation (before hitting DB):
  - All four params must be present
  - All must parse as finite numbers
  - lng values ∈ [-180, 180]
  - lat values ∈ [-90, 90]
  - Throw ValidationError if any fail

Query:
  SELECT id, species_name, iucn_status,
    ST_AsGeoJSON(geom)::jsonb AS geojson
  FROM species_ranges
  WHERE ST_Intersects(
    geom,
    ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
  )
  LIMIT 100

Response:
  res.json({ type: 'FeatureCollection', features: rows })
```

- Import `ValidationError` from `../errors.js`

### Step 1.4 — `server/src/routes/agentActivity.ts` ✅

```
GET /

Headers:
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive

Logic:
  1. Set headers, flushHeaders()
  2. const subscriber = redis.duplicate()
  3. await subscriber.subscribe('agent:activity')
  4. subscriber.on('message', (_ch, msg) => res.write(`data: ${msg}\n\n`))
  5. req.on('close', () => subscriber.unsubscribe + subscriber.quit())
```

- `sseLimiter`: `rateLimit({ windowMs: 60_000, max: 10 })` — caps concurrent SSE connections

### Step 1.5 — Update `server/src/discord/warRoom.ts` ✅

Added Redis pub/sub publish alongside the existing Discord post (errors swallowed — warRoom never crashes the pipeline):

```typescript
try {
  await redis.publish('agent:activity', JSON.stringify({
    agent: entry.agent,
    action: entry.action,
    detail: entry.detail,
    timestamp: new Date().toISOString(),
  }));
} catch { /* swallow — observability must never crash the pipeline */ }
```

### Step 1.6 — Register routes in `server/src/app.ts` ✅

4 imports + 4 `app.use()` calls added before the error handler.

---

## Track 2 — Frontend

### Step 2.1 — Scaffold Next.js ✅

Next.js 16.2.1 scaffolded (React 19, Tailwind v4, TypeScript strict, App Router).
No `tailwind.config.js` generated — v4 is already CSS-first.

### Step 2.2 — Install additional deps ✅

`leaflet@1.9.4`, `recharts@3.8.1`, `@types/leaflet@1.9.21` installed.
`@wildlife-sentinel/shared` added to dependencies, linked via root `npm install`.

### Step 2.3 — `client/.env.local` ✅

`NEXT_PUBLIC_API_URL=http://localhost:3000` written.

### Step 2.4 — `client/app/globals.css` ✅

Replaced with Tailwind v4 CSS-first setup:

```css
@import "tailwindcss";

@theme {
  --color-threat-critical: #dc2626;
  --color-threat-high:     #ea580c;
  --color-threat-medium:   #d97706;
  --color-threat-low:      #6b7280;

  --color-event-wildfire:  #ef4444;
  --color-event-storm:     #3b82f6;
  --color-event-flood:     #06b6d4;
  --color-event-drought:   #f59e0b;
  --color-event-coral:     #14b8a6;
}
```

### Step 2.5 — `client/lib/api.ts` ✅

API client. Uses `NEXT_PUBLIC_API_URL`. Types from `@wildlife-sentinel/shared`.

```typescript
const BASE = process.env.NEXT_PUBLIC_API_URL;
if (!BASE) throw new Error('NEXT_PUBLIC_API_URL is not set');

export const api = {
  getRecentAlerts: (limit = 20): Promise<AlertRow[]> =>
    fetch(`${BASE}/alerts/recent?limit=${limit}`).then(r => r.json()),
  getRefinerScores: (): Promise<RefinerScoreRow[]> =>
    fetch(`${BASE}/refiner/scores`).then(r => r.json()),
  getHabitats: (bbox: BboxQuery): Promise<GeoJSON.FeatureCollection> =>
    fetch(`${BASE}/habitats?${new URLSearchParams(bbox as Record<string, string>)}`).then(r => r.json()),
};
```

### Step 2.6 — `client/lib/utils.ts`

`formatRelativeTime` — used by both `AlertsFeed` and `AgentActivity`:

```typescript
export function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

### Step 2.7 — `client/app/page.tsx`

Mobile-first layout. Leaflet imported dynamically (`ssr: false`). Single column on mobile, two-column grid at `lg:`.

### Step 2.8 — `client/components/DisasterMap.tsx` (wrapper)

Thin re-export wrapper: `export { default } from './DisasterMapInner'`

### Step 2.9 — `client/components/DisasterMapInner.tsx`

`'use client'`. Imports `leaflet` directly (safe — loaded only via `dynamic` with `ssr: false`).

- Fix Leaflet's webpack icon issue with `_getIconUrl` delete pattern
- `useRef<HTMLDivElement>` for map container
- `useEffect` to initialize map on mount; cleanup calls `map.remove()`
- Second `useEffect` loads recent alerts as `L.circleMarker`, sized by `severity`, colored by `event_type`
- Popup: event_type, threat_level, date

### Step 2.10 — `client/components/AlertsFeed.tsx`

`'use client'`. Polls `api.getRecentAlerts(20)` every 60s. Expand-on-click for details.

### Step 2.11 — `client/components/AgentActivity.tsx`

`'use client'`. SSE via `new EventSource(...)`. Keeps last 50 entries. Closes on error.

### Step 2.12 — `client/components/RefinerChart.tsx`

`'use client'`. Renders `null` when no data. `recharts` LineChart with reference lines at 0.60 (correction) and 0.85 (success).

---

## Track 3 — Backend Route Tests

New test files in `server/tests/routes/`. Mock `sql` and `redis`.

- `alerts.test.ts` — limit capping, column list, empty array
- `refiner.test.ts` — JOIN, LIMIT 100
- `habitats.test.ts` — validation errors for bad params, GeoJSON FeatureCollection shape
- `agentActivity.test.ts` — SSE headers, subscriber cleanup on close

---

## Spec Adjustments / Decisions

| Item | Decision |
|---|---|
| `/events/active` route in spec section 2 | **Not implementing.** Absent from prerequisites, acceptance criteria, and all frontend components. Superseded by SSE. |
| `sseLimiter` (referenced but undefined in spec) | Defined inline in `agentActivity.ts` as `rateLimit({ windowMs: 60_000, max: 10 })`. |
| `formatRelativeTime` (used in 2 components, undefined) | Defined in `client/lib/utils.ts`, imported by both. |
| `AlertRow` / `RefinerScoreRow` in client | Imported from `@wildlife-sentinel/shared` (workspace). Add `"@wildlife-sentinel/shared": "*"` to `client/package.json` after scaffolding. |
| Tailwind v3 vs v4 after scaffolding | Check version post-scaffold. If v3: `npm install tailwindcss@latest`. Delete `tailwind.config.js` either way. |
| `habitats` bbox validation | Explicit number parsing + range check before any SQL. Throws `ValidationError` (400) on bad input. |

---

## File Manifest

**Create (server):**
- `server/src/routes/alerts.ts` ✅
- `server/src/routes/refiner.ts` ✅
- `server/src/routes/habitats.ts` ✅
- `server/src/routes/agentActivity.ts` ✅
- `server/tests/routes/alerts.test.ts` ✅
- `server/tests/routes/refiner.test.ts` ✅
- `server/tests/routes/habitats.test.ts` ✅
- `server/tests/routes/agentActivity.test.ts` ✅

**Modify (server):**
- `server/src/app.ts` — register 4 new routes ✅
- `server/src/discord/warRoom.ts` — add Redis pub/sub publish ✅

**Create (client):**
- `client/lib/api.ts` ✅
- `client/lib/utils.ts` ✅
- `client/components/DisasterMap.tsx` ✅
- `client/components/DisasterMapInner.tsx` ✅
- `client/components/AlertsFeed.tsx` ✅
- `client/components/AgentActivity.tsx` ✅
- `client/components/RefinerChart.tsx` ✅

**Modify (client):**
- `client/app/globals.css` — Tailwind v4 CSS-first setup ✅
- `client/app/layout.tsx` — update metadata title/description ✅
- `client/app/page.tsx` — main layout ✅
- `client/package.json` — workspace name + deps ✅

---

## Acceptance Criteria (from spec)

1. `npm run build` in `client/` — zero TypeScript errors
2. App loads at `localhost:3001` — all four panels visible
3. Leaflet map renders at 375px — no SSR errors in console
4. Map shows colored markers for recent alerts (sized by severity)
5. Alerts feed refreshes every 60 seconds
6. Agent Activity SSE panel updates in real time during pipeline activity
7. Refiner chart renders (or renders nothing gracefully when no scores exist)
8. No horizontal scroll at 375px viewport
9. `curl http://localhost:3000/alerts/recent` returns JSON
10. `curl -N http://localhost:3000/agent-activity` stays open (SSE stream)
