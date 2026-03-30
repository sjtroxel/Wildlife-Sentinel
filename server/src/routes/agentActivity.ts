import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { redis } from '../redis/client.js';

export const agentActivityRouter = Router();

// Cap concurrent SSE connections — lower limit than the global rate limiter
const sseLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

// GET /agent-activity — SSE stream of live pipeline activity from Redis pub/sub
agentActivityRouter.get('/', sseLimiter, async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Duplicate the Redis connection — pub/sub mode blocks it from other commands
  const subscriber = redis.duplicate();
  await subscriber.subscribe('agent:activity');

  subscriber.on('message', (_channel: string, message: string) => {
    res.write(`data: ${message}\n\n`);
  });

  req.on('close', () => {
    subscriber.unsubscribe('agent:activity').catch(console.error);
    subscriber.quit().catch(console.error);
  });
});
