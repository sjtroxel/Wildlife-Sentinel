import { Router } from 'express';
import { getBotStatus } from '../discord/bot.js';

export const healthRouter = Router();
const startTime = Date.now();

// Connection state set at startup by server.ts — avoids live async pings
// that can timeout under Railway's healthcheck window.
let dbConnected = false;
let redisConnected = false;

export function setDbConnected(): void { dbConnected = true; }
export function setRedisConnected(): void { redisConnected = true; }

healthRouter.get('/', (_req, res) => {
  const discordStatus = getBotStatus();
  const allOk = dbConnected && redisConnected && discordStatus === 'connected';

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    db: dbConnected ? 'connected' : 'disconnected',
    redis: redisConnected ? 'connected' : 'disconnected',
    discord: discordStatus,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});
