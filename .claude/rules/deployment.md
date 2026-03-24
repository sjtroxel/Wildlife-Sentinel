# Deployment Rules

## Deployment is the LAST Step

Do NOT configure production deployment until Phase 9. Build the application to work correctly in Railway's environment from the start (correct port usage, env vars, NodeNext output), but do not deploy until hardening is complete.

## Railway (Backend + Redis)

Railway hosts:
1. The Node.js Express server (HTTP API)
2. The Discord bot process (long-running)
3. Scout agent processes (cron-scheduled)
4. Redis instance

### Environment Variables on Railway
All secrets set via Railway dashboard → Variables. Never commit `.env` files.

Required variables:
```
DATABASE_URL           # Neon connection string
REDIS_URL              # Railway Redis URL (auto-set when Redis service added)
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
DISCORD_CHANNEL_WILDLIFE_ALERTS
DISCORD_CHANNEL_SENTINEL_OPS
NASA_FIRMS_API_KEY
GOOGLE_AI_API_KEY
ANTHROPIC_API_KEY
IUCN_API_TOKEN
NODE_ENV=production
```

### Build Command (Railway)
```
npm ci --include=dev && npm run build
```
**Critical:** `npm ci --include=dev` — NOT `npm ci`. In `NODE_ENV=production`, plain `npm ci` skips devDependencies including TypeScript. The build will fail because `tsc` is not installed.

### Start Command
```
node dist/server.js
```

### railway.toml
```toml
[build]
command = "npm ci --include=dev && npm run build"

[deploy]
startCommand = "node dist/server.js"
healthcheckPath = "/health"
```

## Vercel (Frontend)

Vercel hosts the Next.js frontend. Framework preset: Next.js.

### Environment Variables on Vercel
```
NEXT_PUBLIC_API_URL   # Railway backend URL (public — safe to expose)
```

Never put secret API keys in `NEXT_PUBLIC_` variables — they are exposed to the browser.

## Neon (Database)

No deploy step for the database itself. Run migrations via the scripts workspace before the first Railway deploy:
```
npm run migrate:prod
```

The migration script reads `DATABASE_URL` from the environment and applies any unapplied migrations.

## What NOT to Do

- Do NOT deploy before Phase 9 hardening
- Do NOT use plain `npm ci` as the Railway build command — include devDependencies
- Do NOT put `ANTHROPIC_API_KEY` or other secrets in `NEXT_PUBLIC_` variables
- Do NOT run database migrations manually from your laptop against production
- Do NOT force push to main — the user manages all git operations
