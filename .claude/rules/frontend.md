# Frontend Rules

## Framework: Next.js 15 (App Router)

This is a **read-only informational page**. No user accounts, no sessions, no forms, no auth. Keep it simple. The frontend exists for portfolio visitors who aren't on Discord.

Use the App Router (`app/` directory), not the Pages Router.

## What the Frontend Shows

1. **World map** (Leaflet.js) — disaster events (color-coded by type) + IUCN habitat polygons
2. **Recent Alerts feed** — last 15-20 alerts from the DB, mirrored from Discord posts
3. **Agent Activity panel** — SSE stream of what agents are doing right now (same observability pattern as Asteroid Bonanza)
4. **Refiner accuracy chart** — trend of prediction accuracy scores over time

## What the Frontend Does NOT Have

- User authentication
- Search or filtering
- Any form inputs
- User-generated content

## Responsive Layout

**Mobile-first.** Always.

```
Base (375px):    Single-column, full-width map, stacked panels
md: (768px):     Two-column layout possible
lg: (1280px):    Full dashboard layout
```

The Leaflet map must work on mobile (touch controls). Test at 375px width before declaring any map feature complete.

## Leaflet in Next.js

Leaflet requires the browser DOM and will fail during Next.js server-side rendering. Handle this with dynamic imports:

```typescript
import dynamic from 'next/dynamic';

const DisasterMap = dynamic(() => import('@/components/DisasterMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Loading map...</div>,
});
```

Any component that imports Leaflet must be wrapped in `dynamic` with `ssr: false`. Do NOT try to `import L from 'leaflet'` in a server component.

## SSE Agent Activity Stream

The Agent Activity panel uses Server-Sent Events, same pattern as Asteroid Bonanza:

```typescript
// client-side (React component)
useEffect(() => {
  const source = new EventSource('/api/agent-activity');
  source.onmessage = (e) => {
    const event = JSON.parse(e.data);
    setActivity(prev => [event, ...prev].slice(0, 50)); // keep last 50
  };
  return () => source.close();
}, []);
```

```typescript
// Next.js API route: app/api/agent-activity/route.ts
export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      // subscribe to Redis agent:activity stream
      // push events as SSE
    }
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

## Disaster Event Colors

Consistent color coding across map markers and UI elements:

```typescript
export const EVENT_COLORS = {
  wildfire: '#ef4444',           // red
  tropical_storm: '#3b82f6',     // blue
  flood: '#06b6d4',              // cyan
  drought: '#f59e0b',            // amber
  coral_bleaching: '#14b8a6',    // teal
} as const;
```

## Tailwind CSS v4

Use Tailwind CSS v4 CSS-first configuration (`@theme {}` in a global CSS file). No `tailwind.config.js`.

## What NOT to Do

- Do NOT add authentication — this is a public read-only display
- Do NOT import Leaflet in server components — use `dynamic` with `ssr: false`
- Do NOT build complex interaction — just observation
- Do NOT use inline styles — use Tailwind utility classes
- Do NOT forget to test at 375px viewport width
