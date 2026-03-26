# Phase 1 — Fire Scout + Basic Pipeline

**Goal:** Real NASA FIRMS fire data flows end-to-end through the pipeline and produces a real Discord alert when a fire overlaps with a manually-loaded habitat polygon.

**Status:** Complete (2026-03-25)
**Depends on:** Phase 0 complete ✓
**Estimated sessions:** 2–3

---

## Overview

This phase wires together the first complete slice of the pipeline:

```
[NASA FIRMS Scout — node-cron, every 10 min]
        | XADD disaster:raw
        v
[Enrichment Agent — no LLM yet]
  PostGIS ST_DWithin(habitat, fire, 75km)
  Open-Meteo weather fetch
  if no overlap: drop + log to pipeline_events
  if overlap: XADD disaster:enriched
        | XADD discord:queue
        v
[Discord Publisher]
  #wildlife-alerts: plain text alert
  #sentinel-ops: agent activity log
```

No LLM is used in this phase. The Enrichment Agent does only the PostGIS spatial check and Open-Meteo weather fetch. The Discord post is plain text (rich embeds come in Phase 5). This proves the message bus works end-to-end with real data.

---

## 1. Scout Agent Base Class

Before implementing the FIRMS scout, create a shared base that all 5 scouts will extend. This centralizes retry logic, circuit-breaking, and deduplication patterns.

### `server/src/scouts/BaseScout.ts`

```typescript
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { redis } from '../redis/client.js';
import { STREAMS } from '../pipeline/streams.js';

export interface ScoutConfig {
  name: string;           // e.g. 'nasa_firms'
  dedupTtlSeconds: number; // how long to remember seen event IDs
  maxConsecutiveFailures: number; // before circuit opens
  circuitOpenMinutes: number;     // how long to pause after too many failures
}

export abstract class BaseScout {
  private consecutiveFailures = 0;
  private circuitOpenUntil: Date | null = null;

  constructor(protected readonly config: ScoutConfig) {}

  /** Subclasses implement this to fetch + normalize events */
  protected abstract fetchEvents(): Promise<RawDisasterEvent[]>;

  /** Main entry point — called by node-cron */
  async run(): Promise<void> {
    if (this.circuitOpenUntil && new Date() < this.circuitOpenUntil) {
      console.log(`[${this.config.name}] Circuit open until ${this.circuitOpenUntil.toISOString()} — skipping`);
      return;
    }

    try {
      const events = await this.fetchEvents();
      this.consecutiveFailures = 0; // reset on success

      let published = 0;
      let deduped = 0;

      for (const event of events) {
        const isDupe = await this.isDuplicate(event.id);
        if (isDupe) { deduped++; continue; }

        await redis.xadd(STREAMS.RAW, '*', 'data', JSON.stringify(event));
        await this.markSeen(event.id);
        published++;
      }

      if (published > 0 || deduped > 0) {
        console.log(`[${this.config.name}] Published: ${published}, Deduped: ${deduped}`);
      }
    } catch (err) {
      this.consecutiveFailures++;
      console.error(`[${this.config.name}] Fetch error (${this.consecutiveFailures}/${this.config.maxConsecutiveFailures}):`, err);

      if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        this.circuitOpenUntil = new Date(Date.now() + this.config.circuitOpenMinutes * 60_000);
        console.error(`[${this.config.name}] Circuit OPEN until ${this.circuitOpenUntil.toISOString()}`);
      }
    }
  }

  private async isDuplicate(eventId: string): Promise<boolean> {
    const key = `dedup:${this.config.name}:${eventId}`;
    const result = await redis.get(key);
    return result !== null;
  }

  private async markSeen(eventId: string): Promise<void> {
    const key = `dedup:${this.config.name}:${eventId}`;
    await redis.setex(key, this.config.dedupTtlSeconds, '1');
  }
}

/**
 * Retry a fetch with exponential backoff.
 * Only retries on 429/503 (transient). Does NOT retry 400/401/404 (permanent).
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxAttempts = 3
): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, options);

    if (res.ok) return res;

    // Permanent failures — don't retry
    if ([400, 401, 403, 404].includes(res.status)) {
      throw new Error(`HTTP ${res.status} from ${url} — permanent failure`);
    }

    // Transient failures — retry with backoff
    if (attempt < maxAttempts) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
      console.warn(`[fetchWithRetry] HTTP ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
      await new Promise(r => setTimeout(r, delay));
    } else {
      throw new Error(`HTTP ${res.status} from ${url} after ${maxAttempts} attempts`);
    }
  }
  throw new Error('fetchWithRetry: unreachable');
}
```

---

## 2. NASA FIRMS Scout Agent

### `server/src/scouts/FirmsScout.ts`

**API:** `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/VIIRS_SNPP_NRT/{bbox}/1/{date}`

**Response format:** CSV with columns: `latitude, longitude, bright_t31, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight`

**Schedule:** Every 10 minutes via node-cron

```typescript
import { parse } from 'csv-parse/sync';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { config } from '../config.js';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

// Geographic bounding boxes for high-priority critical habitat biomes.
// Format: West,South,East,North (FIRMS bbox convention)
// Phase 1: targeted strips. Phase 4+ can expand to global.
const PRIORITY_BBOXES: Array<{ name: string; bbox: string }> = [
  { name: 'SE_Asia',      bbox: '94,-11,145,25'   }, // Sumatra, Borneo, mainland SE Asia
  { name: 'Central_Africa', bbox: '8,-10,35,10'   }, // Congo Basin, Virunga
  { name: 'Amazon',       bbox: '-82,-20,-34,10'  }, // Amazon basin
  { name: 'California',   bbox: '-125,32,-114,42' }, // California condor range
  { name: 'E_Australia',  bbox: '138,-40,154,-22' }, // Koala habitat zones
];

interface FIRMSRow {
  latitude: string;
  longitude: string;
  bright_t31: string;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: string;
  frp: string;
  daynight: string;
}

export class FirmsScout extends BaseScout {
  constructor() {
    super({
      name: 'nasa_firms',
      dedupTtlSeconds: 7_200,       // 2 hours — FIRMS data refreshes every 10 min
      maxConsecutiveFailures: 5,
      circuitOpenMinutes: 30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const events: RawDisasterEvent[] = [];

    for (const { name, bbox } of PRIORITY_BBOXES) {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${config.nasaFirmsKey}/VIIRS_SNPP_NRT/${bbox}/1/${today}`;

      let csvText: string;
      try {
        const res = await fetchWithRetry(url);
        csvText = await res.text();
      } catch (err) {
        console.warn(`[firms:scout] Failed to fetch ${name} bbox:`, err);
        continue; // skip this bbox, try others
      }

      // Empty CSV (no fires in bbox today) = just headers
      if (!csvText.trim() || csvText.startsWith('latitude') && csvText.split('\n').length <= 2) {
        continue;
      }

      const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as FIRMSRow[];

      for (const row of rows) {
        const frp = parseFloat(row.frp);
        const confidence = row.confidence;
        const lat = parseFloat(row.latitude);
        const lng = parseFloat(row.longitude);

        // Pre-filter: ignore weak burns and low-confidence detections
        if (frp < 10) continue;
        if (confidence === 'l') continue; // 'l' = low, 'n' = nominal, 'h' = high

        if (isNaN(lat) || isNaN(lng) || isNaN(frp)) continue;

        // Unique ID: source + lat + lng + date + time (same fire detected in consecutive scans = duplicate)
        const eventId = `firms_${row.acq_date}_${row.acq_time}_${lat.toFixed(3)}_${lng.toFixed(3)}`;

        events.push({
          id: eventId,
          source: 'nasa_firms',
          event_type: 'wildfire',
          coordinates: { lat, lng },
          // Severity: FRP normalized — 1000 MW = severity 1.0 (category 5 equivalent)
          severity: Math.min(frp / 1_000, 1.0),
          timestamp: new Date(`${row.acq_date}T${row.acq_time.slice(0, 2)}:${row.acq_time.slice(2, 4)}:00Z`).toISOString(),
          raw_data: {
            frp,
            confidence,
            bright_t31: parseFloat(row.bright_t31),
            acq_date: row.acq_date,
            acq_time: row.acq_time,
            satellite: row.satellite,
            daynight: row.daynight,
            bbox_name: name,
          },
        });
      }
    }

    return events;
  }
}
```

### Cron Registration

```typescript
// server/src/scouts/index.ts
import cron from 'node-cron';
import { FirmsScout } from './FirmsScout.js';

const firmsScout = new FirmsScout();

export function startScouts(): void {
  // Every 10 minutes
  cron.schedule('*/10 * * * *', () => {
    firmsScout.run().catch(err => console.error('[scouts] FirmsScout unhandled error:', err));
  });

  console.log('[scouts] FIRMS Scout scheduled (every 10 min)');

  // Run immediately on startup (don't wait 10 minutes for first data)
  firmsScout.run().catch(err => console.error('[scouts] FirmsScout startup run failed:', err));
}
```

Add to `server.ts`: `import { startScouts } from './scouts/index.js'; startScouts();`

---

## 3. Habitat Polygon Test Loader (Phase 1)

Before the IUCN full shapefile arrives (Phase 2), load 10 manually-curated test polygons as GeoJSON into PostGIS. These are scientifically grounded approximate ranges.

### `scripts/ingest/loadTestHabitats.ts`

```typescript
import postgres from 'postgres';

const sql = postgres(process.env['DATABASE_URL']!, { ssl: 'require' });

interface TestSpecies {
  species_name: string;
  common_name: string;
  iucn_species_id: string;
  iucn_status: string;
  // GeoJSON MultiPolygon coordinates — approximate but scientifically grounded
  geojson: object;
}

const TEST_SPECIES: TestSpecies[] = [
  {
    species_name: 'Pongo abelii',
    common_name: 'Sumatran Orangutan',
    iucn_species_id: '39780',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[95.0, 2.0], [98.5, 2.0], [98.5, 5.5], [95.0, 5.5], [95.0, 2.0]]]]
    },
  },
  {
    species_name: 'Pongo pygmaeus',
    common_name: 'Bornean Orangutan',
    iucn_species_id: '17975',
    iucn_status: 'EN',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[108.0, -4.0], [116.5, -4.0], [116.5, 3.0], [108.0, 3.0], [108.0, -4.0]]]]
    },
  },
  {
    species_name: 'Gymnogyps californianus',
    common_name: 'California Condor',
    iucn_species_id: '22697636',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[-122.0, 34.0], [-114.0, 34.0], [-114.0, 38.0], [-122.0, 38.0], [-122.0, 34.0]]]]
    },
  },
  {
    species_name: 'Puma concolor coryi',
    common_name: 'Florida Panther',
    iucn_species_id: '18868',
    iucn_status: 'EN',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[-82.0, 25.0], [-80.0, 25.0], [-80.0, 27.5], [-82.0, 27.5], [-82.0, 25.0]]]]
    },
  },
  {
    species_name: 'Panthera tigris sumatrae',
    common_name: 'Sumatran Tiger',
    iucn_species_id: '41584',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[101.0, -5.0], [106.0, -5.0], [106.0, 0.0], [101.0, 0.0], [101.0, -5.0]]]]
    },
  },
  {
    species_name: 'Gorilla beringei',
    common_name: 'Mountain Gorilla',
    iucn_species_id: '39999',
    iucn_status: 'EN',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[29.0, -2.0], [30.5, -2.0], [30.5, -0.5], [29.0, -0.5], [29.0, -2.0]]]]
    },
  },
  {
    species_name: 'Loxodonta cyclotis',
    common_name: 'African Forest Elephant',
    iucn_species_id: '181007989',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[8.0, -5.0], [28.0, -5.0], [28.0, 5.0], [8.0, 5.0], [8.0, -5.0]]]]
    },
  },
  {
    species_name: 'Ailuropoda melanoleuca',
    common_name: 'Giant Panda',
    iucn_species_id: '712',
    iucn_status: 'VU',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[102.0, 28.0], [108.0, 28.0], [108.0, 34.0], [102.0, 34.0], [102.0, 28.0]]]]
    },
  },
  {
    species_name: 'Panthera pardus orientalis',
    common_name: 'Amur Leopard',
    iucn_species_id: '15954',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[130.0, 42.0], [134.0, 42.0], [134.0, 46.0], [130.0, 46.0], [130.0, 42.0]]]]
    },
  },
  {
    species_name: 'Phascolarctos cinereus',
    common_name: 'Koala',
    iucn_species_id: '16892',
    iucn_status: 'EN',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[138.0, -38.0], [153.0, -38.0], [153.0, -22.0], [138.0, -22.0], [138.0, -38.0]]]]
    },
  },
];

async function load(): Promise<void> {
  console.log('[load-test-habitats] Loading test species polygons...');

  for (const species of TEST_SPECIES) {
    await sql`
      INSERT INTO species_ranges (species_name, common_name, iucn_species_id, iucn_status, geom)
      VALUES (
        ${species.species_name},
        ${species.common_name},
        ${species.iucn_species_id},
        ${species.iucn_status},
        ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(species.geojson)}))
      )
      ON CONFLICT DO NOTHING
    `;
    console.log(`[load-test-habitats] Loaded: ${species.common_name}`);
  }

  console.log('[load-test-habitats] Done. Verifying count...');
  const count = await sql`SELECT COUNT(*) FROM species_ranges`;
  console.log(`[load-test-habitats] species_ranges now has ${count[0]?.count} rows`);
  await sql.end();
}

load().catch(err => { console.error(err); process.exit(1); });
```

Run: `npm run ingest:test-habitats` (add script to root package.json)

---

## 4. Enrichment Agent (Phase 1 — No LLM)

### `server/src/agents/EnrichmentAgent.ts`

The Phase 1 Enrichment Agent does two things only: PostGIS proximity check + Open-Meteo weather. No Gemini call yet. The `weather_summary` field is built deterministically.

```typescript
import type { RawDisasterEvent, EnrichedDisasterEvent } from '@wildlife-sentinel/shared/types';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';

const HABITAT_RADIUS_METERS = 75_000; // 75km

interface HabitatMatch {
  id: string;
  species_name: string;
  iucn_status: string;
  distance_km: number;
}

interface OpenMeteoHourly {
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  precipitation_probability: number[];
}

export async function startEnrichmentAgent(): Promise<void> {
  await ensureConsumerGroup(STREAMS.RAW, CONSUMER_GROUPS.ENRICHMENT);
  console.log('[enrichment] Consumer group ready. Waiting for events...');

  while (true) {
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.ENRICHMENT, 'enrichment-worker-1',
      'COUNT', '10', 'BLOCK', '5000',
      'STREAMS', STREAMS.RAW, '>'
    );

    if (!messages) continue;

    for (const [, entries] of messages as [string, [string, string[]][]][]) {
      for (const [messageId, fields] of entries) {
        const rawEvent = JSON.parse(fields[1] ?? '{}') as RawDisasterEvent;

        try {
          await processEvent(rawEvent);
          await redis.xack(STREAMS.RAW, CONSUMER_GROUPS.ENRICHMENT, messageId);
        } catch (err) {
          console.error('[enrichment] Error processing event:', err);
          // ACK anyway to prevent infinite redelivery loop.
          // Error is logged to pipeline_events for auditing.
          await redis.xack(STREAMS.RAW, CONSUMER_GROUPS.ENRICHMENT, messageId);
          await logPipelineEvent({
            event_id: rawEvent.id,
            source: rawEvent.source,
            stage: 'enrichment',
            status: 'error',
            reason: String(err),
          });
        }
      }
    }
  }
}

async function processEvent(event: RawDisasterEvent): Promise<void> {
  const { lat, lng } = event.coordinates;

  // 1. PostGIS habitat proximity check
  // IMPORTANT: ST_Point(lng, lat) — longitude FIRST, then latitude
  const habitats = await sql<HabitatMatch[]>`
    SELECT
      id::text,
      species_name,
      iucn_status,
      ST_Distance(geom::geography, ST_Point(${lng}, ${lat})::geography) / 1000 AS distance_km
    FROM species_ranges
    WHERE ST_DWithin(
      geom::geography,
      ST_Point(${lng}, ${lat})::geography,
      ${HABITAT_RADIUS_METERS}
    )
    ORDER BY distance_km ASC
  `;

  if (habitats.length === 0) {
    // Drop event — no critical habitat nearby
    await logPipelineEvent({
      event_id: event.id,
      source: event.source,
      stage: 'enrichment',
      status: 'filtered',
      reason: 'no_habitat_overlap',
    });
    return;
  }

  // 2. Open-Meteo weather fetch
  const weather = await fetchWeather(lat, lng);

  // 3. Build deterministic weather_summary (Phase 1 — no LLM)
  const windDir = weather.wind_direction_10m[0] ?? null;
  const windSpeed = weather.wind_speed_10m[0] ?? null;
  const precipProb = weather.precipitation_probability[0] ?? null;

  const weather_summary = windSpeed !== null && windDir !== null
    ? `Wind: ${windSpeed.toFixed(1)} km/h from ${bearingToCardinal(windDir)}. Precipitation: ${precipProb ?? 'unknown'}%.`
    : 'Weather data unavailable.';

  // 4. Build enriched event
  const enriched: EnrichedDisasterEvent = {
    ...event,
    wind_direction: windDir,
    wind_speed: windSpeed,
    precipitation_probability: precipProb,
    weather_summary,
    nearby_habitat_ids: habitats.map(h => h.id),
    species_at_risk: [...new Set(habitats.map(h => h.species_name))],
    habitat_distance_km: habitats[0]!.distance_km,
  };

  // 5. Publish to disaster:enriched
  await redis.xadd(STREAMS.ENRICHED, '*', 'data', JSON.stringify(enriched));

  await logPipelineEvent({
    event_id: event.id,
    source: event.source,
    stage: 'enriched',
    status: 'published',
    reason: `${habitats.length} habitats within ${HABITAT_RADIUS_METERS / 1000}km`,
  });

  console.log(`[enrichment] ${event.source} event enriched | habitats: ${habitats.length} | nearest: ${enriched.species_at_risk[0]} @ ${enriched.habitat_distance_km.toFixed(1)}km`);
}

async function fetchWeather(lat: number, lng: number): Promise<OpenMeteoHourly> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m,precipitation_probability');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('wind_speed_unit', 'kmh');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);

  const data = await res.json() as { hourly: OpenMeteoHourly };
  return data.hourly;
}

function bearingToCardinal(degrees: number): string {
  const cardinals = ['N','NE','E','SE','S','SW','W','NW'];
  const index = Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
  return cardinals[index] ?? 'N';
}
```

---

## 5. Pipeline Events Logger

### `server/src/db/pipelineEvents.ts`

Used throughout the pipeline to create an audit trail of every event's journey.

```typescript
import { sql } from './client.js';

interface PipelineEventRecord {
  event_id: string;
  source: string;
  stage: string;
  status: 'published' | 'filtered' | 'error' | 'posted';
  reason?: string;
}

export async function logPipelineEvent(record: PipelineEventRecord): Promise<void> {
  await sql`
    INSERT INTO pipeline_events (event_id, source, stage, status, reason)
    VALUES (${record.event_id}, ${record.source}, ${record.stage}, ${record.status}, ${record.reason ?? null})
  `;
}
```

---

## 6. Basic Discord Publisher (Phase 1)

Phase 1 uses plain text messages. Rich embeds come in Phase 5 with the Synthesis Agent.

### `server/src/discord/publisher.ts`

```typescript
import type { EnrichedDisasterEvent } from '@wildlife-sentinel/shared/types';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { getWildlifeAlertsChannel, getSentinelOpsChannel } from './bot.js';
import { sql } from '../db/client.js';

// Phase 1 uses simple text messages
// Phase 5 replaces this with rich embed construction via the Synthesis Agent

export async function startDiscordPublisher(): Promise<void> {
  await ensureConsumerGroup(STREAMS.ENRICHED, CONSUMER_GROUPS.DISCORD);
  console.log('[discord-publisher] Consumer group ready. Listening for enriched events...');

  while (true) {
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.DISCORD, 'discord-publisher-1',
      'COUNT', '5', 'BLOCK', '5000',
      'STREAMS', STREAMS.ENRICHED, '>'
    );

    if (!messages) continue;

    for (const [, entries] of messages as [string, [string, string[]][]][]) {
      for (const [messageId, fields] of entries) {
        const event = JSON.parse(fields[1] ?? '{}') as EnrichedDisasterEvent;

        try {
          await publishAlert(event);
          await redis.xack(STREAMS.ENRICHED, CONSUMER_GROUPS.DISCORD, messageId);
        } catch (err) {
          console.error('[discord-publisher] Error publishing:', err);
          await redis.xack(STREAMS.ENRICHED, CONSUMER_GROUPS.DISCORD, messageId);
        }
      }
    }
  }
}

async function publishAlert(event: EnrichedDisasterEvent): Promise<void> {
  const species = event.species_at_risk[0] ?? 'Unknown species';
  const distance = event.habitat_distance_km.toFixed(1);
  const windInfo = event.wind_speed !== null && event.wind_direction !== null
    ? `Wind: ${event.wind_speed.toFixed(0)} km/h | Direction: ${event.wind_direction.toFixed(0)}`
    : 'Wind data unavailable';

  const alertsChannel = getWildlifeAlertsChannel();
  const opsChannel = getSentinelOpsChannel();

  // Post to #wildlife-alerts
  const alertMsg = [
    `FIRE ALERT — ${species} Habitat`,
    `Fire detected ${distance}km from critical habitat boundary`,
    `${windInfo} | Precipitation: ${event.precipitation_probability ?? '?'}%`,
    `Severity: ${(event.severity * 100).toFixed(0)}% | Source: NASA FIRMS VIIRS`,
    `Detected: ${new Date(event.timestamp).toUTCString()}`,
  ].join('\n');

  const posted = await alertsChannel.send(alertMsg);

  // Store alert in DB
  await sql`
    INSERT INTO alerts (raw_event_id, source, event_type, coordinates, severity, enrichment_data, discord_message_id)
    VALUES (
      ${event.id},
      ${event.source},
      ${event.event_type},
      ${JSON.stringify(event.coordinates)},
      ${event.severity},
      ${JSON.stringify({ weather: event.weather_summary, habitats: event.nearby_habitat_ids })},
      ${posted.id}
    )
  `;

  // Log to #sentinel-ops
  await opsChannel.send(
    `[firms:scout] Fire: lat=${event.coordinates.lat}, lng=${event.coordinates.lng} | severity=${(event.severity * 100).toFixed(0)}%\n` +
    `[enrichment] Habitat overlap: ${species} ${distance}km | weather attached | published`
  );
}
```

---

## 7. Database Migrations

### `server/src/db/migrations/0002_pipeline_tables.sql`

```sql
-- Migration: 0002_pipeline_tables
-- Purpose: Audit log + alerts table for Phase 1 pipeline

-- Up

CREATE TABLE IF NOT EXISTS pipeline_events (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id   TEXT        NOT NULL,
  source     TEXT        NOT NULL,
  stage      TEXT        NOT NULL
             CHECK (stage IN ('raw','enrichment','enriched','habitat','species','threat','synthesis','posted','filtered','error')),
  status     TEXT        NOT NULL
             CHECK (status IN ('published','filtered','error','posted')),
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_event_id ON pipeline_events (event_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_created ON pipeline_events (created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_event_id      TEXT        NOT NULL,
  source            TEXT        NOT NULL,
  event_type        TEXT        NOT NULL,
  coordinates       JSONB       NOT NULL,
  severity          NUMERIC(5,4),
  enrichment_data   JSONB,
  threat_level      TEXT        CHECK (threat_level IN ('low','medium','high','critical')),  -- Phase 5
  confidence_score  NUMERIC(5,4),                                                            -- Phase 5
  prediction_data   JSONB,                                                                   -- Phase 5/7
  discord_message_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_source ON alerts (source);
CREATE INDEX IF NOT EXISTS idx_alerts_threat ON alerts (threat_level) WHERE threat_level IS NOT NULL;

-- Down
-- DROP TABLE IF EXISTS alerts;
-- DROP TABLE IF EXISTS pipeline_events;
```

---

## 8. Wiring Into server.ts

After Phase 1, `server.ts` starts three concurrent processes:

```typescript
// Add to main() in server.ts after bot starts:
import { startScouts } from './scouts/index.js';
import { startEnrichmentAgent } from './agents/EnrichmentAgent.js';
import { startDiscordPublisher } from './discord/publisher.js';

// Start the pipeline (these run as long-lived async loops)
startScouts(); // registers node-cron jobs + runs first poll immediately
void startEnrichmentAgent(); // starts XREADGROUP loop
void startDiscordPublisher(); // starts XREADGROUP loop on disaster:enriched
```

Note: `void` is intentional — these loops are designed to run forever. Errors inside are caught per-message and logged, so the loop never crashes.

---

## 9. Testing Strategy

### Unit tests

**`tests/scouts/FirmsScout.test.ts`** — Mock `fetch`:
```typescript
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  text: async () => loadFixture('firms-response.csv'),
}));
```

Test that:
- FRP < 10 rows are filtered out
- Confidence 'l' rows are filtered out
- Valid rows produce `RawDisasterEvent` with correct `severity = frp / 1000`
- Duplicate event IDs (same lat/lng/time) are deduplicated

**`tests/agents/EnrichmentAgent.test.ts`** — Mock `sql` + `redis` + `fetch`:
```typescript
// Mock PostGIS query returning habitat overlap
vi.mocked(sql).mockResolvedValueOnce([{
  id: 'test-uuid',
  species_name: 'Pongo abelii',
  iucn_status: 'CR',
  distance_km: 18.3,
}]);

// Mock Open-Meteo
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => loadFixture('open-meteo-response.json'),
}));
```

Test that:
- Events with no habitat overlap are NOT published to STREAMS.ENRICHED
- Events with overlap ARE published with correct `species_at_risk` and `habitat_distance_km`
- `weather_summary` is built correctly from Open-Meteo data

### Fixtures

```
server/tests/fixtures/
├── firms-response.csv          <- sample FIRMS CSV with mix of valid/filtered rows
└── open-meteo-response.json    <- sample Open-Meteo hourly forecast
```

### End-to-end test

Manual smoke test: inject a `RawDisasterEvent` near a loaded test polygon directly into `disaster:raw`:
```typescript
await redis.xadd('disaster:raw', '*', 'data', JSON.stringify({
  id: 'test-event-001',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: 3.5, lng: 97.0 },  // near Sumatran Orangutan polygon
  severity: 0.087,
  timestamp: new Date().toISOString(),
  raw_data: { frp: 87.3, confidence: 'n' },
}));
```

Expected result within 30 seconds:
1. Enrichment Agent logs habitat overlap
2. Discord Publisher posts to #wildlife-alerts
3. Alert appears in `alerts` table

---

## Acceptance Criteria

Phase 1 is complete when ALL of the following pass:

1. `FirmsScout` polls NASA FIRMS every 10 minutes, filters correctly, publishes to `disaster:raw`
2. Deduplication: same fire at same coordinates + time within 2 hours is NOT published twice
3. Circuit breaker: after 5 consecutive NASA FIRMS failures, scout pauses 30 minutes
4. Enrichment Agent reads `disaster:raw`, runs PostGIS ST_DWithin query correctly (lng first!)
5. Events with no habitat within 75km are dropped and logged to `pipeline_events` with `status='filtered'`
6. Events with overlap get Open-Meteo weather attached
7. Enriched events published to `disaster:enriched`
8. Discord Publisher reads `disaster:enriched` and posts to `#wildlife-alerts`
9. Alert stored in `alerts` table with `discord_message_id` populated
10. `#sentinel-ops` receives one-line agent activity log for each event
11. End-to-end: manually injected test event near a known polygon → Discord message within 30s
12. Unit tests pass: FirmsScout filtering, EnrichmentAgent PostGIS drop logic

---

## Common Gotchas

- **`ST_Point(lng, lat)` NOT `(lat, lng)`** — PostGIS uses longitude first. This is the most common spatial bug. Getting it backwards means ST_DWithin never finds matches even when habitats exist.
- **`ST_DWithin` radius is in meters** — Pass `75_000` not `75`. Passing `75` gives a 75-meter radius which matches almost nothing.
- **FIRMS CSV parsing** — The FIRMS API sometimes returns an HTML error page instead of CSV (when the API key is wrong or the bbox is invalid). Check that `csvText` starts with `latitude` before parsing.
- **Open-Meteo hourly arrays** — The forecast returns 24 hourly values. Use index `[0]` for the current hour's data. Don't average the array.
- **XREADGROUP returns `null` on timeout** — This is normal when the stream is empty. The `if (!messages) continue` guard is required or you'll get a null pointer error.
- **ioredis XREADGROUP response shape** — The return value is an array of `[streamName, [[messageId, [key, value, key, value...]]]]`. The fields array is flat key-value pairs, so `fields[1]` is the `data` field value (assuming `XADD` used `'data'` as the key).

---

## Notes / Decisions Log

- Using `csv-parse/sync` for FIRMS CSV — lightweight, handles malformed rows gracefully
- FIRMS bbox query over geographic strips rather than global — keeps Redis volume manageable in Phase 1; global can be added in Phase 4
- `weather_summary` is deterministic in Phase 1 (no LLM) — this is intentional. Gemini enrichment of the summary is added in Phase 3 when ModelRouter exists
- Enrichment Agent uses XREADGROUP BLOCK 5000ms — blocks up to 5 seconds when the stream is empty, prevents CPU spin. Adjust timeout down in production if latency matters.
- Discord Publisher consumes from `disaster:enriched` directly in Phase 1 — this bypasses the Threat/Synthesis agents which don't exist yet. Phase 5 restructures this.
