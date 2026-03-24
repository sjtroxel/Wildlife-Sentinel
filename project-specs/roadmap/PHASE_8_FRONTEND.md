# Phase 8 — Frontend (Next.js)

**Goal:** A portfolio-quality read-only web presence. Looks great on mobile. Shows the system is alive and doing something meaningful to visitors who aren't on Discord.

**Status:** Not started
**Depends on:** Phase 5 complete (Phase 7 recommended for the refiner chart)
**Estimated sessions:** 2–3
**Note:** This is sjtroxel's first Next.js project — keep it clean, demonstrate the patterns well.

---

## Overview

Next.js 15 App Router. Tailwind CSS v4 CSS-first. Leaflet.js for the map. SSE for live agent activity. Single-page layout with four panels.

---

## 1. Project Setup

```bash
cd client/
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*"
```

Then in `client/`:
- Delete the generated `tailwind.config.js` — Tailwind v4 uses CSS-first configuration
- Replace `app/globals.css` content with Tailwind v4 CSS-first setup (see below)
- Install additional deps: `npm install leaflet recharts`
- Install types: `npm install -D @types/leaflet`

### `client/app/globals.css`

```css
@import "tailwindcss";

@theme {
  --color-threat-critical: #dc2626;
  --color-threat-high: #ea580c;
  --color-threat-medium: #d97706;
  --color-threat-low: #6b7280;

  --color-event-wildfire: #ef4444;
  --color-event-storm: #3b82f6;
  --color-event-flood: #06b6d4;
  --color-event-drought: #f59e0b;
  --color-event-coral: #14b8a6;
}
```

---

## 2. Backend API Endpoints to Add (Phase 8)

Add these routes to the Express server before building the frontend:

```typescript
// server/src/routes/alerts.ts
router.get('/recent', async (req, res) => {
  const limit = Math.min(parseInt(String(req.query['limit'] ?? '20')), 50);
  const alerts = await sql<AlertRow[]>`
    SELECT id, source, event_type, coordinates, severity, threat_level,
           confidence_score, enrichment_data, created_at, discord_message_id
    FROM alerts
    WHERE threat_level IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  res.json(alerts);
});

// server/src/routes/events.ts
router.get('/active', async (_req, res) => {
  // Last 24h of pipeline events that were enriched (i.e., had habitat overlap)
  const events = await sql`
    SELECT DISTINCT ON (event_id)
      event_id, source, stage, created_at
    FROM pipeline_events
    WHERE stage = 'enriched' AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY event_id, created_at DESC
  `;
  res.json(events);
});

// server/src/routes/habitats.ts
// Returns habitat polygons as GeoJSON for the map
// Paginated by bounding box to keep response size manageable
router.get('/', async (req, res) => {
  const { minLng, minLat, maxLng, maxLat } = req.query;
  const polygons = await sql`
    SELECT id, species_name, iucn_status,
      ST_AsGeoJSON(geom)::jsonb AS geojson
    FROM species_ranges
    WHERE ST_Intersects(
      geom,
      ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
    )
    LIMIT 100
  `;
  res.json({ type: 'FeatureCollection', features: polygons });
});

// server/src/routes/refiner.ts
router.get('/scores', async (_req, res) => {
  const scores = await sql`
    SELECT composite_score, direction_accuracy, magnitude_accuracy,
           evaluation_time, evaluated_at,
           a.event_type, a.source
    FROM refiner_scores r
    JOIN alerts a ON r.alert_id = a.id
    ORDER BY evaluated_at DESC
    LIMIT 100
  `;
  res.json(scores);
});
```

### SSE: Agent Activity Stream

```typescript
// server/src/routes/agentActivity.ts
router.get('/', sseLimiter, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Subscribe to Redis agent:activity stream (published by warRoom.ts)
  const subscriber = redis.duplicate();
  await subscriber.subscribe('agent:activity');

  subscriber.on('message', (_channel, message) => {
    res.write(`data: ${message}\n\n`);
  });

  req.on('close', () => {
    subscriber.unsubscribe('agent:activity');
    subscriber.quit().catch(console.error);
  });
});
```

Update `warRoom.ts` to also publish to Redis pub/sub for SSE:
```typescript
await redis.publish('agent:activity', JSON.stringify({ agent: entry.agent, action: entry.action, detail: entry.detail, timestamp: new Date().toISOString() }));
```

---

## 3. API Client (Frontend)

```typescript
// client/lib/api.ts
const BASE = process.env.NEXT_PUBLIC_API_URL;
if (!BASE) throw new Error('NEXT_PUBLIC_API_URL is not set');

export const api = {
  getRecentAlerts: (limit = 20) =>
    fetch(`${BASE}/alerts/recent?limit=${limit}`).then(r => r.json()),
  getRefinerScores: () =>
    fetch(`${BASE}/refiner/scores`).then(r => r.json()),
  getHabitats: (bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number }) =>
    fetch(`${BASE}/habitats?${new URLSearchParams(bbox as unknown as Record<string, string>)}`).then(r => r.json()),
};
```

---

## 4. Page Layout

`client/app/page.tsx` — single page, mobile-first:

```typescript
import dynamic from 'next/dynamic';
import AlertsFeed from '@/components/AlertsFeed';
import AgentActivity from '@/components/AgentActivity';
import RefinerChart from '@/components/RefinerChart';

// Leaflet cannot run server-side — must be dynamic with ssr: false
const DisasterMap = dynamic(() => import('@/components/DisasterMap'), {
  ssr: false,
  loading: () => <div className="h-[400px] md:h-[600px] bg-gray-900 animate-pulse rounded-lg" />,
});

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="px-4 py-6 border-b border-gray-800">
        <h1 className="text-2xl font-bold">Wildlife Sentinel</h1>
        <p className="text-gray-400 text-sm mt-1">
          24/7 autonomous monitoring of natural disasters and their impact on endangered species
        </p>
      </header>

      {/* Mobile: single column | Desktop: 2-column grid */}
      <div className="p-4 space-y-4 lg:grid lg:grid-cols-[1fr_380px] lg:gap-4 lg:space-y-0">
        {/* Left/main column */}
        <div className="space-y-4">
          <DisasterMap />
          <AgentActivity />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <AlertsFeed />
        </div>
      </div>

      {/* Full-width refiner chart */}
      <div className="px-4 pb-6">
        <RefinerChart />
      </div>
    </main>
  );
}
```

---

## 5. Leaflet Map Component

**File:** `client/components/DisasterMapInner.tsx` (imported dynamically)

```typescript
'use client';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '@/lib/api';

// Fix Leaflet default icon path issue in webpack bundlers
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const EVENT_COLORS: Record<string, string> = {
  wildfire: '#ef4444',
  tropical_storm: '#3b82f6',
  flood: '#06b6d4',
  drought: '#f59e0b',
  coral_bleaching: '#14b8a6',
};

export default function DisasterMapInner() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || map) return;

    const leafletMap = L.map(mapRef.current).setView([0, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(leafletMap);

    setMap(leafletMap);

    return () => { leafletMap.remove(); };
  }, [map]);

  // Load recent alerts as markers
  useEffect(() => {
    if (!map) return;
    api.getRecentAlerts(50).then((alerts: AlertRow[]) => {
      alerts.forEach(alert => {
        const coords = alert.coordinates as { lat: number; lng: number };
        const color = EVENT_COLORS[alert.event_type] ?? '#ffffff';

        L.circleMarker([coords.lat, coords.lng], {
          color,
          fillColor: color,
          fillOpacity: 0.7,
          radius: 6 + (alert.severity ?? 0) * 8,
        })
        .bindPopup(`<b>${alert.event_type}</b><br>${alert.threat_level ?? 'unassessed'} threat<br>${new Date(alert.created_at).toLocaleDateString()}`)
        .addTo(map);
      });
    }).catch(console.error);
  }, [map]);

  return <div ref={mapRef} className="h-[400px] md:h-[600px] rounded-lg z-0" />;
}
```

**Critical:** The `DisasterMap` wrapper in `page.tsx` uses `dynamic` with `ssr: false`. The inner component is the one that actually imports Leaflet. The outer wrapper is just the boundary.

---

## 6. Alerts Feed

```typescript
// client/components/AlertsFeed.tsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const THREAT_BADGE: Record<string, string> = {
  critical: 'bg-red-600',
  high: 'bg-orange-600',
  medium: 'bg-yellow-600',
  low: 'bg-gray-600',
};

export default function AlertsFeed() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.getRecentAlerts(20).then(setAlerts).catch(console.error);
    load();
    const interval = setInterval(load, 60_000);  // refresh every 60s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-3">Recent Alerts</h2>
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {alerts.map(alert => (
          <div
            key={alert.id}
            className="bg-gray-800 rounded p-3 cursor-pointer hover:bg-gray-750"
            onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${THREAT_BADGE[alert.threat_level ?? 'low']}`}>
                {(alert.threat_level ?? 'unassessed').toUpperCase()}
              </span>
              <span className="text-sm font-medium">{alert.event_type.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400 ml-auto">{formatRelativeTime(alert.created_at)}</span>
            </div>
            {expanded === alert.id && (
              <div className="mt-2 text-sm text-gray-300">
                <p>Source: {alert.source}</p>
                <p>Confidence: {alert.confidence_score ? `${(Number(alert.confidence_score) * 100).toFixed(0)}%` : '—'}</p>
              </div>
            )}
          </div>
        ))}
        {alerts.length === 0 && <p className="text-gray-500 text-sm">No alerts yet.</p>}
      </div>
    </div>
  );
}
```

---

## 7. Agent Activity SSE Panel

```typescript
// client/components/AgentActivity.tsx
'use client';
import { useEffect, useState } from 'react';

interface ActivityEntry { agent: string; action: string; detail: string; timestamp: string; }

export default function AgentActivity() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const source = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/agent-activity`);
    source.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data) as ActivityEntry;
        setActivity(prev => [entry, ...prev].slice(0, 50));
      } catch { /* ignore malformed messages */ }
    };
    source.onerror = () => { source.close(); };
    return () => source.close();
  }, []);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-3">Live Pipeline Activity</h2>
      <div className="font-mono text-xs space-y-1 max-h-[200px] overflow-y-auto">
        {activity.map((e, i) => (
          <div key={i} className="text-gray-300">
            <span className="text-gray-500">{formatRelativeTime(e.timestamp)} </span>
            <span className="text-blue-400">[{e.agent}]</span> {e.action}: {e.detail}
          </div>
        ))}
        {activity.length === 0 && <p className="text-gray-500">Waiting for pipeline activity...</p>}
      </div>
    </div>
  );
}
```

---

## 8. Refiner Score Chart

```typescript
// client/components/RefinerChart.tsx
'use client';
import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';

export default function RefinerChart() {
  const [scores, setScores] = useState<RefinerScoreRow[]>([]);

  useEffect(() => {
    api.getRefinerScores().then(setScores).catch(console.error);
  }, []);

  const chartData = scores.map(s => ({
    date: new Date(s.evaluated_at).toLocaleDateString(),
    score: parseFloat(String(s.composite_score)),
    type: s.event_type,
  }));

  if (scores.length === 0) return null;  // don't render chart until there's data

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-1">Prediction Accuracy Over Time</h2>
      <p className="text-xs text-gray-400 mb-3">Refiner/Evaluator scores — higher = more accurate threat predictions</p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
          <Tooltip contentStyle={{ background: '#1f2937', border: 'none' }} />
          <ReferenceLine y={0.60} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Correction threshold', fill: '#ef4444', fontSize: 10 }} />
          <ReferenceLine y={0.85} stroke="#22c55e" strokeDasharray="4 4" label={{ value: 'Success threshold', fill: '#22c55e', fontSize: 10 }} />
          <Line type="monotone" dataKey="score" stroke="#3b82f6" dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

---

## 9. Mobile-First Verification Checklist

Before declaring Phase 8 complete, verify at each breakpoint using browser DevTools:

**375px (iPhone SE — minimum):**
- [ ] No horizontal scroll
- [ ] Map renders and is usable with touch controls
- [ ] Alerts feed cards are readable and tappable
- [ ] Agent activity panel visible (may be small)
- [ ] Refiner chart doesn't overflow its container

**768px (tablet):**
- [ ] Layout improves (optional two-column where appropriate)

**1280px (desktop):**
- [ ] Two-column layout engages (map + right panel)
- [ ] Comfortable density — not too cramped, not too much whitespace

Run `/mobile-review` command to trigger a systematic check.

---

## Acceptance Criteria

1. `npm run build` in `client/` succeeds with zero TypeScript errors
2. App loads at localhost:3001 with all four panels visible
3. Leaflet map renders at 375px without SSR errors in console
4. Map shows colored markers for recent alerts
5. Alerts feed refreshes every 60 seconds and shows correct data
6. Agent Activity SSE panel updates in real time when pipeline processes events
7. Refiner chart renders (with placeholder message when no scores exist yet)
8. No horizontal scroll at 375px viewport
9. Vercel preview deployment builds successfully

---

## Notes / Decisions Log

- `dynamic` with `ssr: false` for Leaflet is mandatory — Leaflet directly accesses `window` and `document` and will throw during SSR. Any component that imports `leaflet` must be wrapped.
- Leaflet default icon path must be manually fixed in webpack builds — the `_getIconUrl` delete hack is the standard solution. Without it, markers render without icons.
- `recharts` chosen over Chart.js — better TypeScript support, React-native components, no canvas setup
- Alerts feed polls every 60s via setInterval — simpler than SSE for a dataset that updates infrequently. Only the Agent Activity panel needs real-time SSE.
- `NEXT_PUBLIC_API_URL` must be set in Vercel environment — it's the Railway backend URL. Don't hardcode it.
- `client/.env.local` for local dev: `NEXT_PUBLIC_API_URL=http://localhost:3000`
