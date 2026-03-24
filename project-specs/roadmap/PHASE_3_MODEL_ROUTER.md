# Phase 3 — TypeScript Model Router

**Goal:** `ModelRouter.ts` is the single gateway for all AI calls. Gemini 2.5 Flash-Lite handles enrichment/habitat agents. Gemini 2.5 Flash handles Species Context. Cost tracking is live and queryable.

**Status:** Not started
**Depends on:** Phase 2 complete
**Estimated sessions:** 1

---

## Overview

In Phases 1–2, agents either had no LLM calls or used direct SDK calls as placeholders. Phase 3 introduces the `ModelRouter` singleton that all agents will use from this point forward.

The ModelRouter is the ONLY file that imports `@anthropic-ai/sdk` or `@google/generative-ai`. All agents call `modelRouter.complete()` or `modelRouter.embed()`. This enforces the rule and keeps cost tracking in one place.

---

## 1. `server/src/router/ModelRouter.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { RouterRequest, RouterResponse } from '@wildlife-sentinel/shared/types';
import { MODELS } from '@wildlife-sentinel/shared/models';
import { config } from '../config.js';
import { logModelUsage } from '../db/modelUsage.js';

class ModelRouter {
  private anthropic: Anthropic;
  private google: GoogleGenerativeAI;
  private runningCostUsd = 0;
  private callCount = 0;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: config.anthropicKey });
    this.google = new GoogleGenerativeAI(config.googleAiKey);
  }

  async complete(request: RouterRequest): Promise<RouterResponse> {
    if (request.model.startsWith('claude-')) {
      return this.completeAnthropic(request);
    }
    if (request.model.startsWith('gemini-')) {
      return this.completeGoogle(request);
    }
    throw new Error(`ModelRouter: unknown model prefix for "${request.model}"`);
  }

  async embed(text: string | string[]): Promise<number[][]> {
    const inputs = Array.isArray(text) ? text : [text];
    const model = this.google.getGenerativeModel({ model: MODELS.GOOGLE_EMBEDDINGS });

    const embeddings: number[][] = [];
    for (const input of inputs) {
      const result = await model.embedContent(input);
      embeddings.push(result.embedding.values);
    }
    return embeddings;
  }

  getRunningCostUsd(): number {
    return this.runningCostUsd;
  }

  private async completeAnthropic(request: RouterRequest): Promise<RouterResponse> {
    const response = await this.anthropic.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature ?? 0.3,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userMessage }],
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') throw new Error('Anthropic: no text content in response');

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = this.calculateCost(request.model, inputTokens, outputTokens);

    await this.trackUsage(request.model, inputTokens, outputTokens, cost);
    return { content: content.text, model: request.model, inputTokens, outputTokens, estimatedCostUsd: cost };
  }

  private async completeGoogle(request: RouterRequest): Promise<RouterResponse> {
    const model = this.google.getGenerativeModel({
      model: request.model,
      systemInstruction: request.systemPrompt,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.3,
        responseMimeType: request.jsonMode ? 'application/json' : 'text/plain',
      },
    });

    const result = await model.generateContent(request.userMessage);
    const text = result.response.text();
    const usage = result.response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const cost = this.calculateCost(request.model, inputTokens, outputTokens);

    await this.trackUsage(request.model, inputTokens, outputTokens, cost);
    return { content: text, model: request.model, inputTokens, outputTokens, estimatedCostUsd: cost };
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Pricing per million tokens (March 2026)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
      'gemini-2.5-flash':      { input: 0.00, output: 0.00 },  // free tier
      'gemini-2.5-flash-lite': { input: 0.00, output: 0.00 },  // free tier
      'text-embedding-004':    { input: 0.00, output: 0.00 },
    };

    const p = pricing[model];
    if (!p) return 0;

    return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  }

  private async trackUsage(model: string, inputTokens: number, outputTokens: number, costUsd: number): Promise<void> {
    this.runningCostUsd += costUsd;
    this.callCount++;

    // Log to DB every 10 calls to avoid a write on every single LLM call
    if (this.callCount % 10 === 0) {
      await logModelUsage({ model, inputTokens, outputTokens, estimatedCostUsd: costUsd });
    } else {
      // Always log Claude calls (they cost real money)
      if (model.startsWith('claude-')) {
        await logModelUsage({ model, inputTokens, outputTokens, estimatedCostUsd: costUsd });
      }
    }
  }
}

// Singleton — all agents share one instance
export const modelRouter = new ModelRouter();
```

---

## 2. Model Usage Table + Logger

### `server/src/db/migrations/0003_model_usage.sql`

```sql
-- Migration: 0003_model_usage + agent_prompts

-- Up

CREATE TABLE IF NOT EXISTS model_usage (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  model             TEXT        NOT NULL,
  input_tokens      INTEGER     NOT NULL,
  output_tokens     INTEGER     NOT NULL,
  estimated_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  called_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_usage_model ON model_usage (model);
CREATE INDEX IF NOT EXISTS idx_model_usage_called ON model_usage (called_at DESC);

-- agent_prompts: system prompts stored in DB (Refiner can update them)
-- Seeded in Phase 5 with initial Threat Assessment + Synthesis prompts
CREATE TABLE IF NOT EXISTS agent_prompts (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name       TEXT        NOT NULL UNIQUE,
  system_prompt    TEXT        NOT NULL,
  version          INTEGER     NOT NULL DEFAULT 1,
  last_updated_by  TEXT        NOT NULL DEFAULT 'manual',  -- 'manual' | 'refiner'
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Down
-- DROP TABLE IF EXISTS agent_prompts;
-- DROP TABLE IF EXISTS model_usage;
```

### `server/src/db/modelUsage.ts`

```typescript
import { sql } from './client.js';

interface ModelUsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export async function logModelUsage(record: ModelUsageRecord): Promise<void> {
  await sql`
    INSERT INTO model_usage (model, input_tokens, output_tokens, estimated_cost_usd)
    VALUES (${record.model}, ${record.inputTokens}, ${record.outputTokens}, ${record.estimatedCostUsd})
  `;
}

export async function getTotalCostUsd(): Promise<number> {
  const result = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total FROM model_usage
  `;
  return parseFloat(result[0]?.total ?? '0');
}

export async function getCostByModel(): Promise<Array<{ model: string; total_cost: string; call_count: string }>> {
  return sql`
    SELECT model, SUM(estimated_cost_usd)::text AS total_cost, COUNT(*)::text AS call_count
    FROM model_usage
    GROUP BY model
    ORDER BY SUM(estimated_cost_usd) DESC
  `;
}
```

---

## 3. Cost Endpoint

Add to `server/src/app.ts` (or a new `routes/admin.ts`):

```typescript
// GET /admin/costs — running cost summary
// Note: this endpoint is unprotected — fine for a personal project, but don't expose sensitive data
adminRouter.get('/costs', async (_req, res) => {
  const [total, byModel] = await Promise.all([getTotalCostUsd(), getCostByModel()]);
  res.json({
    total_usd: total,
    breakdown: byModel,
    in_memory_total_usd: modelRouter.getRunningCostUsd(),
  });
});
```

---

## 4. Agent Updates

Every agent that made placeholder SDK calls in Phase 2 now uses `modelRouter.complete()`:

**Enrichment Agent — `weather_summary` generation:**
```typescript
const result = await modelRouter.complete({
  model: MODELS.GEMINI_FLASH_LITE,
  systemPrompt: 'Summarize weather conditions for a wildfire assessment in one sentence.',
  userMessage: `Wind: ${windSpeed}km/h from ${direction}. Precipitation: ${precipProb}%.`,
  maxTokens: 100,
  temperature: 0.1,
});
event.weather_summary = result.content;
```

**Habitat Agent — GBIF analysis:**
```typescript
const result = await modelRouter.complete({
  model: MODELS.GEMINI_FLASH_LITE,
  systemPrompt: 'Analyze GBIF occurrence data and assess species presence confidence. Respond in JSON.',
  userMessage: `Species: ${speciesName}. Recent sightings: ${JSON.stringify(sightings)}`,
  maxTokens: 256,
  jsonMode: true,
});
```

**Species Context Agent:**
```typescript
const result = await modelRouter.complete({
  model: MODELS.GEMINI_FLASH,
  systemPrompt: speciesContextSystemPrompt,
  userMessage: `Species: ${speciesName}. IUCN status: ${iucnStatus}.`,
  maxTokens: 512,
  jsonMode: true,
});
```

---

## 5. Rate Limit Tracking

The free Gemini tiers have low RPM limits (10 RPM for Flash, 15 RPM for Flash-Lite). At Phase 3 event volumes this isn't a problem, but log when we're approaching limits:

```typescript
// In ModelRouter.completeGoogle, add simple in-memory rate tracking:
private googleCallsThisMinute = 0;
private googleRateLimitResetAt = Date.now() + 60_000;

private checkGoogleRateLimit(model: string): void {
  if (Date.now() > this.googleRateLimitResetAt) {
    this.googleCallsThisMinute = 0;
    this.googleRateLimitResetAt = Date.now() + 60_000;
  }
  this.googleCallsThisMinute++;

  const limit = model === MODELS.GEMINI_FLASH ? 10 : 15;
  if (this.googleCallsThisMinute > limit * 0.8) {
    console.warn(`[model-router] Approaching Google rate limit: ${this.googleCallsThisMinute}/${limit} RPM`);
  }
}
```

---

## Acceptance Criteria

1. All agent LLM calls route through `modelRouter` — no direct SDK imports outside `ModelRouter.ts`
2. `import Anthropic from '@anthropic-ai/sdk'` appears ONLY in `ModelRouter.ts`
3. `import { GoogleGenerativeAI }` appears ONLY in `ModelRouter.ts`
4. Every LLM call creates a record in `model_usage` table
5. `GET /admin/costs` returns accurate per-model cost breakdown
6. Enrichment Agent generates Gemini `weather_summary` (not deterministic string from Phase 1)
7. Habitat Agent classifies GBIF sighting confidence via Gemini
8. Species Context Agent generates species brief via Gemini Flash
9. All three agents run within free tier limits (< 250 RPD for Flash, < 1,000 RPD for Flash-Lite)

---

## Notes / Decisions Log

- `modelRouter` exported as singleton — not injected. Keeps agent code simpler. Could be refactored to DI if testing demands it (mock in tests with `vi.mock`).
- Cost tracking writes to DB every 10 calls for Gemini (always for Claude) — tradeoff between write frequency and accuracy. Acceptable for a personal project.
- `jsonMode: true` maps to `responseMimeType: 'application/json'` in the Gemini SDK — ensures the model returns valid JSON rather than JSON wrapped in markdown code fences.
- Gemini Flash-Lite `maxTokens: 256` for weather summary and GBIF analysis — these are short outputs; leaving this at the default (8192) wastes output quota.
