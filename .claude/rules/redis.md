# Redis Streams Rules

## The Pipeline Pattern (Not Conversation)

Wildlife Sentinel uses a **pipeline** (factory conveyor belt), not a conversation (group chat). Agents publish to a stream and walk away. Downstream agents subscribe and consume independently. No agent knows who is upstream or downstream.

This means:
- If one agent crashes, messages queue up and wait — system is resilient
- Agents can run in separate processes
- You can scale by adding more consumers to any stream
- Message history is persistent and auditable

## Stream Definitions

### `disaster:raw`
**Published by:** Scout Agents (5)
**Consumed by:** Enrichment Agent

```typescript
interface RawDisasterEvent {
  id: string;                    // unique event ID, used for dedup
  source: 'nasa_firms' | 'noaa_nhc' | 'usgs_nwis' | 'drought_monitor' | 'coral_reef_watch';
  event_type: 'wildfire' | 'tropical_storm' | 'flood' | 'drought' | 'coral_bleaching';
  coordinates: { lat: number; lng: number };
  severity: number;              // normalized 0-1 (source-specific conversion)
  timestamp: string;             // ISO 8601
  raw_data: Record<string, unknown>;  // original API response fields
}
```

### `disaster:enriched`
**Published by:** Enrichment Agent
**Consumed by:** Habitat Agent, Species Context Agent (both consume in parallel)

```typescript
interface EnrichedDisasterEvent extends RawDisasterEvent {
  wind_direction: number | null;   // degrees
  wind_speed: number | null;       // km/h
  precipitation_probability: number | null;
  nearby_habitat_ids: string[];    // IUCN habitat polygon IDs within radius
  species_at_risk: string[];       // IUCN species names
  habitat_distance_km: number;     // distance to nearest habitat boundary
  weather_summary: string;         // Gemini-generated brief
}
```

**Drop rule:** If `nearby_habitat_ids` is empty, the Enrichment Agent does NOT publish to `disaster:enriched`. The event is logged to `#sentinel-ops` as "filtered — no habitat overlap" and discarded.

### `alerts:assessed`
**Published by:** Threat Assessment Agent (after Habitat + Species data is attached)
**Consumed by:** Synthesis Agent

```typescript
interface AssessedAlert extends EnrichedDisasterEvent {
  gbif_recent_sightings: GBIFSighting[];
  species_briefs: SpeciesBrief[];       // from Species Context Agent
  threat_level: 'low' | 'medium' | 'high' | 'critical';
  predicted_impact: string;             // what Threat Assessment agent predicts
  confidence_score: number;             // 0-1, computed from observable fields
  compounding_factors: string[];        // e.g. "species already at historic population low"
  prediction_timestamp: string;         // when the prediction was made (for Refiner)
}
```

### `discord:queue`
**Published by:** Synthesis Agent
**Consumed by:** Discord Publisher

```typescript
interface DiscordQueueItem {
  alert_id: string;
  channel: 'wildlife-alerts' | 'sentinel-ops-review';  // critical → review first
  embed: DiscordEmbed;            // fully formed discord.js MessageEmbed
  threat_level: AssessedAlert['threat_level'];
  stored_alert_id: string;        // DB row ID for Refiner to reference later
}
```

**Routing:**
- `threat_level === 'low'` → Synthesis Agent does NOT publish. Logged to DB only.
- `threat_level === 'critical'` → publishes to `sentinel-ops-review` channel. Human reacts ✅ to approve post to `#wildlife-alerts`.
- `'medium' | 'high'` → publishes directly to `#wildlife-alerts`.

## Redis Client Patterns (ioredis)

### Publishing (XADD)
```typescript
await redis.xadd('disaster:raw', '*', 'data', JSON.stringify(event));
// '*' = auto-generate stream ID
```

### Consuming with Consumer Groups (XREADGROUP)
```typescript
// Create group (ignore error if already exists)
try {
  await redis.xgroup('CREATE', 'disaster:raw', 'enrichment-group', '0', 'MKSTREAM');
} catch (e) { /* group already exists */ }

// Read new messages (block up to 5 seconds if queue is empty)
const messages = await redis.xreadgroup(
  'GROUP', 'enrichment-group', 'enrichment-worker-1',
  'COUNT', 10, 'BLOCK', 5000,
  'STREAMS', 'disaster:raw', '>'
);

// Acknowledge after successful processing
await redis.xack('disaster:raw', 'enrichment-group', messageId);
```

**Critical:** Always XACK after successful processing. Unacknowledged messages will be redelivered. If processing fails, do NOT acknowledge — the message will be retried.

### Deduplication (Scout Agents)
```typescript
// Check if event ID was recently seen (TTL: 2 hours)
const alreadySeen = await redis.get(`dedup:${event.id}`);
if (alreadySeen) return;
await redis.setex(`dedup:${event.id}`, 7200, '1');
```

### Agent Health Heartbeat
Each long-running agent publishes a heartbeat every 30 seconds:
```typescript
await redis.setex(`agent:health:${agentName}`, 60, JSON.stringify({
  status: 'alive',
  last_seen: new Date().toISOString(),
  queue_depth: await getQueueDepth(streamName)
}));
```

## What NOT to Do

- Do NOT use LPUSH/RPOP for the pipeline — use XADD/XREADGROUP (streams persist, lists don't)
- Do NOT hold large payloads in Redis — store full data in Neon, put only IDs + essential fields in stream messages
- Do NOT skip XACK — message will be redelivered endlessly
- Do NOT create consumer groups in application startup without the try/catch pattern above
