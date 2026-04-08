import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';

vi.mock('../src/discord/bot.js', () => ({
  getBotStatus: vi.fn().mockReturnValue('connected'),
  startBot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/redis/client.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

import { app } from '../src/app.js';
import { setDbConnected, setRedisConnected, resetHealthState } from '../src/routes/health.js';
import { redis } from '../src/redis/client.js';

const request = supertest(app);

describe('GET /health/scouts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(redis.get).mockResolvedValue(null);
  });

  it('returns ok for all scouts when no circuit state in Redis', async () => {
    const res = await request.get('/health/scouts');
    expect(res.status).toBe(200);
    const names = ['nasa_firms', 'noaa_nhc', 'usgs_nwis', 'drought_monitor', 'coral_reef_watch'];
    for (const name of names) {
      expect(res.body.scouts[name]).toMatchObject({
        status: 'ok',
        consecutiveFailures: 0,
        circuitOpenUntil: null,
      });
    }
  });

  it('returns degraded for a scout with failures but circuit still closed', async () => {
    vi.mocked(redis.get).mockImplementation(async (key: string) => {
      if (key === 'circuit:failures:nasa_firms') return '2';
      return null;
    });

    const res = await request.get('/health/scouts');
    expect(res.status).toBe(200);
    expect(res.body.scouts['nasa_firms']).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 2,
      circuitOpenUntil: null,
    });
    expect(res.body.scouts['noaa_nhc'].status).toBe('ok');
  });

  it('returns tripped for a scout with an open circuit', async () => {
    const futureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    vi.mocked(redis.get).mockImplementation(async (key: string) => {
      if (key === 'circuit:failures:usgs_nwis') return '3';
      if (key === 'circuit:open_until:usgs_nwis') return futureTime;
      return null;
    });

    const res = await request.get('/health/scouts');
    expect(res.status).toBe(200);
    expect(res.body.scouts['usgs_nwis']).toMatchObject({
      status: 'tripped',
      consecutiveFailures: 3,
      circuitOpenUntil: futureTime,
    });
  });
});

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHealthState();
    vi.mocked(redis.get).mockResolvedValue(null);
  });

  it('returns 200 when all services are healthy', async () => {
    setDbConnected();
    setRedisConnected();

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
    // dbConnected stays false — simulates startup DB failure
    setRedisConnected();

    const res = await request.get('/health');
    expect(res.status).toBe(503);
    expect(res.body.db).toBe('disconnected');
    expect(res.body.status).toBe('degraded');
  });
});
