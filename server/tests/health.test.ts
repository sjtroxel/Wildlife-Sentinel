import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';

vi.mock('../src/discord/bot.js', () => ({
  getBotStatus: vi.fn().mockReturnValue('connected'),
  startBot: vi.fn().mockResolvedValue(undefined),
}));

import { app } from '../src/app.js';
import { setDbConnected, setRedisConnected, resetHealthState } from '../src/routes/health.js';

const request = supertest(app);

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHealthState();
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
