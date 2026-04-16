# Agent Rules

## The 12-Factor Agent Principles (Applied)

Every agent in Wildlife Sentinel follows these principles:

1. **Own your prompts** — `buildSystemPrompt()` is an explicit function in every agent. No framework generates prompts. You write every token.
2. **Own your context window** — Curate what the LLM sees. For the Refiner: inject the last 3 scored results into the system prompt so the agent learns from evidence.
3. **Tools are structured outputs** — The LLM returns a JSON intent. Deterministic TypeScript code executes the action. LLMs do not make HTTP calls directly.
4. **Small, focused agents** — Each agent does one job. If an agent needs more than ~5 responsibilities, split it.
5. **Own your control flow** — Explicit agentic loops in TypeScript. No framework black boxes.
6. **Compact errors into context** — Feed failures back so the agent self-corrects on the next attempt.

## Agent Function Signature Discipline

Every agent must have this TypeScript signature pattern:

```typescript
export async function runAgentName(
  event: EnrichedDisasterEvent,   // or RawDisasterEvent, AssessedAlert, etc.
  state: PipelineState,
  options: AgentOptions
): Promise<AgentNameOutput> { ... }
```

Every agent output interface must include:
```typescript
interface AgentNameOutput {
  status: 'success' | 'partial' | 'failed';
  confidence: number;           // 0-1, computed from observable fields ONLY
  sources: string[];            // what data was used
  // ...domain-specific payload
}
```

No agent returns `any`. Ever.

## Confidence Scoring Rules

**NEVER** ask an agent "how confident are you?" and use the self-reported answer. LLMs are systematically overconfident.

Confidence must be computed from **observable fields**:
- `dataCompleteness` — what fraction of expected fields were present in the source data?
- `sourceQuality` — government API (high) vs. inferred (low)?
- `habitatOverlapCertainty` — exact polygon match (high) vs. approximate radius (lower)?
- `speciesPresenceConfidence` — GBIF recent sightings (high) vs. range polygon only (lower)?

For the Refiner: `compositeScore = 0.6 * directionAccuracy + 0.4 * magnitudeAccuracy` — pure math, no LLM judgment.

## Model Assignment (see also model-router.md)

| Agent | Model | Reason |
|---|---|---|
| Scout Agents (9) | None | Pure Node.js data fetch + normalize |
| Enrichment Agent | gemini-2.5-flash-lite | High volume, cheap, PostGIS + weather |
| Habitat Agent | gemini-2.5-flash-lite | High volume, GBIF lookups |
| Species Context Agent | gemini-2.5-flash-lite | High volume, RAG retrieval (same tier as Enrichment/Habitat — cost-optimized) |
| Threat Assessment Agent | claude-haiku-4-5-20251001 | CLAUDE_HAIKU — ~3.75x cheaper than Sonnet; deliberate cost reduction (do not revert to Sonnet) |
| Synthesis Agent | claude-haiku-4-5-20251001 | CLAUDE_HAIKU — same cost reduction decision (do not revert) |
| Refiner/Evaluator | claude-haiku-4-5-20251001 | CLAUDE_HAIKU — same cost reduction decision (do not revert) |

## System Prompt Updates (Refiner Pattern)

The Threat Assessment Agent's system prompt is stored in the `agent_prompts` database table, not hardcoded. On startup, the agent reads its current prompt from the DB. When the Refiner scores a prediction < 0.60, it writes a Correction Note to the DB. Future runs prepend this correction to the system prompt.

This is context engineering that updates itself — not fine-tuning. The prompt grows with evidence.

## Scout Agent Rules

Scout agents are NOT LLM agents. They are TypeScript polling functions that:
1. Call their respective government API
2. Normalize the response to `RawDisasterEvent` schema
3. Deduplicate against recently-seen event IDs (stored in Redis as a short-TTL set)
4. Publish new events to `disaster:raw` stream via XADD
5. Exit. No state held between runs.

Each Scout runs on a cron schedule via `node-cron`. They do not import the Anthropic or Google SDKs.

## Prohibited Patterns

- Do NOT use LangChain, LlamaIndex, or any agent framework
- Do NOT let agents call each other directly (method calls or HTTP) — all communication goes through Redis Streams
- Do NOT hardcode model strings in agent files — import from `shared/models.ts`
- Do NOT let agents make the final Discord post — that belongs to the Discord Publisher module
- Do NOT self-report confidence — compute it
