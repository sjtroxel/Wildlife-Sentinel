# Phase 0 — Foundation

**Goal:** A working monorepo skeleton. Discord bot connects and posts a test message. Redis responds to ping. Neon+PostGIS is live and accepts connections. No application logic yet — just infrastructure.

**Status:** Complete (2026-03-25)
**Estimated sessions:** 1–2

---

## Pre-Phase Checklist

Before writing any Phase 0 code, confirm all items in `PHASE_0_HANDOFF.md` are complete:
- [x] Neon account created + `DATABASE_URL` connection string obtained
- [x] Redis available (Railway Redis service or local Docker for dev)
- [x] Discord bot token obtained from Developer Portal
- [x] Discord Guild ID obtained (right-click server → Copy Server ID)
- [x] Channel IDs for `#wildlife-alerts` and `#sentinel-ops` obtained
- [x] Google AI API key obtained
- [x] Anthropic API key available
- [x] NASA FIRMS API key obtained

---

## 1. Monorepo Structure

### Directory Layout

```
wildlife-sentinel/
├── package.json          <- root workspace config
├── .eslintrc.json        <- shared ESLint config
├── .gitignore
├── .husky/
│   └── pre-commit        <- lint + typecheck on every commit
├── .github/
│   └── workflows/
│       └── ci.yml
├── server/               <- npm workspace
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── agents/       <- LLM agent implementations (phases 2+)
│       ├── scouts/       <- cron polling agents (phases 1+)
│       ├── pipeline/     <- Redis stream helpers
│       ├── discord/      <- discord.js bot
│       ├── db/
│       │   ├── client.ts
│       │   └── migrations/
│       ├── redis/
│       │   └── client.ts
│       ├── router/       <- ModelRouter (phase 3)
│       ├── rag/          <- RAG retrieval (phase 6)
│       ├── refiner/      <- Refiner agent (phase 7)
│       ├── config.ts
│       ├── errors.ts
│       ├── app.ts        <- Express app (no listen)
│       └── server.ts     <- calls listen()
├── client/               <- npm workspace (Next.js, phase 8)
│   └── package.json
├── shared/               <- npm workspace
│   ├── package.json
│   ├── tsconfig.json
│   ├── types.d.ts        <- .d.ts NOT .ts (critical — see below)
│   └── models.ts
└── scripts/              <- npm workspace
    ├── package.json
    ├── migrate.ts        <- migration runner
    └── ingest/           <- habitat polygon + RAG ingest scripts
```

### Root `package.json`

```json
{
  "name": "wildlife-sentinel",
  "private": true,
  "workspaces": ["server", "client", "shared", "scripts"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspace=server",
    "lint": "eslint . --ext .ts,.tsx --ignore-path .gitignore",
    "typecheck": "tsc --noEmit --project server/tsconfig.json && tsc --noEmit --project shared/tsconfig.json",
    "dev": "npm run dev --workspace=server",
    "migrate": "tsx scripts/migrate.ts",
    "ingest:species": "tsx scripts/ingest/ingestSpeciesFacts.ts",
    "ingest:conservation": "tsx scripts/ingest/ingestConservationContext.ts",
    "ingest:habitats": "tsx scripts/ingest/loadIUCNShapefiles.ts"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.0.0",
    "typescript": "^5.5.0"
  },
  "lint-staged": {
    "**/*.ts": ["eslint --fix"]
  }
}
```

### `server/package.json`

```json
{
  "name": "@wildlife-sentinel/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@google/generative-ai": "^0.21.0",
    "cors": "^2.8.5",
    "discord.js": "^14.16.0",
    "express": "^5.0.0",
    "express-rate-limit": "^7.4.0",
    "helmet": "^8.0.0",
    "ioredis": "^5.4.1",
    "node-cron": "^3.0.3",
    "postgres": "^3.4.4"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "@vitest/coverage-v8": "^2.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

### `shared/package.json`

```json
{
  "name": "@wildlife-sentinel/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    "./types": "./types.d.ts",
    "./models": "./models.js"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

### `scripts/package.json`

```json
{
  "name": "@wildlife-sentinel/scripts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "dependencies": {
    "postgres": "^3.4.4",
    "shapefile": "^0.6.6"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 2. TypeScript Configuration

### `server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Critical NodeNext import rule:** All relative imports MUST end in `.js` — e.g. `import { foo } from './bar.js'`. This refers to the compiled output file. The TypeScript source is `.ts` but the import extension is `.js`. Forgetting this causes `ERR_MODULE_NOT_FOUND` at runtime even though TypeScript compiles successfully.

### `shared/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["*.ts", "*.d.ts"],
  "exclude": ["node_modules"]
}
```

**Why `shared/types.d.ts` not `.ts`:** Using `types.ts` causes TypeScript to include it in `rootDir` calculations, which shifts compiled output to unexpected paths and breaks Railway deployment. A `.d.ts` file provides type information but is never emitted and never affects `rootDir`.

---

## 3. ESLint Configuration

### `.eslintrc.json`

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/no-floating-promises": "error",
    "no-console": "off"
  },
  "ignorePatterns": ["dist/", "node_modules/", "*.js", "*.mjs"]
}
```

---

## 4. Husky Pre-commit Hook

```bash
# Run once after npm install:
npx husky init
```

`.husky/pre-commit`:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
npx lint-staged
```

`lint-staged` runs ESLint on staged `.ts` files. Typechecking is done separately in CI (running full `tsc` on every commit is too slow).

---

## 5. Shared Types Bootstrap

### `shared/types.d.ts`

```typescript
// Core pipeline types — grow each phase.

export type DisasterSource =
  | 'nasa_firms'
  | 'noaa_nhc'
  | 'usgs_nwis'
  | 'drought_monitor'
  | 'coral_reef_watch';

export type EventType =
  | 'wildfire'
  | 'tropical_storm'
  | 'flood'
  | 'drought'
  | 'coral_bleaching';

export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';

export type IUCNStatus = 'EX' | 'EW' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC';

// Phase 0 stubs — expanded in later phases

export interface RawDisasterEvent {
  id: string;
  source: DisasterSource;
  event_type: EventType;
  coordinates: { lat: number; lng: number };
  severity: number;       // 0-1 normalized
  timestamp: string;      // ISO 8601 UTC
  raw_data: Record<string, unknown>;
}

export interface EnrichedDisasterEvent extends RawDisasterEvent {
  wind_direction: number | null;
  wind_speed: number | null;
  precipitation_probability: number | null;
  weather_summary: string;
  nearby_habitat_ids: string[];
  species_at_risk: string[];
  habitat_distance_km: number;
}

export interface GBIFSighting {
  speciesName: string;
  decimalLatitude: number;
  decimalLongitude: number;
  eventDate: string;
  datasetName: string;
  occurrenceID: string;
}

export interface SpeciesBrief {
  species_name: string;
  common_name: string;
  iucn_status: IUCNStatus;
  population_estimate: string | null;
  primary_threats: string[];
  habitat_description: string;
  source_documents: string[];
}

export interface FullyEnrichedEvent extends EnrichedDisasterEvent {
  gbif_recent_sightings: GBIFSighting[];
  species_briefs: SpeciesBrief[];
}

export interface AssessedAlert extends FullyEnrichedEvent {
  threat_level: ThreatLevel;
  predicted_impact: string;
  compounding_factors: string[];
  recommended_action: string;
  confidence_score: number;       // 0-1, computed from observable fields
  prediction_timestamp: string;   // used by Refiner
  sources: string[];
}

export interface RouterRequest {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}

export interface RouterResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface DiscordQueueItem {
  alert_id: string;
  channel: 'wildlife-alerts' | 'sentinel-ops-review';
  embed: Record<string, unknown>;
  threat_level: ThreatLevel;
  stored_alert_id: string;
}

export interface AgentOutput {
  status: 'success' | 'partial' | 'failed';
  confidence: number;
  sources: string[];
  error?: string;
}

export interface RefinerScore {
  directionAccuracy: number;
  magnitudeAccuracy: number;
  compositeScore: number;   // 0.6 * direction + 0.4 * magnitude
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  db: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  discord: 'connected' | 'disconnected';
  uptime_seconds: number;
  timestamp: string;
}
```

### `shared/models.ts`

```typescript
/**
 * All AI model strings live here. NEVER hardcode in agent files.
 *
 * Gemini 1.5 and 2.0 families were discontinued Oct 2025.
 * Current stable family is 2.5.
 */
export const MODELS = {
  // Quality-critical agents — ~$3/M input, $15/M output
  CLAUDE_SONNET: 'claude-sonnet-4-6',

  // Species Context Agent — free tier: 10 RPM / 250 RPD
  GEMINI_FLASH: 'gemini-2.5-flash',

  // Enrichment + Habitat agents — free tier: 15 RPM / 1,000 RPD
  GEMINI_FLASH_LITE: 'gemini-2.5-flash-lite',

  // RAG embeddings — 768 dimensions, free tier
  GOOGLE_EMBEDDINGS: 'text-embedding-004',
} as const;

export type ModelName = (typeof MODELS)[keyof typeof MODELS];
```

---

## 6. Server Implementation

### `server/src/errors.ts`

```typescript
export class AppError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
export class NotFoundError extends AppError {
  constructor(msg = 'Not found') { super(404, msg); }
}
export class ValidationError extends AppError {
  constructor(msg: string) { super(400, msg); }
}
export class DatabaseError extends AppError {
  constructor(msg: string) { super(500, msg); }
}
export class ExternalAPIError extends AppError {
  constructor(public readonly apiName: string, msg: string) {
    super(502, `${apiName}: ${msg}`);
  }
}
```

### `server/src/config.ts`

```typescript
function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`FATAL: Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  redisUrl: requireEnv('REDIS_URL'),
  discordToken: requireEnv('DISCORD_BOT_TOKEN'),
  discordGuildId: requireEnv('DISCORD_GUILD_ID'),
  discordChannelWildlifeAlerts: requireEnv('DISCORD_CHANNEL_WILDLIFE_ALERTS'),
  discordChannelSentinelOps: requireEnv('DISCORD_CHANNEL_SENTINEL_OPS'),
  nasaFirmsKey: requireEnv('NASA_FIRMS_API_KEY'),
  googleAiKey: requireEnv('GOOGLE_AI_API_KEY'),
  anthropicKey: requireEnv('ANTHROPIC_API_KEY'),
  iucnApiToken: requireEnv('IUCN_API_TOKEN'),
  port: parseInt(optionalEnv('PORT', '3000'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  allowedOrigins: optionalEnv('ALLOWED_ORIGINS', 'http://localhost:3001').split(','),
  isProduction: process.env['NODE_ENV'] === 'production',
} as const;
```

### `server/src/app.ts`

```typescript
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { AppError } from './errors.js';
import { healthRouter } from './routes/health.js';

export const app = express();

app.use(helmet());
app.use(cors({
  origin: config.allowedOrigins,
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false }));

app.use('/health', healthRouter);

// Error handler — must have exactly 4 params for Express to recognize it
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});
```

### `server/src/server.ts`

```typescript
import 'dotenv/config';   // loads .env in dev; no-op in prod (Railway sets vars)
import { app } from './app.js';
import { config } from './config.js';
import { sql } from './db/client.js';
import { redis } from './redis/client.js';
import { startBot } from './discord/bot.js';

async function main(): Promise<void> {
  try {
    await sql`SELECT 1`;
    console.log('[startup] Database connected');
  } catch (err) {
    console.error('[startup] Database connection failed:', err);
    process.exit(1);
  }

  try {
    await redis.ping();
    console.log('[startup] Redis connected');
  } catch (err) {
    console.error('[startup] Redis connection failed:', err);
    process.exit(1);
  }

  await startBot();

  app.listen(config.port, () => {
    console.log(`[startup] Wildlife Sentinel running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
```

### `server/src/db/client.ts`

```typescript
import postgres from 'postgres';
import { config } from '../config.js';

export const sql = postgres(config.databaseUrl, {
  ssl: 'require',
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: { undefined: null },
});

process.on('SIGTERM', async () => {
  await sql.end({ timeout: 5 });
});
```

### `server/src/redis/client.ts`

```typescript
import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 5) return null;
    return Math.min(times * 200, 2000);
  },
});

redis.on('error', (err: Error) => console.error('[redis] Error:', err.message));
redis.on('connect', () => console.log('[redis] Connected'));

process.on('SIGTERM', async () => { await redis.quit(); });
```

### `server/src/routes/health.ts`

```typescript
import { Router } from 'express';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';
import { getBotStatus } from '../discord/bot.js';

export const healthRouter = Router();
const startTime = Date.now();

healthRouter.get('/', async (_req, res) => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';
  try { await sql`SELECT 1`; dbStatus = 'connected'; } catch { /* leave disconnected */ }

  let redisStatus: 'connected' | 'disconnected' = 'disconnected';
  try {
    const pong = await redis.ping();
    if (pong === 'PONG') redisStatus = 'connected';
  } catch { /* leave disconnected */ }

  const discordStatus = getBotStatus();
  const allOk = dbStatus === 'connected' && redisStatus === 'connected' && discordStatus === 'connected';

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    db: dbStatus,
    redis: redisStatus,
    discord: discordStatus,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});
```

### `server/src/discord/bot.ts`

```typescript
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { config } from '../config.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

let botStatus: 'connected' | 'disconnected' = 'disconnected';

export function getBotStatus(): 'connected' | 'disconnected' {
  return botStatus;
}

export function getSentinelOpsChannel(): TextChannel {
  const ch = client.channels.cache.get(config.discordChannelSentinelOps);
  if (!ch || !(ch instanceof TextChannel)) throw new Error('sentinel-ops channel unavailable');
  return ch;
}

export function getWildlifeAlertsChannel(): TextChannel {
  const ch = client.channels.cache.get(config.discordChannelWildlifeAlerts);
  if (!ch || !(ch instanceof TextChannel)) throw new Error('wildlife-alerts channel unavailable');
  return ch;
}

export async function startBot(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.once('ready', async () => {
      botStatus = 'connected';
      console.log(`[discord] Online as ${client.user?.tag}`);
      try {
        const ops = getSentinelOpsChannel();
        await ops.send('Wildlife Sentinel is online. Pipeline starting up...');
      } catch (err) {
        console.error('[discord] Failed to post startup message:', err);
      }
      resolve();
    });
    client.on('error', (err) => {
      botStatus = 'disconnected';
      console.error('[discord] Client error:', err);
      reject(err);
    });
    client.login(config.discordToken).catch(reject);
  });
}

export { client };
```

---

## 7. Pipeline Streams Constants

Create this now so later phases can import from it.

### `server/src/pipeline/streams.ts`

```typescript
import { redis } from '../redis/client.js';

export const STREAMS = {
  RAW: 'disaster:raw',
  ENRICHED: 'disaster:enriched',
  ASSESSED: 'alerts:assessed',
  DISCORD: 'discord:queue',
} as const;

export const CONSUMER_GROUPS = {
  ENRICHMENT: 'enrichment-group',
  HABITAT: 'habitat-group',
  SPECIES: 'species-group',
  THREAT: 'threat-group',
  SYNTHESIS: 'synthesis-group',
  DISCORD: 'discord-group',
} as const;

export type StreamName = (typeof STREAMS)[keyof typeof STREAMS];
export type ConsumerGroup = (typeof CONSUMER_GROUPS)[keyof typeof CONSUMER_GROUPS];

/**
 * Create a Redis consumer group if it doesn't already exist.
 * BUSYGROUP error = group exists = safe to ignore.
 * Call this at startup in every consumer agent before processing.
 */
export async function ensureConsumerGroup(
  stream: StreamName,
  group: ConsumerGroup
): Promise<void> {
  try {
    await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
  } catch (err) {
    if (err instanceof Error && err.message.includes('BUSYGROUP')) return;
    throw err;
  }
}
```

---

## 8. Database Migrations

### `server/src/db/migrations/0001_initial.sql`

```sql
-- Migration: 0001_initial
-- Purpose: Extensions + species_ranges table

-- Up

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify extensions loaded
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'PostGIS failed to install';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'pgvector failed to install';
  END IF;
END $$;

-- species_ranges: IUCN habitat polygon table
-- Phase 1: loaded with ~10 manual test species
-- Phase 2: loaded with full IUCN CR+EN shapefile
CREATE TABLE IF NOT EXISTS species_ranges (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  species_name     TEXT        NOT NULL,
  common_name      TEXT,
  iucn_species_id  TEXT,
  iucn_status      VARCHAR(2)  NOT NULL
                   CHECK (iucn_status IN ('EX','EW','CR','EN','VU','NT','LC')),
  geom             GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index: required for ST_DWithin performance at full dataset scale
CREATE INDEX IF NOT EXISTS idx_species_ranges_geom ON species_ranges USING GIST (geom);
-- Name index: for fast lookups by species name
CREATE INDEX IF NOT EXISTS idx_species_ranges_name ON species_ranges (species_name);

-- Down
-- DROP INDEX IF EXISTS idx_species_ranges_name;
-- DROP INDEX IF EXISTS idx_species_ranges_geom;
-- DROP TABLE IF EXISTS species_ranges;
-- DROP EXTENSION IF EXISTS vector;
-- DROP EXTENSION IF EXISTS postgis;
```

### Migration Runner: `scripts/migrate.ts`

```typescript
/**
 * Applies unapplied .sql migrations in order.
 * Usage: npm run migrate
 * Reads DATABASE_URL from environment.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) { console.error('DATABASE_URL required'); process.exit(1); }

const sql = postgres(databaseUrl, { ssl: 'require' });
const migrationsDir = join(__dirname, '../server/src/db/migrations');

async function run(): Promise<void> {
  // Create tracking table if needed
  await sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const applied = new Set(
    (await sql<{ filename: string }[]>`SELECT filename FROM migrations`).map(r => r.filename)
  );

  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const filename of files) {
    if (applied.has(filename)) { console.log(`[migrate] Skip ${filename}`); continue; }

    const content = readFileSync(join(migrationsDir, filename), 'utf8');
    const upSection = content.split('-- Down')[0] ?? content;

    console.log(`[migrate] Applying ${filename}...`);
    await sql.begin(async (tx) => {
      await tx.unsafe(upSection);
      await tx`INSERT INTO migrations (filename) VALUES (${filename})`;
    });
    console.log(`[migrate] Done: ${filename}`);
  }

  console.log('[migrate] All migrations current.');
  await sql.end();
}

run().catch(err => { console.error('[migrate] Fatal:', err); process.exit(1); });
```

---

## 9. Vitest Configuration

### `server/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/**/*.d.ts', 'src/db/migrations/**'],
      reporter: ['text', 'html'],
    },
  },
});
```

### Baseline test: `server/tests/health.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';

vi.mock('../src/db/client.js', () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([{ '?column?': 1 }]), { end: vi.fn() }),
}));

vi.mock('../src/redis/client.js', () => ({
  redis: { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn(), on: vi.fn() },
}));

vi.mock('../src/discord/bot.js', () => ({
  getBotStatus: vi.fn().mockReturnValue('connected'),
  startBot: vi.fn().mockResolvedValue(undefined),
}));

import { app } from '../src/app.js';
const request = supertest(app);

describe('GET /health', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 200 when all services are healthy', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      db: 'connected',
      redis: 'connected',
      discord: 'connected',
    });
    expect(typeof res.body.uptime_seconds).toBe('number');
  });

  it('returns 503 when DB is down', async () => {
    const { sql } = await import('../src/db/client.js');
    vi.mocked(sql).mockRejectedValueOnce(new Error('connection refused'));

    const res = await request.get('/health');
    expect(res.status).toBe(503);
    expect(res.body.db).toBe('disconnected');
    expect(res.body.status).toBe('degraded');
  });
});
```

---

## 10. GitHub Actions CI

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  ci:
    name: Lint + Typecheck + Test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm run test
        env:
          # Fake values satisfy config validation; all external calls are mocked in tests
          DATABASE_URL: postgresql://fake:fake@fake.neon.tech/fake?sslmode=require
          REDIS_URL: redis://localhost:6379
          DISCORD_BOT_TOKEN: fake_token
          DISCORD_GUILD_ID: "123456789"
          DISCORD_CHANNEL_WILDLIFE_ALERTS: "123456789"
          DISCORD_CHANNEL_SENTINEL_OPS: "123456789"
          NASA_FIRMS_API_KEY: fake_key
          GOOGLE_AI_API_KEY: fake_key
          ANTHROPIC_API_KEY: fake_key
          IUCN_API_TOKEN: fake_token
          NODE_ENV: test
```

---

## 11. `.gitignore`

```
node_modules/
dist/
.next/
out/
.env
.env.local
server/.env
data/
*.shp
*.shx
*.dbf
*.prj
*.log
coverage/
.DS_Store
```

---

## Acceptance Criteria

Phase 0 is complete when ALL of the following pass:

1. `npm run typecheck` exits with code 0 — zero TypeScript errors across server/ and shared/
2. `npm run lint` exits with code 0 — zero ESLint errors
3. `npm run test` exits with code 0 — both health endpoint tests pass
4. `npm run dev` starts successfully and logs all three confirmation lines:
   - `[startup] Database connected`
   - `[startup] Redis connected`
   - `[discord] Online as [BotName]`
5. The bot posts "Wildlife Sentinel is online. Pipeline starting up..." to `#sentinel-ops` on startup
6. `GET /health` returns HTTP 200 with `{ status: 'ok', db: 'connected', redis: 'connected', discord: 'connected' }`
7. PostGIS + pgvector confirmed: `SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector')` returns 2 rows in Neon SQL editor
8. GitHub Actions CI workflow passes on push to main

---

## Common Gotchas

- **`.js` extensions on relative imports** — Required by NodeNext. Forgetting causes `ERR_MODULE_NOT_FOUND` at runtime.
- **`shared/types.d.ts` must be `.d.ts`** — Using `.ts` breaks `rootDir`, breaks Railway build.
- **`app.listen()` must NOT be in `app.ts`** — Causes port conflicts in Vitest.
- **Railway build command is `npm ci --include=dev && npm run build`** — Plain `npm ci` in `NODE_ENV=production` skips devDependencies including TypeScript. Build fails with `tsc: command not found`.
- **PostGIS + pgvector are not auto-enabled on Neon** — Must run `CREATE EXTENSION` manually in the Neon SQL editor before migrations.
- **Discord MessageContent intent** — Must be enabled in Discord Developer Portal → Bot → Privileged Gateway Intents. Without it the bot connects but can't read message content for future command handling.
- **`ioredis` vs `redis` package** — We use `ioredis`. The types differ. Do not mix.

---

## Notes / Decisions Log

- `tsx watch` for dev server — faster than ts-node, supports NodeNext without configuration
- `postgres.js` over `pg` — better TypeScript ergonomics, tagged template literal API prevents SQL injection by default
- Migration runner is custom TypeScript, not Knex/Flyway — simpler, no extra dependencies, easier to audit
- `express-rate-limit` global 100 req/min — tightened per-route in Phase 9
- Fake env vars in CI — all external dependencies are mocked in tests, so fake values just satisfy config validation without ever being used
