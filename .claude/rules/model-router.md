# Model Router Rules

## Architecture

`ModelRouter` is a single TypeScript class in `server/src/router/ModelRouter.ts`. It is the only file that imports AI SDKs directly. All agents call the router — they never import Anthropic or Google SDKs themselves.

```typescript
// shared/models.ts — the ONLY place model strings live
export const MODELS = {
  // Synthesis, threat assessment, refiner — nuanced reasoning, quality critical
  CLAUDE_SONNET: 'claude-sonnet-4-6',

  // Moderate tasks (Species Context Agent) — RAG synthesis
  // Tier 1 (paid, upgraded 2026-03-31): ~1,500 RPD / 30 RPM. $0.30/1M input.
  GEMINI_FLASH: 'gemini-2.5-flash',

  // High-volume simple tasks (Enrichment, Habitat Agents)
  // Tier 1 (paid, upgraded 2026-03-31): ~1,500 RPD / 30 RPM. $0.10/1M input.
  GEMINI_FLASH_LITE: 'gemini-2.5-flash-lite',

  // Embeddings — Tier 1. gemini-embedding-001 (3072 dims, v1beta API)
  GOOGLE_EMBEDDINGS: 'gemini-embedding-001',
} as const;

// NOTE: Gemini 1.5 and 2.0 families are discontinued (shut down Oct 2025).
// Current stable Gemini family is 2.5. Gemini 3.x exists but is not free-tier.
// Always verify model availability before adding new model strings.
```

**Never hardcode model strings in agent files.** Always import from `shared/models.ts`.

## ModelRouter Interface

```typescript
interface ModelRouter {
  complete(request: RouterRequest): Promise<RouterResponse>;
  embed(text: string | string[]): Promise<number[][]>;
}

interface RouterRequest {
  model: string;           // from MODELS constants
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;      // request structured JSON output
}

interface RouterResponse {
  content: string;
  model: string;           // which model actually responded
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number; // computed from known pricing
}
```

## Routing Logic

```
model starts with 'claude-' → Anthropic SDK
model starts with 'gemini-' → Google AI SDK (@google/generative-ai)
model starts with 'openrouter/' → OpenRouter (OpenAI-compatible HTTP)
```

## Provider Setup

### Anthropic
```typescript
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: config.anthropicKey });
```

### Google AI
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
const genai = new GoogleGenerativeAI(config.googleAiKey);
```

### Google Embeddings
```typescript
// Also via @google/generative-ai
const embeddingModel = genai.getGenerativeModel({ model: MODELS.GOOGLE_EMBEDDINGS });
const result = await embeddingModel.embedContent(text);
// result.embedding.values is number[] with 768 dimensions
```

### OpenRouter (optional — for Qwen, DeepSeek, etc.)
```typescript
// OpenRouter is OpenAI-compatible, use native fetch
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${config.openRouterKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ model, messages, max_tokens }),
});
```

## Cost Tracking

Every `RouterResponse` includes `estimatedCostUsd`. The router keeps a running total in memory and logs to the `model_usage` table every 10 calls. This enables the cost monitoring that the user needs to stay under $20 total.

Known pricing (updated 2026-03-31 — project upgraded to Google AI Tier 1 paid):
- `claude-sonnet-4-6`: ~$3.00/M input, ~$15.00/M output
- `gemini-2.5-flash`: Tier 1 ~1,500 RPD / 30 RPM. $0.30/1M input, $2.50/1M output.
- `gemini-2.5-flash-lite`: Tier 1 ~1,500 RPD / 30 RPM. $0.10/1M input, $0.40/1M output.
- `gemini-embedding-001`: Tier 1 (verify limits in AI Studio console)

Note: Actual Tier 1 quotas should be verified in AI Studio console — the RPD/RPM figures
above are estimates. The $10 prepaid credit covers ~$0.10/1M token calls; at project volume
this should last months. Free tier had a 20 RPD hard cap which is now removed.

## When to Use Which Model

| Task | Model | Justification |
|---|---|---|
| PostGIS spatial check result interpretation | [GEMINI_FLASH] | Simple classification, high volume |
| Weather data attachment | [GEMINI_FLASH] | Simple summarization |
| GBIF sighting analysis | [GEMINI_FLASH] | Pattern recognition, cheap |
| Species brief generation | [GEMINI_FLASH] | RAG retrieval synthesis |
| Threat level assessment | claude-sonnet-4-6 | Multi-factor reasoning, accuracy critical |
| Discord embed generation | claude-sonnet-4-6 | Tone quality, audience-facing |
| Refiner correction notes | claude-sonnet-4-6 | Prompt engineering quality matters |

## What NOT to Do

- Do NOT import `@anthropic-ai/sdk` or `@google/generative-ai` outside of `ModelRouter.ts`
- Do NOT hardcode model strings anywhere — use `MODELS` constants
- Do NOT skip cost tracking — the user has a strict budget (under $20 total project cost)
- Do NOT use OpenRouter as the default for Claude or Gemini — use direct SDKs (cheaper, no markup)
