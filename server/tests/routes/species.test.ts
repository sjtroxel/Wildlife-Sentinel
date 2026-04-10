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

const mockSpeciesRow = {
  species_name: 'Pongo abelii',
  common_name: 'Sumatran Orangutan',
  iucn_status: 'CR',
  iucn_species_id: '121097935',
  slug: 'pongo-abelii',
};

const mockSpeciesDetail = {
  ...mockSpeciesRow,
  centroid_lat: '-3.5',
  centroid_lng: '104.2',
  range_geojson: { type: 'MultiPolygon', coordinates: [] },
};

const mockAlertRow = {
  id: 'alert-uuid-1',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: -3.42, lng: 104.21 },
  severity: '0.7',
  threat_level: 'high',
  confidence_score: '0.78',
  enrichment_data: null,
  created_at: new Date().toISOString(),
  discord_message_id: null,
};

describe('GET /species', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with species list', async () => {
    vi.mocked(sql).mockResolvedValueOnce([mockSpeciesRow] as never);
    const res = await request.get('/species');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ species_name: 'Pongo abelii', iucn_status: 'CR' });
  });

  it('returns empty array when no species in DB', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    const res = await request.get('/species');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('accepts limit and offset params', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    const res = await request.get('/species?limit=10&offset=50');
    expect(res.status).toBe(200);
  });

  it('caps limit at 100', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    const res = await request.get('/species?limit=999');
    expect(res.status).toBe(200);
  });
});

describe('GET /species/:slug', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with species detail and recent alerts', async () => {
    vi.mocked(sql)
      .mockResolvedValueOnce([mockSpeciesDetail] as never)  // species query
      .mockResolvedValueOnce([mockAlertRow] as never);       // alerts query
    const res = await request.get('/species/pongo-abelii');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      species_name: 'Pongo abelii',
      common_name: 'Sumatran Orangutan',
      iucn_status: 'CR',
      slug: 'pongo-abelii',
    });
    expect(res.body.centroid).toMatchObject({ lat: -3.5, lng: 104.2 });
    expect(Array.isArray(res.body.recent_alerts)).toBe(true);
    expect(res.body.recent_alerts[0]).toMatchObject({ id: 'alert-uuid-1', threat_level: 'high' });
  });

  it('normalizes numeric alert fields', async () => {
    vi.mocked(sql)
      .mockResolvedValueOnce([mockSpeciesDetail] as never)
      .mockResolvedValueOnce([mockAlertRow] as never);
    const res = await request.get('/species/pongo-abelii');
    expect(res.status).toBe(200);
    expect(typeof res.body.recent_alerts[0].severity).toBe('number');
    expect(typeof res.body.recent_alerts[0].confidence_score).toBe('number');
  });

  it('returns empty recent_alerts when none found', async () => {
    vi.mocked(sql)
      .mockResolvedValueOnce([mockSpeciesDetail] as never)
      .mockResolvedValueOnce([] as never);
    const res = await request.get('/species/pongo-abelii');
    expect(res.status).toBe(200);
    expect(res.body.recent_alerts).toEqual([]);
  });

  it('returns 404 when slug not found in DB', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    const res = await request.get('/species/unknown-species');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Species not found' });
  });

  it('returns 400 for invalid slug characters', async () => {
    const res = await request.get('/species/Pongo%20abelii');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Invalid species slug' });
  });

  it('returns 400 for slug with special chars', async () => {
    const res = await request.get('/species/pongo_abelii!');
    expect(res.status).toBe(400);
  });
});
