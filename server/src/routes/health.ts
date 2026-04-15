import { Router } from 'express';
import { getBotStatus } from '../discord/bot.js';
import { redis } from '../redis/client.js';

export const healthRouter = Router();
const startTime = Date.now();

// Connection state set at startup by server.ts — avoids live async pings
// that can timeout under Railway's healthcheck window.
let dbConnected = false;
let redisConnected = false;

export function setDbConnected(): void { dbConnected = true; }
export function setRedisConnected(): void { redisConnected = true; }
export function resetHealthState(): void { dbConnected = false; redisConnected = false; }

const SCOUT_NAMES = ['nasa_firms', 'noaa_nhc', 'gdacs', 'usgs_nwis', 'usgs_earthquake', 'drought_monitor', 'coral_reef_watch'] as const;
type ScoutName = typeof SCOUT_NAMES[number];

interface ScoutHealth {
  status: 'ok' | 'degraded' | 'tripped';
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
}

healthRouter.get('/scouts', async (_req, res) => {
  const scouts: Record<ScoutName, ScoutHealth> = {} as Record<ScoutName, ScoutHealth>;

  await Promise.all(SCOUT_NAMES.map(async (name) => {
    const [failuresStr, openUntilStr] = await Promise.all([
      redis.get(`circuit:failures:${name}`),
      redis.get(`circuit:open_until:${name}`),
    ]);

    const consecutiveFailures = failuresStr ? parseInt(failuresStr, 10) : 0;
    const circuitOpenUntil = openUntilStr ?? null;
    const tripped = circuitOpenUntil !== null && new Date() < new Date(circuitOpenUntil);

    scouts[name] = {
      status: tripped ? 'tripped' : consecutiveFailures > 0 ? 'degraded' : 'ok',
      consecutiveFailures,
      circuitOpenUntil,
    };
  }));

  res.status(200).json({ scouts });
});

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
