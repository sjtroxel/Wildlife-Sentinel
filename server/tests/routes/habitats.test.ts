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

const validBbox = 'minLng=-10&minLat=-10&maxLng=10&maxLat=10';

const mockRow = {
  id: 'uuid-1',
  species_name: 'Panthera tigris',
  iucn_status: 'EN',
  geojson: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
};

describe('GET /habitats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns GeoJSON FeatureCollection for valid bbox', async () => {
    vi.mocked(sql).mockResolvedValueOnce([mockRow]);
    const res = await request.get(`/habitats?${validBbox}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('FeatureCollection');
    expect(Array.isArray(res.body.features)).toBe(true);
  });

  it('returns 400 when bbox params are missing', async () => {
    const res = await request.get('/habitats?minLng=-10&minLat=-10');
    expect(res.status).toBe(400);
  });

  it('returns 400 when bbox values are not numbers', async () => {
    const res = await request.get('/habitats?minLng=abc&minLat=-10&maxLng=10&maxLat=10');
    expect(res.status).toBe(400);
  });

  it('returns 400 when longitude out of range', async () => {
    const res = await request.get('/habitats?minLng=-200&minLat=-10&maxLng=10&maxLat=10');
    expect(res.status).toBe(400);
  });

  it('returns 400 when latitude out of range', async () => {
    const res = await request.get('/habitats?minLng=-10&minLat=-100&maxLng=10&maxLat=10');
    expect(res.status).toBe(400);
  });

  it('returns 400 when minLng > maxLng', async () => {
    const res = await request.get('/habitats?minLng=20&minLat=-10&maxLng=10&maxLat=10');
    expect(res.status).toBe(400);
  });

  it('returns 400 when minLat > maxLat', async () => {
    const res = await request.get('/habitats?minLng=-10&minLat=20&maxLng=10&maxLat=10');
    expect(res.status).toBe(400);
  });

  it('returns empty FeatureCollection when no species in bbox', async () => {
    vi.mocked(sql).mockResolvedValueOnce([]);
    const res = await request.get(`/habitats?${validBbox}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
