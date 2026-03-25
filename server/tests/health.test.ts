import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';

vi.mock('../src/db/client.js', () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([{ '?column?': 1 }]), { end: vi.fn() }),
}));

vi.mock('../src/redis/client.js', () => ({
  redis: { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn(), on: vi.fn() },
}));

vi.mock('../src/discord/bot.js', () => ({
  getBotStatus: vi.fn().mockReturnValue('connected'),
  startBot: vi.fn().mockResolvedValue(undefined),
}));

import { app } from '../src/app.js';
const request = supertest(app);

describe('GET /health', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 when all services are healthy', async () => {
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
    const { sql } = await import('../src/db/client.js');
    vi.mocked(sql).mockRejectedValueOnce(new Error('connection refused'));

    const res = await request.get('/health');
    expect(res.status).toBe(503);
    expect(res.body.db).toBe('disconnected');
    expect(res.body.status).toBe('degraded');
  });
});
