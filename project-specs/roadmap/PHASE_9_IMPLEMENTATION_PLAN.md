# Phase 9 Implementation Plan — Hardening + Deploy

## Context

Phase 9 converts a working system into a production-ready deployed product.
The backend pipeline (Phases 0–7), Discord bot, and frontend (Phase 8) are all complete.

sjtroxel's first Railway + Vercel deployment from scratch. Patterns must be explicit.

---

## Pre-Phase Checklist

Before writing any new code, confirm:

- [ ] `npm test --workspace=server` — all 139 tests pass
- [ ] `npm run build --workspace=client` — zero TypeScript errors
- [ ] `npm run typecheck` — zero errors
- [ ] Railway project created (railway.com → New Project → Empty)
- [ ] Redis service added in Railway (Add Service → Database → Redis)
- [ ] Vercel project created (vercel.com → New Project → Import from GitHub)
- [ ] All required environment variables listed below are in hand

---

## Track 0 — Rate Limit Resilience (do before deployment, before coverage)

Observed in dev: the pipeline hits Google free-tier limits within minutes of a real fire event cluster. These two fixes are **pre-deployment blockers** — deploying without them means the production system silently drops events under load.

### Step 0.1 — Retry-with-delay in `ModelRouter.ts`

Both 429 (rate limit) and 503 (transient overload) responses from Google include a `retryDelay` field in the error body. Currently `ModelRouter` throws immediately. It should parse that delay and wait before retrying.

**Implementation in `completeGoogle()` and `embed()`:**

```typescript
// Parse retryDelay from Google 429/503 error body
function parseRetryDelayMs(errorBody: string): number | null {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { details?: Array<{ '@type': string; retryDelay?: string }> }
    };
    const retryInfo = parsed.error?.details?.find(
      d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo'
    );
    if (retryInfo?.retryDelay) {
      // retryDelay is e.g. "12s" or "12.882280697s"
      return Math.ceil(parseFloat(retryInfo.retryDelay) * 1000);
    }
  } catch { /* ignore */ }
  return null;
}
```

**Retry logic:** up to 3 attempts. On 429/503, wait the `retryDelay` returned by the API (or a default of 15s if not parseable), then retry. On 4th failure, throw.

**Applies to:**
- `completeGoogle()` — Flash + Flash-Lite generation calls
- `embed()` — the raw `fetch()` call to the embedding endpoint

**Do NOT retry Anthropic calls** — Claude 429s are billing/capacity issues, not transient. Log and throw immediately.

### Step 0.2 — Embedding cache in Redis

The Species Context Agent embeds the same query strings repeatedly (e.g. "Panthera tigris threats habitat" appears for every Borneo fire event). This burns the 1,000/day embedding quota fast.

**Implementation in `server/src/rag/retrieve.ts`:**

```typescript
import { redis } from '../redis/client.js';

async function getCachedEmbedding(query: string): Promise<number[] | null> {
  const key = `embed:${Buffer.from(query).toString('base64').slice(0, 64)}`;
  const cached = await redis.get(key);
  return cached ? (JSON.parse(cached) as number[]) : null;
}

async function setCachedEmbedding(query: string, vector: number[]): Promise<void> {
  const key = `embed:${Buffer.from(query).toString('base64').slice(0, 64)}`;
  await redis.setex(key, 86_400, JSON.stringify(vector)); // 24h TTL
}
```

In `retrieveSpeciesFacts()` and `retrieveConservationContext()`: check cache before calling `modelRouter.embed()`. Store result after a live call.

**Expected impact:** 80%+ reduction in embedding calls during a fire cluster, since the same species appear across many nearby events.

**Key constraint:** TTL is 24h — embeddings don't change, so this is safe to cache aggressively.

### Step 0.3 — Verify/update model limits in `shared/models.ts` comments

The dev logs revealed that `gemini-2.5-flash-lite` is hitting a **20 RPD** limit, not the 1,000 RPD documented in `model-router.md`. Check the actual quota at `ai.dev/rate-limit` before deploying — if 20 RPD is the real limit, either:
- Upgrade to paid Google tier (recommended — cost is negligible at this volume)
- Or switch the EnrichmentAgent weather summary to a simpler non-LLM approach (Open-Meteo returns structured data; the LLM summary step could be skipped)

Update `model-router.md` and `shared/models.ts` comments to reflect confirmed real limits.

### Step 0.4 — Suppress full stack traces on known transient errors

Currently a 429 or 503 prints a wall of JSON to the console. Noisy and obscures real errors. In ModelRouter, catch 429/503 specifically and log a one-liner:

```
[model-router] Rate limited (gemini-2.5-flash-lite) — retrying in 8s (attempt 1/3)
```

Full error JSON only logged if all retries are exhausted.

---

## Track 1 — Coverage (60% → as high as meaningful)

The 80% Vitest threshold is the minimum gate, not the goal. The agents (`src/agents`) and the ModelRouter (`src/router`) are the **system's core intelligence** — they contain all the consequential logic. 46% agent coverage and 23% router coverage means the most important code in this system has the weakest tests. Fix that first. The arbitrary percentage follows naturally.

### Current State (run `npm run test --workspace=server -- --coverage`)

| Directory | Current | Real Target | Strategy |
|---|---|---|---|
| `src/db` | 3% | ~90% | 3 thin SQL wrapper files — mock `sql`, test each function |
| `src/pipeline` | 0% | ~90% | ThreatAssembler has real logic — mock Redis + XADD |
| `src/discord` | 0% | ~70% | warRoom testable; publisher happy path + error swallow; hitl/bot = integration only |
| `src/router` | 23% | ~85% | Mock Anthropic SDK + fetch — full routing + embed + cost tracking |
| `src/agents` | 46% | ~85% | 5 agents — the hardest AND most valuable tests in the project |
| `src/refiner` | 88% | ~90% | RefinerScheduler excluded; RefinerAgent branch gaps only |

### Step 1.1 — `server/tests/db/` (quick wins, ~30 min)

Three new test files — each mocks `sql` the same way health.test.ts does.

**`agentPrompts.test.ts`**
- `getAgentPrompt('threat-assessment')` — sql returns a row → returns string
- `getAgentPrompt('missing')` — sql returns [] → throws "No prompt found"

**`modelUsage.test.ts`**
- `logModelUsage(record)` — verify sql called once
- `getTotalCostUsd()` — sql returns `[{ total: '4.20' }]` → returns 4.20
- `getTotalCostUsd()` — sql returns [] → returns 0 (null coalesce)
- `getCostByModel()` — returns array with model + total_cost + call_count

**`pipelineEvents.test.ts`**
- Read the file first. Test each exported function similarly.

### Step 1.2 — `server/tests/pipeline/ThreatAssembler.test.ts`

Mock ioredis. The assembler only publishes to `STREAMS.ASSESSED` when all 3 parts are present.

Key test cases:
- `storeEventForAssembly` → hset called with 'event' key, expire set to 300s
- Store event + habitat only → `xadd` NOT called (partial assembly)
- Store event + habitat + species → `xadd` called with merged `FullyEnrichedEvent`, `del` called
- Second agent arrival triggers assembly (both orderings: habitat-then-species, species-then-habitat)

### Step 1.3 — `server/tests/discord/warRoom.test.ts`

Mock `discord.js`, `./bot.js`, and `../redis/client.js`.

Key test cases:
- `logToWarRoom({ agent, action, detail })` → `getSentinelOpsChannel().send()` called with formatted string
- Level 'alert' → message contains 🔴, level 'warning' → ⚠️, default → ⚙️
- Also calls `redis.publish('agent:activity', ...)` with JSON payload
- Error thrown by Discord send → swallowed (no throw from `logToWarRoom`)
- Error thrown by redis.publish → swallowed (inner try/catch)

Rate-limiting logic (MIN_POST_INTERVAL_MS = 500):
- Two calls < 500ms apart → second waits (use `vi.useFakeTimers()` to verify delay)

### Step 1.4 — `server/tests/router/ModelRouter.test.ts`

This is high-value: ModelRouter is the only file that touches both AI SDKs. It handles routing, cost computation, rate limiting, and embedding. It needs thorough tests.

Use `vi.hoisted()` to define mock SDK instances before the module is loaded (same lesson as agentActivity test).

Mock patterns:
```typescript
const { mockAnthropicMessages, mockGoogleModel } = vi.hoisted(() => {
  const mockAnthropicMessages = {
    create: vi.fn(),
  };
  const mockGoogleModel = {
    generateContent: vi.fn(),
  };
  return { mockAnthropicMessages, mockGoogleModel };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: mockAnthropicMessages,
  })),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue(mockGoogleModel),
  })),
}));
```

Stub `global.fetch` for the embedding endpoint (it uses raw `fetch`, not the Google SDK).

Key test cases:
- `complete({ model: 'claude-sonnet-4-6', ... })` → calls Anthropic SDK, returns RouterResponse with correct shape
- `complete({ model: 'gemini-2.5-flash', ... })` → calls Google SDK
- `complete({ model: 'gemini-2.5-flash-lite', ... })` → calls Google SDK (separate Flash-Lite path if any)
- `complete({ model: 'unknown-model', ... })` → throws "unknown model prefix"
- `complete({ jsonMode: true, ... })` → verify correct response_format is passed to Anthropic
- `embed('some text')` → calls fetch with correct URL and body, returns `number[][]`
- `embed(['a', 'b'])` → called twice (array input), returns two embedding arrays
- Cost tracking: `getRunningCostUsd()` increments correctly after each completion
- Cost tracking: after 10 calls, `logModelUsage` is called (verify the DB logging flush threshold)
- Google rate limit: after 15 calls within a minute, verify the router waits for rate limit window reset

### Step 1.5 — `server/tests/agents/` (highest effort, highest value)

The 5 agents are the system's core intelligence. Every significant behavior path — happy path, malformed LLM output, missing habitat, network failure — needs a test. These aren't box-checking tests. They verify that the system behaves correctly in every scenario that will actually happen in production.

**Standard mock block** (same in every agent test file):
```typescript
vi.mock('../../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn().mockResolvedValue({
      content: JSON.stringify(fixture),
      model: 'gemini-2.5-flash-lite',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0,
    }),
    embed: vi.fn().mockResolvedValue([new Array(768).fill(0.1)]),
  },
}));
vi.mock('../../src/db/client.js', () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn() }),
}));
vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    xadd: vi.fn().mockResolvedValue('1234-0'),
    hset: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    hgetall: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('../../src/discord/warRoom.js', () => ({
  logToWarRoom: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: { RAW: 'disaster:raw', ENRICHED: 'disaster:enriched', ASSESSED: 'alerts:assessed', DISCORD: 'discord:queue' },
  CONSUMER_GROUPS: { ENRICHMENT: 'enrichment-group', HABITAT: 'habitat-group', SPECIES: 'species-group', THREAT: 'threat-group', DISCORD: 'discord-group' },
  ensureConsumerGroup: vi.fn().mockResolvedValue(undefined),
}));
```

**Fixtures needed** (add to `server/tests/fixtures/llm/` — read each agent's schema first):
- `enrichment-output.json` — full `EnrichedDisasterEvent` fields (wind, weather_summary, etc.)
- `habitat-output.json` — `{ gbif_recent_sightings: [...], sighting_confidence: 'confirmed', most_recent_sighting: '2026-01-01' }`
- `species-context-output.json` — `{ species_briefs: [{ species_name, common_name, iucn_status, ... }] }`
- `threat-assessment-output.json` — check if exists; create/extend as needed
- `synthesis-output.json` — `{ synthesized_narrative: '...', embed_data: { title, description, ... } }`

**Priority order** (most consequential first):
1. `EnrichmentAgent.test.ts` — the first LLM agent in the pipeline. Drop logic (no habitat → no publish) is critical.
2. `ThreatAssessmentAgent.test.ts` — reads system prompt from DB, calls Claude Sonnet. Extend existing test if present.
3. `SynthesisAgent.test.ts` — generates the Discord embed. Malformed output path matters a lot (audience-facing).
4. `HabitatAgent.test.ts`
5. `SpeciesContextAgent.test.ts`

**Key test cases per agent:**
- Happy path: XREADGROUP returns a valid event → processed → XACK called with correct message ID
- LLM returns valid JSON matching schema → downstream XADD called with enriched event
- LLM returns malformed JSON → error is caught, `logToWarRoom` called with warning, XACK still called (no message loss — critical)
- LLM call throws (network error) → same: caught, logged, XACK called
- **EnrichmentAgent specific:** SQL returns no habitat rows → event dropped, XADD to disaster:enriched NOT called, drop logged to warRoom
- **EnrichmentAgent specific:** Open-Meteo fetch fails → event still enriched with null weather fields (graceful degradation)
- **ThreatAssessmentAgent specific:** `getAgentPrompt` call fails → error propagates correctly
- **ThreatAssessmentAgent specific:** Correction Note from DB is prepended to system prompt
- **SynthesisAgent specific:** threat_level 'low' → XADD to discord:queue NOT called
- **SynthesisAgent specific:** threat_level 'critical' → channel in queue item is 'sentinel-ops-review'

### Step 1.6 — Verify threshold met

```bash
npm run test --workspace=server -- --coverage
```

Adjust exclusions in `vitest.config.ts` if integration-only files (redis/client.ts, discord/bot.ts) are pulling down the average unfairly. These are infrastructure singletons — they can be explicitly excluded:

```typescript
exclude: ['src/server.ts', 'src/**/*.d.ts', 'src/db/migrations/**',
          'src/redis/client.ts',   // connection singleton — no testable logic
          'src/discord/bot.ts',    // discord.js lifecycle — integration only
          'src/scouts/index.ts'],  // cron starter — integration only
```

---

## Track 2 — Weekly Digest

### Step 2.1 — Create `server/src/discord/weeklyDigest.ts`

Runs every Sunday at 18:00 UTC via `node-cron` (same pattern as RefinerScheduler).

Content (one Discord embed to #wildlife-alerts):
```
📊 Weekly Wildlife Sentinel Report
• X alerts fired this week (N critical, N high, N medium)
• Most active event type: wildfire / flood / etc.
• Average prediction accuracy: X% (from refiner_scores)
• Species most frequently at risk: [top 3]
• Total AI cost this week: $X.XX
```

Query needed:
```sql
SELECT threat_level, COUNT(*) FROM alerts
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY threat_level;

SELECT AVG(composite_score)::numeric(4,2) FROM refiner_scores
WHERE evaluated_at > NOW() - INTERVAL '7 days';
```

Export: `startWeeklyDigestScheduler()` — add to `server.ts` startup.

### Step 2.2 — Wire into `server.ts`

```typescript
import { startWeeklyDigestScheduler } from './discord/weeklyDigest.js';
startWeeklyDigestScheduler();
```

---

## Track 3 — Playwright E2E

### Step 3.1 — Install Playwright

```bash
npm install --save-dev @playwright/test --workspace=client
npx playwright install chromium
```

Create `client/playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3001',
    viewport: { width: 375, height: 812 },  // mobile base
  },
  webServer: {
    command: 'npm run dev',
    port: 3001,
    reuseExistingServer: !process.env['CI'],
  },
});
```

### Step 3.2 — Create `client/e2e/` tests

**`layout.spec.ts`**
- Page loads (200, no console errors)
- Header contains "Wildlife Sentinel"
- At 375px: no horizontal scroll (`body.scrollWidth <= 375`)
- All 4 panels present: map container, alerts feed heading, agent activity heading, (refiner chart OR null)

**`map.spec.ts`**
- Map tile layer loads (OSM tile request in network)
- Map container has non-zero dimensions

**`responsive.spec.ts`**
- At 768px: right panel visible alongside map
- At 1280px: two-column grid layout

Add to `client/package.json` scripts:
```json
"e2e": "playwright test",
"e2e:headed": "playwright test --headed"
```

---

## Track 4 — Railway Deployment

### Step 4.1 — Create `railway.toml`

```toml
[build]
command = "npm ci --include=dev && npm run build --workspace=server"

[deploy]
startCommand = "node server/dist/server.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

**Critical:** `npm ci --include=dev` — plain `npm ci` skips TypeScript in `NODE_ENV=production`.

### Step 4.2 — Confirm server `tsconfig.json` output path

The build must produce `server/dist/server.js`. Check `server/tsconfig.json`:
```json
"outDir": "dist"
```

Start command references `server/dist/server.js` because Railway runs from repo root.

### Step 4.3 — Set Railway environment variables

Via Railway dashboard → project → Variables. Required vars:

```
DATABASE_URL           # from Neon project → Connection string
REDIS_URL              # auto-populated by Railway Redis service
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
DISCORD_CHANNEL_WILDLIFE_ALERTS
DISCORD_CHANNEL_SENTINEL_OPS
NASA_FIRMS_API_KEY
GOOGLE_AI_API_KEY
ANTHROPIC_API_KEY
IUCN_API_TOKEN
NODE_ENV=production
ALLOWED_ORIGINS=https://your-app.vercel.app  # set after Vercel deploy
```

### Step 4.4 — First deploy + health check

```bash
# In Railway UI: Deploy → watch logs for:
#   "Server running on port ..."
#   "Bot connected."
#   "Consumer group ready."

# Confirm health endpoint responds:
curl https://your-app.railway.app/health
# → { "status": "ok", "db": "connected", "redis": "connected", "discord": "connected" }
```

### Step 4.5 — Run production migrations

```bash
DATABASE_URL=<neon-production-url> npm run migrate
```

All 8 migrations (0001–0008) should be marked `[skip]` since they were already applied. Verify the migrate script's `[migrate] All migrations current.` output.

---

## Track 5 — Vercel Deployment

### Step 5.1 — Connect repo to Vercel

Vercel dashboard → New Project → Import Git Repository → select `wildlife-sentinel`.

Settings:
- **Framework Preset:** Next.js
- **Root Directory:** `client`
- **Build Command:** `npm run build` (auto-detected)
- **Output Directory:** `.next` (auto-detected)

### Step 5.2 — Set Vercel environment variables

```
NEXT_PUBLIC_API_URL=https://your-app.railway.app
```

Only this one. Never put secret API keys in `NEXT_PUBLIC_` variables.

### Step 5.3 — Deploy and confirm

After deploy, visit `https://your-app.vercel.app`:
- Map loads (Leaflet tiles visible)
- Alerts feed renders (empty array is fine — says "No alerts yet")
- Agent Activity panel visible
- No console errors
- No horizontal scroll at 375px

---

## Track 6 — CORS + ALLOWED_ORIGINS

After Vercel deploy URL is known:

1. Set `ALLOWED_ORIGINS=https://your-app.vercel.app` on Railway
2. Redeploy Railway service
3. Confirm browser can fetch `https://your-app.railway.app/alerts/recent` without CORS error

---

## Track 7 — Smoke Test Checklist

Run this checklist after both services are deployed:

```
□ GET /health → { status: 'ok', db: 'connected', redis: 'connected', discord: 'connected' }
□ GET /alerts/recent → JSON array (empty OK)
□ GET /refiner/scores → JSON array (empty OK)
□ GET /habitats?minLng=-10&minLat=-10&maxLng=10&maxLat=10 → GeoJSON FeatureCollection
□ curl -N /agent-activity → stays open (SSE)
□ Discord bot is online in the server member list
□ Post a test message to #sentinel-ops manually via /admin in Discord
□ Frontend loads at Vercel URL on mobile
□ Frontend loads at Vercel URL at 1280px
□ Leaflet map tiles render
□ CORS: fetch /alerts/recent from browser console on Vercel URL → no CORS error
```

---

## Spec Decisions / Scope Notes

| Item | Decision |
|---|---|
| `/admin/costs` endpoint authentication | **Not adding auth** — cost endpoint is low-risk, consistent with read-only public stance. Can be addressed in Phase 10 if needed. |
| `RefinerScheduler.ts` coverage | Add to vitest exclude list — it's a node-cron lifecycle wrapper with no testable logic beyond mocking the entire cron library. |
| `src/discord/publisher.ts` coverage | Target partial coverage (~50%) — happy path + error swallow. Full coverage requires complex Discord.js embed mock. |
| `src/discord/hitl.ts` coverage | Skip for now — HITL reaction collector requires a complex Discord event mock. Mark as integration-only. |
| `src/redis/client.ts` coverage | Exclude from coverage — it's a connection singleton with no testable logic. |
| `src/scouts/index.ts` coverage | Exclude from coverage — it's the cron startup wrapper. |
| Weekly digest scope | Simple embed only. No threading, no attachment, no chart image. Chart image can be Phase 10. |
| Playwright API mocking | Tests run against the real dev server with real API calls to localhost:3000 (which must be running). Use `webServer` config for client. For API responses, use fixtures via route mocking only if tests become flaky. |

---

## File Manifest

**Create (server):**
- `server/tests/db/agentPrompts.test.ts`
- `server/tests/db/modelUsage.test.ts`
- `server/tests/db/pipelineEvents.test.ts`
- `server/tests/pipeline/ThreatAssembler.test.ts`
- `server/tests/discord/warRoom.test.ts`
- `server/tests/router/ModelRouter.test.ts`
- `server/tests/agents/EnrichmentAgent.test.ts`
- `server/tests/agents/ThreatAssessmentAgent.test.ts` (extend if exists)
- `server/tests/agents/SynthesisAgent.test.ts`
- `server/tests/agents/HabitatAgent.test.ts`
- `server/tests/agents/SpeciesContextAgent.test.ts`
- `server/tests/fixtures/llm/enrichment-output.json`
- `server/tests/fixtures/llm/habitat-output.json`
- `server/tests/fixtures/llm/species-context-output.json`
- `server/tests/fixtures/llm/synthesis-output.json`
- `server/src/discord/weeklyDigest.ts`

**Create (root):**
- `railway.toml`

**Create (client):**
- `client/playwright.config.ts`
- `client/e2e/layout.spec.ts`
- `client/e2e/map.spec.ts`
- `client/e2e/responsive.spec.ts`

**Modify:**
- `server/vitest.config.ts` — add exclusions for infrastructure singletons
- `server/src/server.ts` — add `startWeeklyDigestScheduler()`
- `client/package.json` — add `e2e` script

---

## Session Strategy (Token-Conscious)

Phase 9 is parallelizable. Each track is independent. Suggested session order:

| Session | Work | Token Cost |
|---|---|---|
| A | **Track 0** — retry-with-delay (ModelRouter) + embedding cache (retrieve.ts) + log cleanup | High — read both source files fully first |
| B | Track 0 Step 0.3 — verify real quota limits at ai.dev/rate-limit, update docs | Low |
| C | Track 1, Steps 1.1–1.3 (db + ThreatAssembler + warRoom) | Low — small files, simple mocks |
| D | Track 1, Step 1.4 (ModelRouter tests — now covers retry logic too) | Medium |
| E | Track 1, Step 1.5 agents 1–2 (EnrichmentAgent + ThreatAssessmentAgent) | High — largest + most critical |
| F | Track 1, Step 1.5 agents 3–5 (Synthesis + Habitat + Species) | High |
| G | Track 2 (weekly digest) + Track 3 (Playwright) | Low–Medium |
| H | Tracks 4–6 (Railway + Vercel + CORS) | Low — mostly config |
| I | Track 7 (smoke test) | Minimal |

Rules:
- Always read the agent source file completely before writing its tests. The drop/routing logic is in the details.
- Run `npm run test --workspace=server -- --coverage` after each session. Never let coverage slide between sessions.
- Do NOT start deployment (Track 4) until tests are solid. Deploying broken code to Railway wastes Railway hours and creates distracting noise.

---

## Acceptance Criteria

1. `npm run test --workspace=server -- --coverage` passes thresholds AND: `src/agents` ≥85%, `src/router` ≥85%, `src/pipeline` ≥90%, `src/db` ≥90%
2. All 139+ tests pass (no regressions)
3. `npm run build --workspace=client` — zero TypeScript errors
4. Playwright E2E suite passes in CI (or locally with `npm run e2e`)
5. `GET https://your-app.railway.app/health` → `{ status: 'ok' }`
6. `https://your-app.vercel.app` loads without errors on mobile and desktop
7. No CORS errors between frontend and backend
8. Weekly digest scheduled (verify via `#sentinel-ops` on Sunday or manual trigger)

---

## Post-Deployment Pipeline Debug Log (2026-04-04)

After going live, the production pipeline ran for ~24 hours without producing any threat assessments. The following bugs were diagnosed from #sentinel-ops Discord log export and code analysis.

### Bug 1 — Assembly TTL death spiral (root cause of 18-hour species-context blackout)

**Symptom:** `[species-context]` logs disappeared from #sentinel-ops for ~18 hours. Only `[habitat]` logs continued. Service recovered only after a Railway process restart.

**Root cause:** Species-context processes 17–20 species per event with sequential LLM calls (~90s/event). With 5–6 events per enrichment batch, a full batch takes up to 9 minutes. The assembly hash TTL was 600s (10 min). Once species-context fell more than one batch behind, every assembly hash expired before species-context reached those events. The `redis.exists('assembly:ID')` guard in `processSpeciesEvent` then silently skipped all events — no Discord log, no error, no sign of life. The only recovery was a full process restart that put species-context back at the head of the stream.

**Fix:** `ASSEMBLY_TTL_SECONDS` 600 → **3600** in `ThreatAssembler.ts`. The TTL must accommodate worst-case backlog: 6 events × 90s/event = 9 min per cycle × several cycles of lag. One hour gives ample margin.

**File:** `server/src/pipeline/ThreatAssembler.ts`

### Bug 2 — Race condition in EnrichmentAgent (storeEventForAssembly after XADD)

**Symptom:** Occasional species-context skip at startup even for fresh events.

**Root cause:** In `EnrichmentAgent.processEvent()`, `redis.xadd(STREAMS.ENRICHED, ...)` ran on line 115, but `storeEventForAssembly(event.id, enriched)` ran on line 119. A fast species-context consumer could read the stream message and call `redis.exists('assembly:ID')` in that ~10ms window — before the hash existed — and skip the event.

**Fix:** Swapped the order. `storeEventForAssembly` now runs first, then `redis.xadd`. The assembly hash is always guaranteed to exist before any consumer can read the stream message.

**File:** `server/src/agents/EnrichmentAgent.ts`

### Bug 3 — ThreatAssessmentAgent failures completely invisible in Discord

**Symptom:** Even for the 3 events where assembly DID complete (visible at 10:17, 10:24, 10:32 AM on day 1), no `[threat_assess]` log ever appeared in #sentinel-ops.

**Root cause:** The try/catch in `startThreatAssessmentAgent` called `logPipelineEvent` (writes to the `pipeline_events` DB table) but never called `logToWarRoom`. Any failure — Claude API error, DB constraint violation, rate limit, anything — was silently swallowed from Discord's perspective.

**Fix:** Added `logToWarRoom({ level: 'warning' })` in the catch block. Failed threat assessments now surface to #sentinel-ops with the error message.

**File:** `server/src/agents/ThreatAssessmentAgent.ts`

### Bonus — Assembly completion was also invisible

**Fix:** Added `logToWarRoom` in `ThreatAssembler.tryAssemble` on successful assembly. `[assembler] assembled` messages now appear in #sentinel-ops confirming the fan-in completed and the event is flowing to the threat assessment stage.

**File:** `server/src/pipeline/ThreatAssembler.ts`

### Test update

`ThreatAssembler.test.ts` TTL assertion updated: 600 → 3600. `logToWarRoom` mock added to the ThreatAssembler test file. All 286 tests pass.
