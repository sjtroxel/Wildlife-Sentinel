# Phase 0 — Foundation

**Goal:** A working monorepo skeleton. The Discord bot connects and can post a message. Redis responds to ping. Neon+PostGIS is live and accepts connections. No application logic yet — just infrastructure.

**Status:** 🔲 Not started

---

## Pre-Phase Checklist

Before writing any Phase 0 code, confirm:
- [ ] Neon account created + `DATABASE_URL` connection string obtained
- [ ] Redis available (Railway Redis service or local Docker for dev)
- [ ] Discord bot token obtained from Developer Portal
- [ ] Discord Guild ID obtained (right-click server → Copy Server ID)
- [ ] Channel IDs for `#wildlife-alerts` and `#sentinel-ops` obtained
- [ ] Google AI API key obtained (for Gemini 2.5 models + text-embedding-004)
- [ ] Anthropic API key available

---

## 1. Monorepo Structure

npm workspaces configuration at repo root:

```json
// package.json (root)
{
  "name": "wildlife-sentinel",
  "private": true,
  "workspaces": ["server", "client", "shared", "scripts"],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspace=server",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck": "tsc --noEmit --project server/tsconfig.json && tsc --noEmit --project client/tsconfig.json"
  }
}
```

Workspaces:
- `server/` — Node.js Express + Discord bot + all agents
- `client/` — Next.js frontend
- `shared/` — Types and model constants shared between server + client
- `scripts/` — Ingestion scripts, migration runner, one-off tools

## 2. TypeScript Configuration

`server/tsconfig.json`:
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
    "skipLibCheck": true
  }
}
```

`shared/tsconfig.json`: same settings, `"declaration": true`, `"declarationOnly": true` for type-only output.

## 3. Shared Types Bootstrap

```typescript
// shared/types.d.ts  ← .d.ts NOT .ts (critical — see server.md rules)
export interface RawDisasterEvent {
  id: string;
  source: 'nasa_firms' | 'noaa_nhc' | 'usgs_nwis' | 'drought_monitor' | 'coral_reef_watch';
  event_type: 'wildfire' | 'tropical_storm' | 'flood' | 'drought' | 'coral_bleaching';
  coordinates: { lat: number; lng: number };
  severity: number;
  timestamp: string;
  raw_data: Record<string, unknown>;
}

// Populated progressively in later phases
export interface EnrichedDisasterEvent extends RawDisasterEvent { /* Phase 1 */ }
export interface AssessedAlert extends EnrichedDisasterEvent { /* Phase 5 */ }
```

```typescript
// shared/models.ts
export const MODELS = {
  CLAUDE_SONNET: 'claude-sonnet-4-6',
  GEMINI_FLASH: 'gemini-2.5-flash',
  GEMINI_FLASH_LITE: 'gemini-2.5-flash-lite',
  GOOGLE_EMBEDDINGS: 'text-embedding-004',
} as const;
```

## 4. Server Skeleton

Key files to create:
- `server/src/config.ts` — env var validation (requireEnv pattern)
- `server/src/app.ts` — Express 5, middleware only, no routes yet
- `server/src/server.ts` — calls app.listen()
- `server/src/db/client.ts` — postgres.js connection to Neon
- `server/src/db/migrations/0001_initial.sql` — CREATE EXTENSION postgis + pgvector
- `server/src/redis/client.ts` — ioredis connection

Health check endpoint:
```
GET /health → { status: 'ok', db: 'connected', redis: 'connected', discord: 'connected' }
```

## 5. PostGIS + pgvector Enabled on Neon

Run in Neon SQL editor (once):
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
```

Verify:
```sql
SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector');
```

## 6. Discord Bot Skeleton

```typescript
// server/src/discord/bot.ts
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once('ready', async () => {
  console.log(`Wildlife Sentinel online as ${client.user?.tag}`);
  // Post startup message to #sentinel-ops
  const channel = client.channels.cache.get(config.discordChannelSentinelOps);
  await channel?.send('🟢 Wildlife Sentinel is online.');
});

client.login(config.discordToken);
export { client };
```

## 7. Vitest Configuration

```typescript
// server/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: { statements: 80 },
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/**/*.d.ts'],
    },
  },
});
```

## 8. GitHub Actions CI

`.github/workflows/ci.yml` — runs on every push:
1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`

## 9. Husky Pre-commit Hooks

```bash
npx husky init
echo "npm run lint && npm run typecheck" > .husky/pre-commit
```

---

## Acceptance Criteria

Phase 0 is complete when:
1. `npm run typecheck` passes with zero errors
2. `npm run test` passes (baseline — no real tests yet, just the harness works)
3. `npm run dev` starts the server and it logs `"Wildlife Sentinel online as [BotName]"`
4. The bot posts "🟢 Wildlife Sentinel is online." to `#sentinel-ops` on startup
5. `GET /health` returns 200 with all three connections confirmed
6. PostGIS and pgvector extensions confirmed active on Neon

---

## Notes / Decisions Log

*(Add notes here as Phase 0 progresses)*
