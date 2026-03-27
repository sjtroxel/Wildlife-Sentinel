# Phase 5 — Full Agent Swarm + Discord War Room

**Goal:** Complete intelligence pipeline. Rich Discord embeds. Agent reasoning visible in #sentinel-ops. HITL review for critical alerts. System functionally complete for all disaster types (without RAG grounding, which comes in Phase 6).

**Status:** ✅ Complete (2026-03-27)
**Depends on:** Phase 4 complete
**Estimated sessions:** 2–3

---

## Overview

This phase implements the two Claude Sonnet 4.6 agents (Threat Assessment + Synthesis) and wires the full pipeline fan-out/fan-in architecture. It also restructures the Discord Publisher from Phase 1's simple text poster into the final war room observability system.

### Pipeline Architecture Change

In Phases 1–4, the pipeline was linear:
```
disaster:raw → Enrichment → Habitat → SpeciesContext → Discord
```

Phase 5 restructures to the final fan-out/fan-in model:
```
disaster:raw
  → [Enrichment Agent] → disaster:enriched
      ├→ [Habitat Agent]         ┐
      └→ [Species Context Agent] ┘ (both consume disaster:enriched in parallel)
                                   (results assembled in ThreatAssembler)
  → alerts:assessed (assembled fully-enriched event)
      → [Threat Assessment Agent] → alerts:assessed (with threat_level added)
          → [Synthesis Agent] → discord:queue
              → [Discord Publisher]
```

The **ThreatAssembler** is the coordination point that waits for both Habitat + Species Context to complete before publishing to Threat Assessment.

---

## 1. agent_prompts Table Seeding

Run this after migration 0003 is applied:

```sql
-- Seed initial system prompts for Phase 5 agents
INSERT INTO agent_prompts (agent_name, system_prompt) VALUES

('threat_assessment',
'You are a wildlife threat assessment specialist. You analyze disaster events and their potential impact on endangered species and critical habitats. For each event, respond with a JSON object containing:
- threat_level: "low" | "medium" | "high" | "critical"
- predicted_impact: brief description of likely impact in next 24-72 hours
- compounding_factors: string array of factors that worsen the prognosis
- recommended_action: one-sentence conservation response recommendation
- reasoning: chain-of-thought explaining your assessment

Threat level guidelines:
- "critical": Disaster overlapping habitat boundary OR confirmed progression toward habitat within 6h
- "high": Disaster within 25km of habitat AND conditions favor spread toward habitat
- "medium": Disaster within 75km of habitat with uncertain trajectory
- "low": Low actual risk despite proximity (trajectory away, or conditions unfavorable for spread)

Your assessment must be grounded in the provided data. Do not speculate beyond what the evidence supports.'),

('synthesis',
'You are the public voice of Wildlife Sentinel. You write clear, informative Discord alerts for a general audience interested in wildlife conservation.

Your alerts are factual and grounded in the provided data. Informative without being alarmist. Written for a non-specialist audience. Empathetic to the animals at risk without being maudlin. Concise: the main narrative should be 2-3 sentences.

Always include: species name and IUCN status, disaster type and severity, proximity to habitat, and one relevant conservation context sentence when available.

Respond with a JSON object: { "title": string, "narrative": string, "footer_note": string }'),

('refiner',
'You are the Refiner agent for Wildlife Sentinel. You analyze prediction failures and write specific, actionable correction notes to improve future threat assessments.

You receive the original prediction, the actual real-world outcome, and the accuracy scores. Write correction notes that are:
- Specific to the failure mode (e.g., "underestimated offshore wind influence on fire spread")
- Actionable (tells the Threat Assessment agent what to do differently in similar situations)
- Concise (2-3 sentences maximum)
- Written in second person: "Weight X more heavily when Y..."

Do NOT write vague notes like "be more careful" or "consider all factors." Prefix the note with the event type: "CORRECTION (wildfire): ..."')

ON CONFLICT (agent_name) DO UPDATE SET system_prompt = EXCLUDED.system_prompt;
```

Helper function for all agents to load their prompt:
```typescript
// server/src/db/agentPrompts.ts
export async function getAgentPrompt(agentName: string): Promise<string> {
  const rows = await sql<{ system_prompt: string }[]>`
    SELECT system_prompt FROM agent_prompts WHERE agent_name = ${agentName}
  `;
  if (!rows[0]) throw new Error(`No prompt found for agent: ${agentName}`);
  return rows[0].system_prompt;
}
```

---

## 2. ThreatAssembler (Fan-in Coordinator)

The ThreatAssembler tracks in-flight events waiting for both Habitat + Species Context results. Uses Redis hashes keyed by event ID with a TTL.

```typescript
// server/src/pipeline/ThreatAssembler.ts

const ASSEMBLY_TTL_SECONDS = 300; // 5 minutes to wait for both agents

export async function storeHabitatResult(eventId: string, result: HabitatAgentOutput): Promise<void> {
  await redis.hset(`assembly:${eventId}`, 'habitat', JSON.stringify(result));
  await redis.expire(`assembly:${eventId}`, ASSEMBLY_TTL_SECONDS);
  await tryAssemble(eventId);
}

export async function storeSpeciesResult(eventId: string, result: SpeciesContextOutput): Promise<void> {
  await redis.hset(`assembly:${eventId}`, 'species', JSON.stringify(result));
  await redis.expire(`assembly:${eventId}`, ASSEMBLY_TTL_SECONDS);
  await tryAssemble(eventId);
}

async function tryAssemble(eventId: string): Promise<void> {
  const stored = await redis.hgetall(`assembly:${eventId}`);
  if (!stored['habitat'] || !stored['species'] || !stored['event']) return;

  // Both results are in — build FullyEnrichedEvent and publish to alerts:assessed
  const event = JSON.parse(stored['event']) as EnrichedDisasterEvent;
  const habitat = JSON.parse(stored['habitat']) as HabitatAgentOutput;
  const species = JSON.parse(stored['species']) as SpeciesContextOutput;

  const fullyEnriched: FullyEnrichedEvent = {
    ...event,
    gbif_recent_sightings: habitat.gbif_recent_sightings,
    species_briefs: species.species_briefs,
    sighting_confidence: habitat.sighting_confidence,
    most_recent_sighting: habitat.most_recent_sighting,
  };

  await redis.xadd(STREAMS.ASSESSED, '*', 'data', JSON.stringify(fullyEnriched));
  await redis.del(`assembly:${eventId}`);
}
```

The Enrichment Agent must also store the base event in the assembly hash:
```typescript
await redis.hset(`assembly:${event.id}`, 'event', JSON.stringify(enriched));
await redis.expire(`assembly:${event.id}`, ASSEMBLY_TTL_SECONDS);
```

---

## 3. Threat Assessment Agent

**File:** `server/src/agents/ThreatAssessmentAgent.ts`
**Model:** Claude Sonnet 4.6 (via ModelRouter)
**Consumes from:** `alerts:assessed` (first pass — FullyEnrichedEvent)
**Publishes to:** `alerts:assessed` (second pass — AssessedAlert)

### Confidence Scoring (computed, not self-reported)

```typescript
function computeConfidence(event: FullyEnrichedEvent): number {
  const dataCompleteness = [
    event.wind_speed !== null,
    event.wind_direction !== null,
    event.gbif_recent_sightings.length > 0,
    event.species_briefs.length > 0,
    event.habitat_distance_km < 75,
  ].filter(Boolean).length / 5;

  // NASA FIRMS is authoritative satellite data — high quality
  const sourceQuality: Record<string, number> = {
    nasa_firms: 0.95,
    noaa_nhc: 0.90,
    usgs_nwis: 0.85,
    coral_reef_watch: 0.85,
    drought_monitor: 0.75,  // weekly, coarse spatial resolution
  };
  const quality = sourceQuality[event.source] ?? 0.75;

  const habitatCertainty = event.habitat_distance_km < 10 ? 1.0
    : event.habitat_distance_km < 25 ? 0.85
    : event.habitat_distance_km < 50 ? 0.65
    : 0.45;

  return parseFloat((0.4 * dataCompleteness + 0.35 * quality + 0.25 * habitatCertainty).toFixed(3));
}
```

### Input message to Claude

```typescript
const userMessage = `
Disaster event requiring threat assessment:

Type: ${event.event_type} | Source: ${event.source}
Location: ${event.coordinates.lat}, ${event.coordinates.lng}
Severity: ${(event.severity * 100).toFixed(0)}%
Timestamp: ${event.timestamp}

Nearest habitat: ${event.habitat_distance_km.toFixed(1)}km
At-risk species: ${event.species_at_risk.join(', ')}
Weather: ${event.weather_summary}

GBIF sightings: ${event.sighting_confidence} | Most recent: ${event.most_recent_sighting ?? 'none on record'}
Sighting count (last 2yr): ${event.gbif_recent_sightings.length}

Species briefs:
${event.species_briefs.map(b => `- ${b.species_name} (${b.iucn_status}): ${b.habitat_description}`).join('\n')}

${event.raw_data['movement_dir_deg'] !== undefined
  ? `Storm track: ${event.raw_data['movement_dir_deg']}° at ${event.raw_data['movement_speed_knots']} knots`
  : ''}
`;
```

### Output processing

Parse JSON from Claude, validate fields, compute confidence, store to DB:
```typescript
const assessment = JSON.parse(response.content) as {
  threat_level: ThreatLevel;
  predicted_impact: string;
  compounding_factors: string[];
  recommended_action: string;
  reasoning: string;
};

const assessed: AssessedAlert = {
  ...event,
  threat_level: assessment.threat_level,
  predicted_impact: assessment.predicted_impact,
  compounding_factors: assessment.compounding_factors,
  recommended_action: assessment.recommended_action,
  confidence_score: computeConfidence(event),
  prediction_timestamp: new Date().toISOString(),
  sources: ['nasa_firms', 'open_meteo', 'gbif', 'iucn_postgis'],
};

// Store alert to DB (prediction_data used by Refiner in Phase 7)
await sql`
  UPDATE alerts SET
    threat_level = ${assessed.threat_level},
    confidence_score = ${assessed.confidence_score},
    prediction_data = ${JSON.stringify({ predicted_impact: assessed.predicted_impact, reasoning: assessment.reasoning })}
  WHERE raw_event_id = ${event.id}
`;

// Schedule refiner evaluations (Phase 7 will actually run them)
await sql`
  INSERT INTO refiner_queue (alert_id, evaluation_time, run_at)
  SELECT id, '24h', NOW() + INTERVAL '24 hours' FROM alerts WHERE raw_event_id = ${event.id}
`;
await sql`
  INSERT INTO refiner_queue (alert_id, evaluation_time, run_at)
  SELECT id, '48h', NOW() + INTERVAL '48 hours' FROM alerts WHERE raw_event_id = ${event.id}
`;
```

---

## 4. Synthesis Agent

**File:** `server/src/agents/SynthesisAgent.ts`
**Model:** Claude Sonnet 4.6 (via ModelRouter)
**Consumes from:** `alerts:assessed`
**Publishes to:** `discord:queue` (or drops if threat_level === 'low')

### Routing logic

```typescript
if (assessed.threat_level === 'low') {
  await logPipelineEvent({ event_id: assessed.id, source: assessed.source, stage: 'synthesis', status: 'filtered', reason: 'threat_level_low' });
  return;  // do NOT publish to discord:queue
}
```

### Discord embed colors

```typescript
export const THREAT_COLORS: Record<ThreatLevel, number> = {
  critical: 0xdc2626,  // red
  high:     0xea580c,  // orange
  medium:   0xd97706,  // amber
  low:      0x6b7280,  // gray — never posted, included for completeness
};
```

### EmbedBuilder construction

```typescript
const embed = new EmbedBuilder()
  .setColor(THREAT_COLORS[assessed.threat_level])
  .setTitle(synthesis.title)
  .setDescription(synthesis.narrative)
  .addFields(
    { name: 'Disaster Type', value: formatEventType(assessed.event_type), inline: true },
    { name: 'Distance to Habitat', value: `${assessed.habitat_distance_km.toFixed(1)} km`, inline: true },
    { name: 'Threat Level', value: assessed.threat_level.toUpperCase(), inline: true },
    { name: 'Species at Risk', value: assessed.species_at_risk.slice(0, 3).join(', ') || 'Unknown', inline: false },
    { name: 'IUCN Status', value: assessed.species_briefs[0]?.iucn_status ?? 'Unknown', inline: true },
    { name: 'Confidence', value: `${(assessed.confidence_score * 100).toFixed(0)}%`, inline: true },
  )
  .setFooter({ text: `Wildlife Sentinel • Data: ${getSourceLabel(assessed.source)} • ${new Date().toUTCString()}` });
```

---

## 5. Discord War Room

### `server/src/discord/warRoom.ts`

Posts one-line observability logs to #sentinel-ops. Rate-limited to prevent spam when many events fire simultaneously.

```typescript
import { getSentinelOpsChannel } from './bot.js';

let lastPostTime = 0;
const MIN_POST_INTERVAL_MS = 500;  // max 2 war room messages per second

export async function logToWarRoom(entry: {
  agent: string;
  action: string;
  detail: string;
  level?: 'info' | 'warning' | 'alert';
}): Promise<void> {
  // Rate limiting
  const now = Date.now();
  if (now - lastPostTime < MIN_POST_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_POST_INTERVAL_MS - (now - lastPostTime)));
  }
  lastPostTime = Date.now();

  const emoji = { info: '⚙️', warning: '⚠️', alert: '🔴' }[entry.level ?? 'info'];
  const msg = `${emoji} \`[${entry.agent}]\` ${entry.action}: ${entry.detail}`;

  try {
    await getSentinelOpsChannel().send(msg);
  } catch (err) {
    // War room failures should NOT crash the pipeline
    console.error('[war-room] Failed to post:', err);
  }
}
```

### War room log format (one line per significant action)

```
⚙️ [firms:scout] Fire detected: lat=-3.42, lng=104.21 | FRP=87.3 MW | confidence=high
⚙️ [enrichment] PostGIS: Sumatran Orangutan habitat 18.3km | weather attached | published
⚙️ [habitat] GBIF: 3 sightings confirmed (most recent: 14 days ago)
⚙️ [species_ctx] Brief: Sumatran Orangutan | CR | pop ~13,600 | declining
🔴 [threat_assess] THREAT: HIGH | confidence=0.82 | predicted spread: NW 40km/24h
⚙️ [synthesis] Generating embed | routing to #wildlife-alerts
⚙️ [discord] Posted to #wildlife-alerts | message_id=1234567890
```

---

## 6. HITL for Critical Alerts

### `server/src/discord/hitl.ts`

```typescript
import { EmbedBuilder } from 'discord.js';
import { getSentinelOpsChannel, getWildlifeAlertsChannel } from './bot.js';
import { logToWarRoom } from './warRoom.js';

export async function postCriticalForReview(embed: EmbedBuilder, alertId: string): Promise<void> {
  const opsChannel = getSentinelOpsChannel();

  const reviewMsg = await opsChannel.send({
    content: `🔴 **CRITICAL ALERT — Human review required**\nAlert ID: \`${alertId}\`\nReact ✅ to approve for public posting | React ❌ to suppress`,
    embeds: [embed],
  });

  await reviewMsg.react('✅');
  await reviewMsg.react('❌');

  const collector = reviewMsg.createReactionCollector({
    filter: (r, u) => ['✅', '❌'].includes(r.emoji.name ?? '') && !u.bot,
    max: 1,
    time: 24 * 60 * 60 * 1000,  // 24 hour review window
  });

  collector.on('collect', async (reaction) => {
    if (reaction.emoji.name === '✅') {
      await getWildlifeAlertsChannel().send({ embeds: [embed] });
      await reviewMsg.edit({ content: `✅ **Approved and posted to #wildlife-alerts** | Alert ID: \`${alertId}\`` });
      await logToWarRoom({ agent: 'hitl', action: 'Approved', detail: alertId, level: 'alert' });
    } else {
      await reviewMsg.edit({ content: `❌ **Suppressed by reviewer** | Alert ID: \`${alertId}\`` });
      await logToWarRoom({ agent: 'hitl', action: 'Suppressed', detail: alertId, level: 'warning' });
    }
  });

  collector.on('end', (collected) => {
    if (collected.size === 0) {
      logToWarRoom({ agent: 'hitl', action: 'Timed out (no review)', detail: alertId, level: 'warning' }).catch(console.error);
    }
  });
}
```

---

## Acceptance Criteria

1. ThreatAssembler correctly waits for both Habitat + Species Context results before publishing to `alerts:assessed`
2. Threat Assessment Agent produces valid `AssessedAlert` JSON for all 5 event types
3. Confidence score computed from observable fields (formula implemented in code, never from model self-report)
4. Synthesis Agent produces rich Discord embeds matching the design spec
5. `threat_level === 'low'` events: dropped at Synthesis Agent, logged to `pipeline_events`, never posted
6. `threat_level === 'critical'` events: routed to #sentinel-ops for HITL, not auto-posted
7. `threat_level === 'medium'` and `'high'`: auto-posted to #wildlife-alerts
8. War room (#sentinel-ops) shows one-line activity log for every significant pipeline action
9. `agent_prompts` table seeded with initial prompts for all three Claude agents
10. `refiner_queue` table populated with 24h + 48h entries for every fire/storm alert
11. End-to-end: fully enriched event → threat assessment → rich Discord embed in correct channel

---

## Notes / Decisions Log

- ThreatAssembler uses Redis hashes with TTL — if one agent fails or times out, the assembly TTL (5 min) prevents the partial result from sitting in Redis forever
- War room rate limiting (500ms min between posts) — prevents Discord API rate limiting when multiple events fire in quick succession
- `prediction_data` column stores the full Claude reasoning for Refiner use in Phase 7 — must be stored when the prediction is made, not reconstructed later
- `refiner_queue` populated in Phase 5 (not Phase 7) because the prediction timestamp must be recorded when the prediction is made. Phase 7 just adds the cron job that polls the queue.
- Claude Sonnet used for both Threat Assessment and Synthesis — these are the quality-critical, audience-facing outputs. Do not downgrade to Gemini.
