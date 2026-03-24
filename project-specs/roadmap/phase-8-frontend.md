# Phase 8 — Frontend (Next.js)

**Goal:** A portfolio-quality read-only web presence. Looks great. Works on mobile. Shows the system is alive and doing something meaningful.

**Status:** 🔲 Not started
**Depends on:** Phase 5 complete (Phase 7 recommended for refiner chart)

---

## Overview

Next.js 15 App Router. Tailwind CSS v4 CSS-first. Leaflet.js for the map (dynamic import, ssr: false). SSE for live agent activity. This is sjtroxel's first Next.js project — keep it clean and demonstrate the pattern well.

---

## 1. Project Setup

```bash
cd client/
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*"
```

Tailwind v4: replace the generated config with CSS-first `@import "tailwindcss"` + `@theme {}` in `app/globals.css`.

---

## 2. API Layer

The Next.js frontend fetches from the Express backend via a typed API client:

```typescript
// client/lib/api.ts
const BASE_URL = process.env.NEXT_PUBLIC_API_URL;

export const api = {
  getRecentAlerts: () => fetch(`${BASE_URL}/alerts/recent?limit=20`).then(r => r.json()),
  getActiveEvents: () => fetch(`${BASE_URL}/events/active`).then(r => r.json()),
  getHabitatPolygons: (bbox: BoundingBox) =>
    fetch(`${BASE_URL}/habitats?bbox=${bbox.toString()}`).then(r => r.json()),
  getRefinerScores: () => fetch(`${BASE_URL}/refiner/scores`).then(r => r.json()),
};
```

Backend endpoints to add in Phase 8:
- `GET /alerts/recent?limit=N` — last N alerts from DB
- `GET /events/active` — disaster events from last 24h with enrichment
- `GET /habitats?bbox=...` — habitat polygons within bounding box (for map)
- `GET /refiner/scores` — score history for trend chart
- `GET /agent-activity` — SSE stream of agent activity

---

## 3. Page Layout

Single page (`app/page.tsx`). Mobile-first grid:

```
Mobile (375px):          Desktop (1280px):
┌─────────────────┐      ┌──────────┬────────────┐
│   Header        │      │          │  Recent    │
├─────────────────┤      │  Map     │  Alerts    │
│   Map           │      │          │  Feed      │
│   (full width)  │      ├──────────┤            │
├─────────────────┤      │  Agent   │            │
│   Recent Alerts │      │  Activity│            │
│   Feed          │      ├──────────┴────────────┤
├─────────────────┤      │   Refiner Score Chart  │
│   Agent Activity│      └───────────────────────┘
├─────────────────┤
│   Refiner Chart │
└─────────────────┘
```

---

## 4. Leaflet Map Component

**File:** `client/components/DisasterMap.tsx`

Key requirements:
- `dynamic` import with `ssr: false` — Leaflet cannot run during SSR
- Map height: `h-[400px] md:h-[600px]` — defined height required for Leaflet to render
- Disaster event markers: colored by event type (see EVENT_COLORS in model-router.md)
- Habitat polygon overlays: GeoJSON layer, visible when zoomed in (zoom > 7)
- Lines connecting active threats to habitat boundaries

```typescript
import dynamic from 'next/dynamic';

const DisasterMap = dynamic(
  () => import('@/components/DisasterMapInner'),
  { ssr: false, loading: () => <MapSkeleton /> }
);
```

Tile layer: OpenStreetMap (free, no API key):
```typescript
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
})
```

---

## 5. Recent Alerts Feed

**File:** `client/components/AlertsFeed.tsx`

- Shows last 20 alerts from DB
- Each card: species name, disaster type badge, threat level badge, distance, timestamp
- Color-coded by threat level
- Click → expands to show full narrative (no separate detail page needed for MVP)
- Polling: refresh every 60 seconds via `setInterval` + `router.refresh()`

---

## 6. Agent Activity SSE Panel

**File:** `client/components/AgentActivity.tsx`

Real-time stream of what agents are doing right now. Same observability pattern as Asteroid Bonanza's SSE panels.

```typescript
useEffect(() => {
  const source = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/agent-activity`);
  source.onmessage = (e) => {
    const event = JSON.parse(e.data);
    setActivity(prev => [event, ...prev].slice(0, 50));
  };
  source.onerror = () => source.close();
  return () => source.close();
}, []);
```

Display format:
```
⚙️ [firms:scout] Fire detected: lat=-3.42, lng=104.21 | 2 min ago
⚙️ [enrichment] Habitat overlap: Sumatran Orangutan 18km | 2 min ago
🔴 [threat_assess] THREAT: HIGH | confidence=0.82 | 1 min ago
✅ [discord] Posted to #wildlife-alerts | 1 min ago
```

---

## 7. Refiner Score Trend Chart

**File:** `client/components/RefinerChart.tsx`

Simple line chart showing prediction accuracy score over time. Library: `recharts` (lightweight, Next.js compatible, no Canvas issues).

```typescript
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
```

- X-axis: date
- Y-axis: composite score (0–1)
- Series: fire scores + storm scores (two lines)
- Threshold line at 0.60 (correction threshold) and 0.85 (success threshold)
- Mobile: reduce to single series, simplify axis labels

---

## 8. Header

```
Wildlife Sentinel
"A 24/7 system monitoring natural disasters and their impact on endangered species."
[GitHub link] [Brief explanation of what you're seeing]
```

Keep it minimal. The map and data speak for themselves.

---

## Acceptance Criteria

1. `npm run build` succeeds with zero TypeScript errors
2. App loads and shows map, alerts feed, agent activity panel, and refiner chart
3. Leaflet map renders correctly (no SSR errors) — shows disaster events and habitat polygons
4. Agent Activity SSE panel updates in real time when pipeline processes events
5. Mobile review passes (`/mobile-review` command) at 375px and 768px viewports
6. Vercel preview deployment works (save full deploy for Phase 9)

---

## Notes / Decisions Log

*(Add notes here as Phase 8 progresses)*
