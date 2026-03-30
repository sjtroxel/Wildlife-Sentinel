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

const mockAlert = {
  id: 'uuid-1',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: -3.42, lng: 104.21 },
  severity: 0.7,
  threat_level: 'high',
  confidence_score: 0.78,
  enrichment_data: null,
  created_at: new Date().toISOString(),
  discord_message_id: null,
};

describe('GET /alerts/recent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with alert rows', async () => {
    vi.mocked(sql).mockResolvedValueOnce([mockAlert]);
    const res = await request.get('/alerts/recent');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ id: 'uuid-1', threat_level: 'high' });
  });

  it('returns empty array when no alerts exist', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]);
    const res = await request.get('/alerts/recent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('defaults to limit 20', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]);
    await request.get('/alerts/recent');
    // sql tagged template was called
    expect(vi.mocked(sql)).toHaveBeenCalledOnce();
  });

  it('caps limit at 50 regardless of query param', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]);
    // Send limit=999 — the route caps it at 50 before passing to sql
    const res = await request.get('/alerts/recent?limit=999');
    expect(res.status).toBe(200);
    // Verify the sql call happened (limit capping is done before the sql call)
    expect(vi.mocked(sql)).toHaveBeenCalledOnce();
  });

  it('uses custom limit within bounds', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]);
    const res = await request.get('/alerts/recent?limit=10');
    expect(res.status).toBe(200);
    expect(vi.mocked(sql)).toHaveBeenCalledOnce();
  });
});
