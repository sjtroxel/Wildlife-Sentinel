# Phase 9 — Hardening + Deploy

**Goal:** Production-ready. Test coverage meets threshold. Deployed to Railway + Vercel. Weekly digest running. Smoke test passes in production.

**Status:** Not started
**Depends on:** All previous phases complete
**Estimated sessions:** 2–3

---

## 1. Test Coverage Target

80% statement coverage on `server/src/`. Run: `npm run test:coverage`

### Priority test areas (highest value / most likely to catch regressions)

| Area | Why it matters |
|---|---|
| Scout normalization | Wrong FRP threshold or severity formula breaks all downstream processing |
| PostGIS query parameters | `ST_Point(lng, lat)` order is the #1 spatial bug — test it explicitly |
| Enrichment drop logic | Events without habitat must never reach Discord |
| ModelRouter routing | Sending Claude requests to Gemini endpoint (or vice versa) is a silent failure |
| Confidence scoring formula | Agent confidence is cited in Discord alerts — formula must be correct |
| Threat level routing | 'low' must never post, 'critical' must always go through HITL |
| Refiner scoring math | compositeScore = 0.6 * direction + 0.4 * magnitude — test known inputs |
| XREADGROUP consumer loop | try/catch + XACK after error must not lose messages |

### Test file structure

```
server/tests/
├── fixtures/
│   ├── llm/
│   │   ├── threat-assessment-wildfire.json      <- Claude response fixture
│   │   ├── threat-assessment-storm.json
│   │   ├── synthesis-output.json
│   │   └── refiner-correction-note.json
│   ├── apis/
│   │   ├── firms-response-with-fires.csv        <- real-ish FIRMS CSV
│   │   ├── firms-response-empty.csv             <- no-fire response
│   │   ├── open-meteo-response.json
│   │   ├── gbif-response.json
│   │   └── nhc-current-storms.json
├── scouts/
│   ├── FirmsScout.test.ts
│   ├── NhcScout.test.ts
│   └── UsgsScout.test.ts
├── agents/
│   ├── EnrichmentAgent.test.ts
│   ├── HabitatAgent.test.ts
│   ├── ThreatAssessmentAgent.test.ts
│   └── SynthesisAgent.test.ts
├── router/
│   └── ModelRouter.test.ts
├── refiner/
│   └── RefinerScoring.test.ts
└── health.test.ts
```

### Key test patterns

```typescript
// Pattern: mock ModelRouter in every agent test
vi.mock('../../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn().mockResolvedValue({
      content: JSON.stringify(loadFixture('llm/threat-assessment-wildfire.json')),
      model: 'claude-sonnet-4-6',
      inputTokens: 500,
      outputTokens: 150,
      estimatedCostUsd: 0.003,
    }),
    embed: vi.fn().mockResolvedValue([[0.1, 0.2, /* 768 values */]]),
  },
}));

// Pattern: test that 'low' threat events are NOT published to discord:queue
it('does not publish low-threat events to discord:queue', async () => {
  const xaddSpy = vi.spyOn(redis, 'xadd');
  await runSynthesisAgent(lowThreatEvent);
  expect(xaddSpy).not.toHaveBeenCalledWith('discord:queue', expect.anything());
});

// Pattern: test PostGIS parameter order explicitly
it('passes coordinates as (lng, lat) not (lat, lng) to ST_Point', async () => {
  await processEnrichmentEvent(testEvent);
  const sqlCalls = vi.mocked(sql).mock.calls;
  // The ST_Point call must have longitude (104.21) as first arg, latitude (-3.42) as second
  expect(sqlCalls.some(call => String(call).includes('104.21') && String(call).includes('-3.42'))).toBe(true);
});
```

---

## 2. Playwright E2E (Frontend)

```bash
cd client/
npm install -D @playwright/test
npx playwright install chromium
```

### `client/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3001',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone SE'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
  },
});
```

### `client/e2e/dashboard.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('loads all four panels', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Wildlife Sentinel')).toBeVisible();
  await expect(page.locator('[class*="map"]').first()).toBeVisible();
  await expect(page.getByText('Recent Alerts')).toBeVisible();
  await expect(page.getByText('Live Pipeline Activity')).toBeVisible();
});

test('no horizontal scroll at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const windowWidth = await page.evaluate(() => window.innerWidth);
  expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 1);  // 1px tolerance
});

test('map renders without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('/');
  await page.waitForTimeout(2000);  // wait for Leaflet to initialize
  const leafletErrors = errors.filter(e => e.toLowerCase().includes('leaflet'));
  expect(leafletErrors).toHaveLength(0);
});
```

---

## 3. Error Handling Hardening

Every agent's consumer loop must follow this error pattern:

```typescript
// Correct: ACK on both success AND failure to prevent infinite redelivery
try {
  await processEvent(event);
  await redis.xack(stream, group, messageId);
} catch (err) {
  // Log the error but DO NOT rethrow — the loop must continue for other events
  console.error(`[agent] Error processing ${event.id}:`, err);
  await logToWarRoom({ agent, action: 'ERROR', detail: String(err), level: 'warning' });
  await logPipelineEvent({ event_id: event.id, source: event.source, stage, status: 'error', reason: String(err) });
  await redis.xack(stream, group, messageId);  // Still ACK — prevent redelivery loop
}
```

Verify every agent follows this pattern before Phase 9 is complete.

---

## 4. Rate Limiting (Per-Route Tightening)

Phase 0 applied a global 100 req/min limiter. Phase 9 adds per-route limits:

```typescript
import rateLimit from 'express-rate-limit';

// Different limiters for different endpoints
const alertsLimiter = rateLimit({ windowMs: 60_000, max: 30 });
const sseLimiter = rateLimit({ windowMs: 60_000, max: 10 });   // SSE is expensive
const healthLimiter = rateLimit({ windowMs: 60_000, max: 60 });
const costsLimiter = rateLimit({ windowMs: 60_000, max: 10 });  // Admin endpoints

app.use('/health', healthLimiter, healthRouter);
app.use('/alerts', alertsLimiter, alertsRouter);
app.use('/agent-activity', sseLimiter, agentActivityRouter);
app.use('/admin', costsLimiter, adminRouter);
```

---

## 5. Weekly Digest

### `server/src/discord/weeklyDigest.ts`

```typescript
import cron from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import { sql } from '../db/client.js';
import { getSentinelOpsChannel, getWildlifeAlertsChannel } from './bot.js';

export function scheduleWeeklyDigest(): void {
  // Every Sunday at 9:00 AM ET
  cron.schedule('0 9 * * 0', async () => {
    try {
      const stats = await computeWeeklyStats();
      await postWeeklyDigest(stats);
    } catch (err) {
      console.error('[weekly-digest] Failed:', err);
    }
  }, { timezone: 'America/New_York' });

  console.log('[weekly-digest] Scheduled (Sunday 9 AM ET)');
}

interface WeeklyStats {
  totalEventsDetected: number;
  eventsPassedHabitatFilter: number;
  alertsPosted: number;
  criticalAlerts: number;
  avgRefinerScore: number | null;
  mostActiveSource: string;
  topSpeciesAtRisk: string[];
}

async function computeWeeklyStats(): Promise<WeeklyStats> {
  const [rawCount, enrichedCount, alertsCount, refinerAvg, sourceBreakdown, topSpecies] = await Promise.all([
    sql<{count: string}[]>`SELECT COUNT(*)::text as count FROM pipeline_events WHERE stage = 'raw' AND created_at > NOW() - INTERVAL '7 days'`,
    sql<{count: string}[]>`SELECT COUNT(*)::text as count FROM pipeline_events WHERE stage = 'enriched' AND created_at > NOW() - INTERVAL '7 days'`,
    sql<{count: string; critical_count: string}[]>`
      SELECT COUNT(*)::text as count, SUM(CASE WHEN threat_level = 'critical' THEN 1 ELSE 0 END)::text as critical_count
      FROM alerts WHERE created_at > NOW() - INTERVAL '7 days' AND threat_level IS NOT NULL
    `,
    sql<{avg: string}[]>`SELECT AVG(composite_score)::text as avg FROM refiner_scores WHERE evaluated_at > NOW() - INTERVAL '7 days'`,
    sql<{source: string; count: string}[]>`
      SELECT source, COUNT(*)::text as count FROM pipeline_events
      WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY source ORDER BY COUNT(*) DESC LIMIT 1
    `,
    sql<{species: string}[]>`
      SELECT unnest(string_to_array(enrichment_data->>'species', ',')) as species, COUNT(*) as count
      FROM alerts WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY species ORDER BY count DESC LIMIT 3
    `,
  ]);

  return {
    totalEventsDetected: parseInt(rawCount[0]?.count ?? '0'),
    eventsPassedHabitatFilter: parseInt(enrichedCount[0]?.count ?? '0'),
    alertsPosted: parseInt(alertsCount[0]?.count ?? '0'),
    criticalAlerts: parseInt(alertsCount[0]?.critical_count ?? '0'),
    avgRefinerScore: refinerAvg[0]?.avg ? parseFloat(refinerAvg[0].avg) : null,
    mostActiveSource: sourceBreakdown[0]?.source ?? 'none',
    topSpeciesAtRisk: topSpecies.map(r => r.species).filter(Boolean),
  };
}

async function postWeeklyDigest(stats: WeeklyStats): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle('Weekly Wildlife Sentinel Digest')
    .setDescription(`Summary for the week ending ${new Date().toLocaleDateString()}`)
    .addFields(
      { name: 'Events Detected', value: String(stats.totalEventsDetected), inline: true },
      { name: 'Passed Habitat Filter', value: String(stats.eventsPassedHabitatFilter), inline: true },
      { name: 'Alerts Posted', value: String(stats.alertsPosted), inline: true },
      { name: 'Critical Alerts', value: String(stats.criticalAlerts), inline: true },
      { name: 'Avg Refiner Score', value: stats.avgRefinerScore !== null ? stats.avgRefinerScore.toFixed(3) : 'No data', inline: true },
      { name: 'Most Active Source', value: stats.mostActiveSource, inline: true },
      { name: 'Top Species at Risk', value: stats.topSpeciesAtRisk.join(', ') || 'None', inline: false },
    )
    .setFooter({ text: 'Wildlife Sentinel • Weekly Digest' })
    .setTimestamp();

  await getWildlifeAlertsChannel().send({ embeds: [embed] });
}
```

---

## 6. Railway Deployment

### `railway.toml`

```toml
[build]
command = "npm ci --include=dev && npm run build"

[deploy]
startCommand = "node server/dist/server.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
```

**Critical:** `npm ci --include=dev` — not `npm ci`. In `NODE_ENV=production`, plain `npm ci` skips devDependencies including TypeScript. Build fails with `tsc: command not found`.

### Railway setup steps

1. Create new Railway project (not reusing Asteroid Bonanza)
2. Connect GitHub repo → auto-deploy on push to `main`
3. Add Redis plugin (gets `REDIS_URL` auto-injected)
4. Set all environment variables in Railway dashboard:
   ```
   DATABASE_URL      <- Neon connection string
   DISCORD_BOT_TOKEN
   DISCORD_GUILD_ID
   DISCORD_CHANNEL_WILDLIFE_ALERTS
   DISCORD_CHANNEL_SENTINEL_OPS
   NASA_FIRMS_API_KEY
   GOOGLE_AI_API_KEY
   ANTHROPIC_API_KEY
   IUCN_API_TOKEN
   NODE_ENV=production
   ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app
   ```
5. Run migrations: trigger via Railway CLI or one-off deploy command
6. Verify: `GET https://your-railway-url.railway.app/health`

---

## 7. Vercel Deployment

1. Connect GitHub repo to Vercel
2. Set root directory: `client`
3. Framework preset: Next.js (auto-detected)
4. Set environment variable: `NEXT_PUBLIC_API_URL=https://your-railway-url.railway.app`
5. Verify at Vercel preview URL before marking complete
6. Update Railway `ALLOWED_ORIGINS` to include the Vercel URL

---

## 8. Production Smoke Test

After both services are deployed, run through this checklist:

```
[ ] GET /health returns { status: 'ok', db: 'connected', redis: 'connected', discord: 'connected' }
[ ] Frontend loads at Vercel URL — no console errors
[ ] Frontend renders at 375px mobile viewport — no horizontal scroll
[ ] Discord bot shows as online in server member list
[ ] Bot has posted startup message to #sentinel-ops
[ ] Wait 10 minutes — verify FIRMS Scout logged something to #sentinel-ops
[ ] Inject test event to disaster:raw via Railway one-off run and verify Discord alert appears
[ ] GET /admin/costs returns running cost data
[ ] Refiner queue shows expected 24h/48h entries for any recent alerts
```

---

## Acceptance Criteria

1. `npm run test:coverage` reports ≥ 80% statement coverage on `server/src/`
2. All LLM calls in tests use fixtures — no real API calls
3. Playwright E2E: all three scenarios pass at both Desktop Chrome and iPhone SE
4. Railway health check: `{ status: 'ok' }` from deployed URL
5. Vercel frontend builds and serves correctly
6. Weekly digest cron job is registered in the running Railway process
7. Production smoke test checklist fully checked
8. No unhandled promise rejections in Railway logs for first 24h of operation

---

## Notes / Decisions Log

- Single Railway service (web + worker + bot + cron all in one process) — simplest deployment model. Only split into separate services if Railway memory limits are hit.
- Migration runner (`npm run migrate:prod`) executed manually before first Railway deploy, and whenever new migrations are added. Not run automatically on startup — too risky.
- Playwright headless in CI — no need for headed mode. `chromium` driver only.
- Weekly digest time zone: America/New_York — use `node-cron`'s timezone option. Server runs on Railway in UTC, but the schedule must fire at 9 AM ET for the Discord community.
