import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';

vi.mock('../../src/db/client.js', () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([{ '?column?': 1 }]), { end: vi.fn() }),
}));

vi.mock('../../src/redis/client.js', () => ({
  redis: { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn(), on: vi.fn() },
}));

vi.mock('../../src/discord/bot.js', () => ({
  getBotStatus: vi.fn().mockReturnValue('connected'),
  startBot: vi.fn().mockResolvedValue(undefined),
}));

import { app } from '../../src/app.js';
import { sql } from '../../src/db/client.js';

const request = supertest(app);

const mockScore = {
  composite_score: 0.72,
  direction_accuracy: 0.85,
  magnitude_accuracy: 0.53,
  evaluation_time: '48h',
  evaluated_at: new Date().toISOString(),
  event_type: 'wildfire',
  source: 'nasa_firms',
};

describe('GET /refiner/scores', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with score rows', async () => {
    vi.mocked(sql).mockResolvedValueOnce([mockScore]);
    const res = await request.get('/refiner/scores');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({
      composite_score: 0.72,
      direction_accuracy: 0.85,
      magnitude_accuracy: 0.53,
      event_type: 'wildfire',
      source: 'nasa_firms',
    });
  });

  it('returns empty array when no scores exist', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]);
    const res = await request.get('/refiner/scores');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('joins refiner_scores with alerts (sql called once per request)', async () => {
    vi.mocked(sql).mockResolvedValueOnce([mockScore]);
    await request.get('/refiner/scores');
    expect(vi.mocked(sql)).toHaveBeenCalledOnce();
  });
});
