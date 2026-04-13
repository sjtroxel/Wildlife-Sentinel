import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';

const mockGetAlertTrends = vi.hoisted(() => vi.fn());

vi.mock('../../src/db/statsQueries.js', () => ({
  getAlertTrends: mockGetAlertTrends,
}));

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

const request = supertest(app);

const mockTrend = {
  date: '2026-04-12',
  wildfire: 3,
  tropical_storm: 1,
  flood: 2,
  drought: 0,
  coral_bleaching: 1,
  total: 7,
};

describe('GET /stats/trends', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with trend points', async () => {
    mockGetAlertTrends.mockResolvedValueOnce([mockTrend]);
    const res = await request.get('/stats/trends');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({
      date: '2026-04-12',
      wildfire: 3,
      total: 7,
    });
  });

  it('returns empty array when no alerts', async () => {
    mockGetAlertTrends.mockResolvedValueOnce([]);
    const res = await request.get('/stats/trends');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('passes days param to getAlertTrends', async () => {
    mockGetAlertTrends.mockResolvedValueOnce([mockTrend]);
    await request.get('/stats/trends?days=14');
    expect(mockGetAlertTrends).toHaveBeenCalledWith(14);
  });

  it('caps days at 90', async () => {
    mockGetAlertTrends.mockResolvedValueOnce([mockTrend]);
    await request.get('/stats/trends?days=200');
    expect(mockGetAlertTrends).toHaveBeenCalledWith(90);
  });

  it('returns 400 for invalid days param', async () => {
    const res = await request.get('/stats/trends?days=0');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
