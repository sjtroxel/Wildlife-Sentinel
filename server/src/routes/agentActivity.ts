import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { redis } from '../redis/client.js';

export const agentActivityRouter = Router();

// Cap concurrent SSE connections — lower limit than the global rate limiter
const sseLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

// GET /agent-activity — SSE stream of pipeline activity from Redis Stream.
// On connect: replays the last 50 entries for instant history hydration.
// After that: blocks on XREAD for live entries as they arrive.
agentActivityRouter.get('/', sseLimiter, async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Hydrate with recent history (last 50, oldest-first so the panel renders correctly)
  try {
    const history = await redis.xrevrange('agent:activity', '+', '-', 'COUNT', 50) as Array<[string, string[]]>;
    for (const [, fields] of history.reverse()) {
      const dataIdx = fields.indexOf('data');
      if (dataIdx !== -1 && fields[dataIdx + 1]) {
        res.write(`data: ${fields[dataIdx + 1]}\n\n`);
      }
    }
  } catch { /* stream doesn't exist yet — fine on first run */ }

  // Stream new entries via blocking XREAD on a duplicate connection
  const sub = redis.duplicate();
  let lastId = '$'; // only entries added after this point
  let closed = false;

  req.on('close', () => {
    closed = true;
    sub.quit().catch(() => {});
  });

  (async () => {
    while (!closed) {
      try {
        const results = await sub.xread(
          'COUNT', 10, 'BLOCK', 5000,
          'STREAMS', 'agent:activity', lastId,
        ) as Array<[string, Array<[string, string[]]>]> | null;

        if (!results) continue;

        for (const [, entries] of results) {
          for (const [id, fields] of entries) {
            lastId = id;
            const dataIdx = fields.indexOf('data');
            if (dataIdx !== -1 && fields[dataIdx + 1]) {
              res.write(`data: ${fields[dataIdx + 1]}\n\n`);
            }
          }
        }
      } catch {
        if (!closed) await new Promise<void>(r => setTimeout(r, 1000));
      }
    }
  })().catch(() => {});
});
