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
