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
