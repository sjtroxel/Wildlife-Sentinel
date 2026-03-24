# Phase 3 — TypeScript Model Router

**Goal:** ModelRouter.ts routes all LLM calls. Gemini agents live. Cost tracking working.

**Status:** 🔲 Not started
**Depends on:** Phase 2 complete

---

## Key Tasks

- [ ] `server/src/router/ModelRouter.ts` — singleton, routes by model prefix
  - `claude-*` → Anthropic SDK
  - `gemini-*` → `@google/generative-ai` SDK
  - `openrouter/*` → raw fetch to OpenRouter (future, optional)
- [ ] `RouterRequest` / `RouterResponse` interfaces in `shared/types.d.ts`
- [ ] `embed(text)` method using `text-embedding-004`
- [ ] `model_usage` table in Neon — log every call with input tokens, output tokens, estimated cost
- [ ] Running total endpoint: `GET /admin/costs` → total estimated spend
- [ ] Enrichment Agent updated: adds Gemini 2.5 Flash-Lite call for `weather_summary` text
- [ ] Habitat Agent updated: adds Gemini 2.5 Flash-Lite call to analyze GBIF data
- [ ] Species Context Agent updated: uses Gemini 2.5 Flash
- [ ] Verify free tier limits are not exceeded at current event volume

## Cost Tracking Formula

```typescript
// Approximate costs (update if pricing changes)
const COSTS_PER_M_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'gemini-2.5-flash': { input: 0.00, output: 0.00 },     // free tier
  'gemini-2.5-flash-lite': { input: 0.00, output: 0.00 }, // free tier (to limit)
  'text-embedding-004': { input: 0.00, output: 0.00 },
};
```

## Acceptance Criteria

1. All agent LLM calls route through ModelRouter — no direct SDK imports outside router
2. Every LLM call logged to `model_usage` with token counts
3. `GET /admin/costs` returns accurate running total
4. Free tier usage stays within 1,000 RPD for Flash-Lite and 250 RPD for Flash at typical event volume

---

## Notes / Decisions Log
