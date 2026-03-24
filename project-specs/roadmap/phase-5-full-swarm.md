# Phase 5 — Full Agent Swarm + Discord War Room

**Goal:** Complete intelligence pipeline. Quality Discord alerts with rich embeds. Agent reasoning visible in #sentinel-ops. HITL for critical alerts.

**Status:** 🔲 Not started
**Depends on:** Phase 4 complete

---

## Overview

This phase implements the two Claude Sonnet agents (Threat Assessment + Synthesis) and wires the full pipeline together end-to-end. It also sets up the Discord war room observability pattern.

By the end of this phase, Wildlife Sentinel is functionally complete for fire and storm events (without RAG grounding, which comes in Phase 6).

---

## 1. agent_prompts Table

System prompts for LLM agents are stored in Neon, not hardcoded. This enables the Refiner (Phase 7) to update them.

```sql
-- Migration: 0003_agent_prompts.sql
CREATE TABLE agent_prompts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL UNIQUE,  -- 'threat_assessment', 'synthesis', etc.
  system_prompt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_updated_by TEXT DEFAULT 'manual',  -- 'manual' or 'refiner'
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial prompts
INSERT INTO agent_prompts (agent_name, system_prompt) VALUES
('threat_assessment', '[initial system prompt — see below]'),
('synthesis', '[initial system prompt — see below]');
```

Agents read their system prompt at startup:
```typescript
const { system_prompt } = await sql`
  SELECT system_prompt FROM agent_prompts WHERE agent_name = 'threat_assessment'
`.then(rows => rows[0]);
```

---

## 2. Threat Assessment Agent

**File:** `server/src/agents/ThreatAssessmentAgent.ts`
**Model:** Claude Sonnet 4.6 (via ModelRouter)
**Consumes from:** `alerts:assessed` (input data assembled after Habitat + Species Context agents complete)
**Publishes to:** `alerts:assessed` stream

### Input Data
The Threat Assessment Agent receives a fully-enriched event:
- Fire/storm coordinates, severity, trajectory data
- PostGIS habitat distance + species list
- GBIF recent sightings data (from Habitat Agent)
- Species briefs (from Species Context Agent)
- Weather conditions (wind speed/direction, precipitation)

### System Prompt (Initial — stored in agent_prompts table)
```
You are a wildlife threat assessment specialist. You analyze disaster events and their potential impact on endangered species and critical habitats.

For each event, provide a structured JSON assessment with these fields:
- threat_level: 'low' | 'medium' | 'high' | 'critical'
- predicted_impact: brief description of likely impact in next 24-72 hours
- compounding_factors: array of factors that worsen the prognosis
- recommended_action: one-sentence conservation response recommendation
- reasoning: chain-of-thought explaining your assessment

Threat level guidelines:
- 'critical': Disaster actively overlapping habitat boundary OR confirmed progression toward habitat within 6h
- 'high': Disaster within 25km of habitat AND conditions favor spread toward habitat
- 'medium': Disaster within 75km of habitat with uncertain trajectory
- 'low': Disaster detected near habitat but trajectory, conditions, or species population data suggest low actual risk

IMPORTANT: Your assessment must be grounded in the provided data. Do not speculate beyond what the evidence supports.
```

### Confidence Scoring (computed — never self-reported)
```typescript
function computeConfidence(event: FullyEnrichedEvent): number {
  const dataCompleteness = [
    event.wind_speed !== null,
    event.wind_direction !== null,
    event.gbif_recent_sightings.length > 0,
    event.species_briefs.length > 0,
    event.habitat_distance_km !== null,
  ].filter(Boolean).length / 5;

  const sourceQuality = event.source === 'nasa_firms' ? 0.95 : 0.80;
  // NASA FIRMS is authoritative; other sources slightly lower quality

  const habitatCertainty = event.habitat_distance_km < 25 ? 1.0
    : event.habitat_distance_km < 50 ? 0.75
    : 0.50;

  return 0.4 * dataCompleteness + 0.35 * sourceQuality + 0.25 * habitatCertainty;
}
```

### Output Interface
```typescript
interface ThreatAssessmentOutput {
  status: 'success' | 'partial' | 'failed';
  threat_level: 'low' | 'medium' | 'high' | 'critical';
  predicted_impact: string;
  compounding_factors: string[];
  recommended_action: string;
  confidence_score: number;     // computed, not self-reported
  sources: string[];            // data sources used in assessment
  prediction_timestamp: string; // ISO 8601 — critical for Refiner Phase 7
}
```

---

## 3. Synthesis Agent

**File:** `server/src/agents/SynthesisAgent.ts`
**Model:** Claude Sonnet 4.6 (via ModelRouter)
**Consumes from:** `alerts:assessed`
**Publishes to:** `discord:queue` (or drops if threat_level === 'low')

### System Prompt (Initial)
```
You are the public voice of Wildlife Sentinel, an AI system that monitors natural disasters and their impact on endangered species. You write clear, informative Discord alerts for a general audience.

Your alerts are:
- Factual and grounded in the provided data
- Informative without being alarmist — the goal is awareness, not panic
- Written for a non-specialist audience
- Empathetic to the animals at risk without being maudlin
- Concise: the main narrative should be 2-3 sentences

Always include: species name and IUCN status, disaster type and severity, proximity to habitat, and one relevant conservation context sentence (from provided context if available).

Format your response as a JSON object with fields: title, narrative, footer_note.
```

### Discord Embed Construction
```typescript
const embed = new EmbedBuilder()
  .setColor(THREAT_COLORS[assessment.threat_level])
  .setTitle(synthesis.title)
  .setDescription(synthesis.narrative)
  .addFields(
    { name: 'Disaster', value: `${formatEventType(event.event_type)} (${event.source.toUpperCase()})`, inline: true },
    { name: 'Closest Habitat', value: `${event.habitat_distance_km.toFixed(1)} km`, inline: true },
    { name: 'Threat Level', value: assessment.threat_level.toUpperCase(), inline: true },
    { name: 'Species at Risk', value: event.species_at_risk.slice(0, 3).join(', ') },
    { name: 'IUCN Status', value: event.species_briefs[0]?.iucn_status ?? 'Unknown' },
    { name: 'Confidence', value: `${(assessment.confidence_score * 100).toFixed(0)}%` },
  )
  .setFooter({ text: `Wildlife Sentinel • ${new Date().toUTCString()} • Data: ${getSourceLabel(event.source)}` });
```

Threat level colors:
- critical: `#dc2626` (red)
- high: `#ea580c` (orange)
- medium: `#d97706` (amber)
- low: never posted

---

## 4. Routing Logic in Synthesis Agent

```typescript
if (assessment.threat_level === 'low') {
  // Log to DB, do not publish to discord:queue
  await logToDb({ alert_id, action: 'dropped', reason: 'threat_level_low' });
  return;
}

const targetChannel = assessment.threat_level === 'critical'
  ? 'sentinel-ops-review'
  : 'wildlife-alerts';

await redis.xadd('discord:queue', '*', 'data', JSON.stringify({
  alert_id,
  channel: targetChannel,
  embed: embed.toJSON(),
  threat_level: assessment.threat_level,
  stored_alert_id: dbAlertId,
}));
```

---

## 5. Discord War Room (#sentinel-ops)

Every significant agent action posts a one-line observability log to #sentinel-ops. The Discord Publisher sends these after processing:

```typescript
// server/src/discord/warRoom.ts
export async function logToWarRoom(entry: {
  agent: string;
  action: string;
  detail: string;
  level?: 'info' | 'warning' | 'alert';
}): Promise<void> {
  const emoji = { info: '⚙️', warning: '⚠️', alert: '🔴' }[entry.level ?? 'info'];
  const msg = `${emoji} \`[${entry.agent}]\` ${entry.action}: ${entry.detail}`;
  await sentinelOpsChannel.send(msg);
}
```

Example war room log stream for a fire event:
```
⚙️ [firms:scout] Fire detected: lat=-3.42, lng=104.21 | FRP=87.3 MW | confidence=high
⚙️ [enrichment] PostGIS: Sumatran Orangutan habitat 18.3km | Open-Meteo attached
⚙️ [habitat] GBIF: 3 recent sightings confirmed in area (last: 14 days ago)
⚙️ [species_ctx] Species brief: Sumatran Orangutan | CR | pop ~13,600 | declining
🔴 [threat_assess] THREAT: HIGH | confidence=0.82 | predicted spread: NW 40km/24h
⚙️ [synthesis] Generating Discord embed
⚙️ [discord] Posted to #wildlife-alerts | message_id=1234567890
```

---

## 6. HITL Pattern for Critical Alerts

```typescript
// server/src/discord/hitl.ts
export async function postCriticalForReview(embed: EmbedBuilder, alertId: string) {
  const msg = await sentinelOpsChannel.send({
    content: `🔴 **CRITICAL ALERT — Human review required** | Alert ID: \`${alertId}\`\nReact ✅ to approve for public posting | React ❌ to suppress`,
    embeds: [embed],
  });

  await msg.react('✅');
  await msg.react('❌');

  const collector = msg.createReactionCollector({
    filter: (r, u) => ['✅', '❌'].includes(r.emoji.name ?? '') && !u.bot,
    max: 1,
    time: 24 * 60 * 60 * 1000,
  });

  collector.on('collect', async (reaction) => {
    if (reaction.emoji.name === '✅') {
      await wildlifeAlertsChannel.send({ embeds: [embed] });
      await logToWarRoom({ agent: 'hitl', action: 'Approved', detail: alertId, level: 'alert' });
    } else {
      await logToWarRoom({ agent: 'hitl', action: 'Suppressed', detail: alertId, level: 'warning' });
    }
  });
}
```

---

## Acceptance Criteria

1. Threat Assessment Agent produces structured output for real events
2. Confidence score is computed from observable fields (formula in code comments)
3. Synthesis Agent produces rich Discord embeds matching the design above
4. Low threat events are dropped — NOT posted to Discord
5. Critical events route to #sentinel-ops for HITL review
6. War room logs all agent actions in correct format
7. `agent_prompts` table populated with initial system prompts
8. End-to-end test: enriched event → threat assessment → Discord embed in correct channel

---

## Notes / Decisions Log

*(Add notes here as Phase 5 progresses)*
