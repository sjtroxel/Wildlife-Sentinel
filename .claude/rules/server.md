# Server Rules

## The app.ts / server.ts Split (Non-Negotiable)

`app.ts` exports the Express application without calling `listen()`.
`server.ts` imports `app` and calls `listen()`.

This split is critical for Vitest — supertest imports `app` directly and makes requests without starting a real server. Tests that call `listen()` create port conflicts and cause flaky failures.

```typescript
// app.ts
import express from 'express';
export const app = express();
// ... all middleware, routes
// NO app.listen() here

// server.ts
import { app } from './app.js';
app.listen(process.env.PORT ?? 3000, () => {
  console.log('Server running');
});
```

## Module Resolution (NodeNext)

`"moduleResolution": "NodeNext"` is set in tsconfig. This means:

- All relative imports MUST use `.js` extensions (referring to the output file):
  ```typescript
  import { something } from './services/myService.js'; // correct
  import { something } from './services/myService';    // wrong — will fail at runtime
  ```
- This applies everywhere: `server/`, `shared/`, `scripts/`

## Shared Types

`shared/types.d.ts` — note the `.d.ts` extension, NOT `.ts`.

This is critical. If you use `shared/types.ts`, TypeScript will factor it into `rootDir` calculation and shift all compiled output to unexpected paths, breaking Railway deployment. A `.d.ts` file is read for types but never emitted and never affects `rootDir`.

## Express 5 Patterns

```typescript
// Error handler — must have EXACTLY 4 parameters
// eslint uses argsIgnorePattern: "^_" to allow underscore-prefixed unused params
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // ...
});

// Async route handlers — Express 5 handles async errors natively
app.get('/health', async (req, res) => {
  res.json({ status: 'ok' });
});
```

## Security Baseline

Every Express app must include these middleware (in this order):

```typescript
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
```

## Environment Variables

All secrets and config via `process.env`. Validate at startup:

```typescript
// server/src/config.ts
function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  redisUrl: requireEnv('REDIS_URL'),
  discordToken: requireEnv('DISCORD_BOT_TOKEN'),
  discordGuildId: requireEnv('DISCORD_GUILD_ID'),
  nasaFirmsKey: requireEnv('NASA_FIRMS_API_KEY'),
  anthropicKey: requireEnv('ANTHROPIC_API_KEY'),
  googleAiKey: requireEnv('GOOGLE_AI_API_KEY'),
  // ...
};
```

Fail fast at startup if any required env var is missing. Do NOT let the server start in a broken state.

## Typed Error Classes

```typescript
export class AppError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
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
```

## What NOT to Do

- Do NOT call `app.listen()` in `app.ts`
- Do NOT import relative paths without `.js` extension
- Do NOT use `shared/types.ts` — use `shared/types.d.ts`
- Do NOT hardcode port numbers — use `process.env.PORT`
- Do NOT throw raw Error objects from route handlers — use typed AppError subclasses
