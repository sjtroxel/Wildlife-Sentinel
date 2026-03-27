# Phase 5 — Full Agent Swarm + Discord War Room — ✅ Complete (2026-03-27)

## Context

Phases 1–4 built the scout and enrichment pipeline, but nothing generates threat assessments or Discord alerts yet. The pipeline ends at `SpeciesContextAgent` which publishes plain text to Discord. Phase 5 closes the loop by adding two Claude Sonnet 4.6 agents (Threat Assessment + Synthesis), restructuring the Habitat+Species fan-out into a proper parallel/fan-in architecture via `ThreatAssembler`, and replacing the Phase 1 plain-text Discord publisher with rich embed output and HITL routing.

---

## Architecture Change (Phases 1–4 → Phase 5)

**Before (sequential):**
```
disaster:enriched → HabitatAgent → runSpeciesContextAgent() → discord:queue → plain text publisher
```

**After (fan-out/fan-in):**
```
disaster:enriched ─┬─► HabitatAgent ──────────────────┐
                   └─► SpeciesContextAgent ─────────────┤ ThreatAssembler (Redis hash)
                                                         ▼
                                               alerts:assessed (FullyEnrichedEvent)
                                                         ▼
                                               ThreatAssessmentAgent (Claude Sonnet)
                                                         ▼
                                               alerts:assessed (AssessedAlert)
                                                         ▼
                                               SynthesisAgent (Claude Sonnet)
                                                         ▼
                                               discord:queue (DiscordQueueItem w/ embed)
                                                         ▼
                                               Discord Publisher (routes by threat_level)
```

**Stream disambiguation:** Both `FullyEnrichedEvent` and `AssessedAlert` flow through `alerts:assessed`. Each agent filters by checking `'threat_level' in data`: ThreatAssessmentAgent skips messages that already have it; SynthesisAgent skips messages that don't.

---

## Files — New

| File | Purpose |
|---|---|
| `server/src/db/migrations/0005_phase5_tables.sql` | `refiner_queue` table + seed `agent_prompts` |
| `server/src/db/agentPrompts.ts` | `getAgentPrompt(name)` helper |
| `server/src/pipeline/ThreatAssembler.ts` | Redis hash fan-in; publishes to `alerts:assessed` when both results ready |
| `server/src/agents/ThreatAssessmentAgent.ts` | Consumer of `alerts:assessed` (threat-group); Claude Sonnet 4.6; computed confidence |
| `server/src/agents/SynthesisAgent.ts` | Consumer of `alerts:assessed` (synthesis-group); Claude Sonnet 4.6; EmbedBuilder |
| `server/src/discord/warRoom.ts` | Rate-limited one-line observability logger to #sentinel-ops |
| `server/src/discord/hitl.ts` | ✅/❌ reaction collector for critical alerts; 24h window |
| `server/tests/agents/ThreatAssessmentAgent.test.ts` | Unit tests (fixture-based) |
| `server/tests/agents/SynthesisAgent.test.ts` | Unit tests (fixture-based) |
| `server/tests/fixtures/llm/threat-assessment-wildfire.json` | LLM fixture |
| `server/tests/fixtures/llm/synthesis-wildfire.json` | LLM fixture |

## Files — Modified

| File | Change |
|---|---|
| `server/src/agents/EnrichmentAgent.ts` | After publishing to `disaster:enriched`, also store event in `assembly:{id}:event` (Redis hash, TTL 300s) |
| `server/src/agents/HabitatAgent.ts` | Replace direct `runSpeciesContextAgent()` call with `ThreatAssembler.storeHabitatResult()` |
| `server/src/agents/SpeciesContextAgent.ts` | Add independent consumer loop on `disaster:enriched` (species-group); replace `xadd(STREAMS.DISCORD)` with `ThreatAssembler.storeSpeciesResult()` |
| `server/src/discord/publisher.ts` | Full rewrite: consume `DiscordQueueItem` from `discord:queue`; route by channel; update `discord_message_id` in DB |
| `server/src/server.ts` | Add `startThreatAssessmentAgent()`, `startSynthesisAgent()`; start SpeciesContextAgent independently |
| `shared/types.d.ts` | Add `DiscordQueueItem` type (if missing); verify `AssessedAlert` has all required fields |

---

## Implementation Steps (in order)

### Step 1 — Migration + DB helpers
**File:** `server/src/db/migrations/0005_phase5_tables.sql`
- Create `refiner_queue` table: `id UUID PK, alert_id UUID, evaluation_time TEXT CHECK ('24h','48h'), run_at TIMESTAMPTZ, completed_at TIMESTAMPTZ null, created_at TIMESTAMPTZ`
- Seed `agent_prompts` with `INSERT ... ON CONFLICT DO UPDATE` for `threat_assessment`, `synthesis`, `refiner` (exact prompts from Phase 5 spec)

**File:** `server/src/db/agentPrompts.ts`
```typescript
export async function getAgentPrompt(agentName: string): Promise<string>
```
Query: `SELECT system_prompt FROM agent_prompts WHERE agent_name = ${agentName}`

### Step 2 — ThreatAssembler
**File:** `server/src/pipeline/ThreatAssembler.ts`

- `storeHabitatResult(eventId, result)` → `HSET assembly:{id} habitat <json>`, `EXPIRE 300`
- `storeSpeciesResult(eventId, result)` → `HSET assembly:{id} species <json>`, `EXPIRE 300`
- `tryAssemble(eventId)` → `HGETALL assembly:{id}`, if event+habitat+species all present → build `FullyEnrichedEvent`, `XADD alerts:assessed`, `DEL assembly:{id}`
- EnrichmentAgent must call: `HSET assembly:{id} event <json>`, `EXPIRE 300` after publishing to `disaster:enriched`

### Step 3 — Refactor HabitatAgent + SpeciesContextAgent

**HabitatAgent.ts:**
- Remove `import { runSpeciesContextAgent }`
- Replace `await runSpeciesContextAgent(fullyEnriched)` with:
  ```typescript
  await storeHabitatResult(event.id, { gbif_recent_sightings, sighting_confidence, most_recent_sighting });
  ```
- Add `logToWarRoom` call for GBIF result

**SpeciesContextAgent.ts:**
- Add `startSpeciesContextAgent()` with the same XREADGROUP consumer loop pattern (matching HabitatAgent/EnrichmentAgent exactly)
- Consumes `STREAMS.ENRICHED` with `CONSUMER_GROUPS.SPECIES`
- Replace final `redis.xadd(STREAMS.DISCORD, ...)` with `storeSpeciesResult(event.id, { species_briefs })`
- Keep all existing `generateSpeciesBrief()` logic unchanged

### Step 4 — warRoom.ts
**File:** `server/src/discord/warRoom.ts`

Rate-limited poster to #sentinel-ops. Per spec:
- `MIN_POST_INTERVAL_MS = 500`
- `logToWarRoom({ agent, action, detail, level? })` — emoji by level, formatted as `` `[agent]` action: detail ``
- Try/catch — war room failure must NEVER crash the pipeline

### Step 5 — ThreatAssessmentAgent
**File:** `server/src/agents/ThreatAssessmentAgent.ts`

- Consumer loop on `alerts:assessed` with `CONSUMER_GROUPS.THREAT`
- **Filter:** `if ('threat_level' in data)` → ACK and skip (already assessed)
- Load system prompt via `getAgentPrompt('threat_assessment')`
- Build user message from `FullyEnrichedEvent` fields (exact template from spec)
- Call `modelRouter.complete({ model: MODELS.CLAUDE_SONNET, jsonMode: true, ... })`
- **Compute confidence** (deterministic formula from spec):
  ```
  dataCompleteness = [wind_speed≠null, wind_dir≠null, gbif_sightings>0, species_briefs>0, dist<75].filter(true).length / 5
  sourceQuality = { nasa_firms:0.95, noaa_nhc:0.90, usgs_nwis:0.85, coral_reef_watch:0.85, drought_monitor:0.75 }[source]
  habitatCertainty = dist<10?1.0 : dist<25?0.85 : dist<50?0.65 : 0.45
  confidence = 0.4*completeness + 0.35*quality + 0.25*certainty
  ```
- Upsert `alerts` table with threat_level, confidence_score, prediction_data
- Insert 24h + 48h entries into `refiner_queue`
- Publish `AssessedAlert` to `alerts:assessed`
- `logToWarRoom` with threat level result

### Step 6 — SynthesisAgent
**File:** `server/src/agents/SynthesisAgent.ts`

- Consumer loop on `alerts:assessed` with `CONSUMER_GROUPS.SYNTHESIS`
- **Filter:** `if (!('threat_level' in data))` → ACK and skip (not yet assessed)
- **Drop:** `if (data.threat_level === 'low')` → ACK, log to pipeline_events, no Discord post
- Load system prompt via `getAgentPrompt('synthesis')`
- Call `modelRouter.complete({ model: MODELS.CLAUDE_SONNET, jsonMode: true, ... })`
- Build `EmbedBuilder` with fields from spec (color, title, description, fields, footer)
- Build `DiscordQueueItem`: `{ alert_id, channel: 'wildlife-alerts'|'sentinel-ops-review', embed, threat_level, stored_alert_id }`
- Publish to `discord:queue`
- `logToWarRoom` with routing decision

**Threat colors:**
```
critical: 0xdc2626, high: 0xea580c, medium: 0xd97706, low: 0x6b7280
```

### Step 7 — HITL
**File:** `server/src/discord/hitl.ts`

Exact implementation from spec:
- `postCriticalForReview(embed, alertId)` → post to #sentinel-ops with ✅/❌
- Reaction collector: 24h window, non-bot users only
- On ✅ → post embed to #wildlife-alerts, edit review message
- On ❌ → edit review message as suppressed
- On timeout → `logToWarRoom` warning
- DB `UPDATE alerts SET discord_message_id = ... WHERE id = ${alertId}`

### Step 8 — Discord Publisher (rewrite)
**File:** `server/src/discord/publisher.ts`

- Consume `DiscordQueueItem` from `STREAMS.DISCORD` with `CONSUMER_GROUPS.DISCORD` (same group name)
- If `channel === 'sentinel-ops-review'` → call `postCriticalForReview(embed, alertId)`
- If `channel === 'wildlife-alerts'` → `getWildlifeAlertsChannel().send({ embeds: [embed] })`, update `discord_message_id` in DB
- `logToWarRoom` on post
- ACK stream message after handling

### Step 9 — server.ts
Add imports and void starts:
```typescript
import { startSpeciesContextAgent } from './agents/SpeciesContextAgent.js';
import { startThreatAssessmentAgent } from './agents/ThreatAssessmentAgent.js';
import { startSynthesisAgent } from './agents/SynthesisAgent.js';
// In main():
void startSpeciesContextAgent();
void startThreatAssessmentAgent();
void startSynthesisAgent();
```

### Step 10 — Tests + Fixtures
**Fixtures:**
- `threat-assessment-wildfire.json`: `{ threat_level: 'high', predicted_impact: '...', compounding_factors: [...], recommended_action: '...', reasoning: '...' }`
- `synthesis-wildfire.json`: `{ title: '...', narrative: '...', footer_note: '...' }`

**ThreatAssessmentAgent.test.ts:**
- Mock ModelRouter, redis, sql, pipelineEvents, agentPrompts
- Test: FullyEnrichedEvent → produces AssessedAlert with computed confidence
- Test: message with existing `threat_level` → skipped (ACK only)
- Test: threat_level 'low' still gets assessed (drop happens in SynthesisAgent)

**SynthesisAgent.test.ts:**
- Test: 'low' threat_level → no xadd, logPipelineEvent called with filtered
- Test: 'high' threat_level → xadd to discord:queue with `channel: 'wildlife-alerts'`
- Test: 'critical' threat_level → xadd with `channel: 'sentinel-ops-review'`
- Test: message without threat_level → skipped (ACK only)

---

## Types to verify/add in `shared/types.d.ts`

`AssessedAlert` should extend `FullyEnrichedEvent` — already confirmed present.

`DiscordQueueItem` — confirm present or add:
```typescript
interface DiscordQueueItem {
  alert_id: string;
  channel: 'wildlife-alerts' | 'sentinel-ops-review';
  embed: object;          // serialized EmbedBuilder data
  threat_level: ThreatLevel;
  stored_alert_id: string;
}
```

---

## Existing Utilities to Reuse

| Utility | File | Use in Phase 5 |
|---|---|---|
| `ensureConsumerGroup()` | `pipeline/streams.ts` | SpeciesContextAgent, ThreatAssessmentAgent, SynthesisAgent startup |
| `logPipelineEvent()` | `db/pipelineEvents.ts` | All new agents for audit trail |
| `STREAMS`, `CONSUMER_GROUPS` | `pipeline/streams.ts` | All stream/group references |
| `modelRouter.complete()` | `router/ModelRouter.ts` | ThreatAssessmentAgent + SynthesisAgent |
| `MODELS.CLAUDE_SONNET` | `shared/models.ts` | Both new agents |
| `getSentinelOpsChannel()` / `getWildlifeAlertsChannel()` | `discord/bot.ts` | warRoom.ts + hitl.ts + publisher.ts |
| `sql` | `db/client.ts` | agentPrompts.ts, ThreatAssessmentAgent, publisher |

---

## Verification

1. Run migration: `psql $DATABASE_URL -f server/src/db/migrations/0005_phase5_tables.sql`
2. Verify `refiner_queue` table created and `agent_prompts` seeded with 3 rows
3. `npm run typecheck` — zero errors
4. `npm test` — all tests pass (target: previous 42 + ~8 new)
5. Manual end-to-end: inject a test event into `disaster:raw` via Redis CLI, watch war room messages flow in #sentinel-ops, verify Discord embed appears in correct channel based on threat_level
