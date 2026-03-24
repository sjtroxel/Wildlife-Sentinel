# Phase 9 — Hardening + Deploy

**Goal:** Production-ready. Tests comprehensive. Deployed to Railway + Vercel. Weekly digest live.

**Status:** 🔲 Not started
**Depends on:** All previous phases complete

---

## 1. Test Coverage

### Vitest (Server)

Coverage target: 80% statement coverage on `server/src/`.

Priority test areas:
- All Scout agents: normalize API responses to RawDisasterEvent correctly
- PostGIS query helper: correct ST_DWithin parameter order (lng, lat) and radius in meters
- ModelRouter: routes to correct SDK per model prefix, logs to model_usage
- Confidence scoring: formula produces correct values for known inputs
- Threat level routing: 'low' dropped, 'critical' routed to HITL, 'medium'/'high' auto-posted
- Refiner scoring: direction + magnitude accuracy formulas
- Redis consumer group creation: try/catch pattern handles existing group gracefully

All LLM calls mocked with fixtures in `server/tests/fixtures/llm/`.

### Playwright E2E (Frontend)

Key scenarios:
- Frontend loads: map renders, alerts feed shows data, agent activity panel visible
- Responsive: all four components visible at 375px without horizontal scroll
- Map: Leaflet markers visible, no console errors
- Refiner chart: renders with data points, threshold lines visible

---

## 2. Error Handling

Every agent failure must:
- Log to `pipeline_events` table with stage='error' and reason
- Post a one-line error to #sentinel-ops war room
- NOT crash the process
- NOT block the pipeline for other events

```typescript
try {
  await enrichmentAgent.process(event);
  await redis.xack(STREAMS.RAW, CONSUMER_GROUPS.ENRICHMENT, messageId);
} catch (err) {
  await logToWarRoom({ agent: 'enrichment', action: 'ERROR', detail: String(err), level: 'warning' });
  await logToDB({ event_id: event.id, stage: 'enrichment', status: 'error', reason: String(err) });
  await redis.xack(STREAMS.RAW, CONSUMER_GROUPS.ENRICHMENT, messageId); // still ack — prevent redelivery loop
}
```

---

## 3. Weekly Digest (Sunday Automation)

Schedule: Every Sunday at 9:00 AM ET via `node-cron`.

**File:** `server/src/discord/weeklyDigest.ts`

Post to both `#wildlife-alerts` (summary embed) and `#sentinel-ops` (detailed stats):

Summary includes:
- Total disaster events detected this week
- Events that passed PostGIS habitat filter
- Alerts posted to #wildlife-alerts
- Which habitats were most active
- Average Refiner composite score for the week (trend: improving/stable/declining)
- Most-at-risk species this week

```typescript
cron.schedule('0 9 * * 0', async () => {
  const stats = await computeWeeklyStats();
  const embed = buildWeeklyDigestEmbed(stats);
  await wildlifeAlertsChannel.send({ embeds: [embed] });
}, { timezone: 'America/New_York' });
```

---

## 4. Rate Limiting + Security

Express endpoints:
- `GET /health`: 60 req/min
- `GET /alerts/*`: 30 req/min
- `GET /agent-activity` (SSE): 10 connections max
- All other endpoints: 60 req/min

```typescript
// Different limiters for SSE vs regular endpoints
const sseLimiter = rateLimit({ windowMs: 60_000, max: 10 });
app.get('/agent-activity', sseLimiter, sseHandler);
```

---

## 5. Railway Deployment

Services:
1. **web** — Express server (`node dist/server.js`)
2. **redis** — Railway managed Redis plugin
3. **worker** — Could be same process or separate (Discord bot + Scout cron jobs)

For simplicity: combine web + worker into a single service. The Discord bot and cron jobs run in the same Node.js process as the Express server.

Railway setup steps:
1. Create new Railway project
2. Connect GitHub repo → auto-deploy on push to `main`
3. Add Redis plugin
4. Set all environment variables (see deployment.md)
5. Run migrations: `npm run migrate:prod`
6. Verify health check: `GET /health` returns 200

---

## 6. Vercel Deployment

Next.js frontend:
1. Connect GitHub repo to Vercel
2. Set `NEXT_PUBLIC_API_URL` to Railway backend URL
3. Framework preset: Next.js (auto-detected)
4. Verify at Vercel preview URL before setting custom domain

---

## 7. Production Smoke Test

After deploy:
1. Verify `GET /health` from Railway URL
2. Verify frontend loads from Vercel URL at both mobile (375px) and desktop (1280px)
3. Trigger a manual test event (POST to a test endpoint) → verify Discord message appears
4. Verify Refiner queue is processing
5. Run `/phase-check` command to confirm all items complete

---

## Acceptance Criteria

1. `npm run test` passes with ≥ 80% statement coverage
2. Playwright E2E suite: all scenarios pass
3. Railway backend health check: `{ status: 'ok', db: 'connected', redis: 'connected', discord: 'connected' }`
4. Vercel frontend loads without errors at both viewports
5. Weekly digest cron job fires and posts to Discord
6. A real disaster event flows end-to-end in production and appears in Discord

---

## Notes / Decisions Log

*(Add notes here as Phase 9 progresses)*
