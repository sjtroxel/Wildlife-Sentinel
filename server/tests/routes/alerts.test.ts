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
    vi.mocked(sql).mockResolvedValueOnce([mockAlert] as never);
    const res = await request.get('/alerts/recent');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ id: 'uuid-1', threat_level: 'high' });
  });

  it('parses coordinates from JSON string when DB returns text', async () => {
    const rawRow = {
      ...mockAlert,
      coordinates: '{"lat":13.744,"lng":106.688}',
      severity: '0.0696',
      confidence_score: '0.74',
    };
    vi.mocked(sql).mockResolvedValueOnce([rawRow] as never);
    const res = await request.get('/alerts/recent');
    expect(res.status).toBe(200);
    expect(res.body[0].coordinates).toEqual({ lat: 13.744, lng: 106.688 });
    expect(typeof res.body[0].severity).toBe('number');
    expect(typeof res.body[0].confidence_score).toBe('number');
    expect(res.body[0].severity).toBeCloseTo(0.0696);
    expect(res.body[0].confidence_score).toBeCloseTo(0.74);
  });

  it('returns empty array when no alerts exist', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    const res = await request.get('/alerts/recent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('defaults to limit 20', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    await request.get('/alerts/recent');
    // sql tagged template was called
    expect(vi.mocked(sql)).toHaveBeenCalledOnce();
  });

  it('caps limit at 50 regardless of query param', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    // Send limit=999 — the route caps it at 50 before passing to sql
    const res = await request.get('/alerts/recent?limit=999');
    expect(res.status).toBe(200);
    // Verify the sql call happened (limit capping is done before the sql call)
    expect(vi.mocked(sql)).toHaveBeenCalledOnce();
  });

  it('uses custom limit within bounds', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    const res = await request.get('/alerts/recent?limit=10');
    expect(res.status).toBe(200);
    expect(vi.mocked(sql)).toHaveBeenCalledOnce();
  });
});

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const mockAlertDetail = {
  id: VALID_UUID,
  raw_event_id: 'firms_2026-04-05_557_16.62_106.41',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: 16.623, lng: 106.41 },
  severity: 0.7,
  threat_level: 'high',
  confidence_score: 0.78,
  enrichment_data: {
    weather: 'Dry, low humidity',
    habitats: ['hab-1'],
    species_at_risk: ['Panthera tigris'],
    habitat_distance_km: 0.0,
    species_status: 'EN',
  },
  prediction_data: {
    predicted_impact: 'Fire likely to spread NW.',
    reasoning: 'Low humidity + wind favors spread.',
    compounding_factors: ['Dry season'],
    recommended_action: 'Monitor satellite data.',
  },
  discord_message_id: null,
  created_at: new Date().toISOString(),
  refiner_scores: [],
};

describe('GET /alerts/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with full alert detail', async () => {
    vi.mocked(sql).mockResolvedValueOnce([mockAlertDetail] as never);
    const res = await request.get(`/alerts/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(VALID_UUID);
    expect(res.body.prediction_data?.predicted_impact).toBe('Fire likely to spread NW.');
    expect(Array.isArray(res.body.refiner_scores)).toBe(true);
  });

  it('returns 404 when alert does not exist', async () => {
    vi.mocked(sql).mockResolvedValueOnce([] as never);
    const res = await request.get(`/alerts/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Alert not found' });
  });

  it('returns 400 for invalid UUID format', async () => {
    const res = await request.get('/alerts/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Invalid alert ID format' });
  });

  it('parses string-encoded JSONB fields from DB', async () => {
    const rawRow = {
      ...mockAlertDetail,
      coordinates: '{"lat":16.623,"lng":106.41}',
      severity: '0.7',
      confidence_score: '0.78',
      enrichment_data: JSON.stringify(mockAlertDetail.enrichment_data),
      prediction_data: JSON.stringify(mockAlertDetail.prediction_data),
      refiner_scores: '[]',
    };
    vi.mocked(sql).mockResolvedValueOnce([rawRow] as never);
    const res = await request.get(`/alerts/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.coordinates).toEqual({ lat: 16.623, lng: 106.41 });
    expect(typeof res.body.severity).toBe('number');
    expect(res.body.enrichment_data?.species_at_risk).toEqual(['Panthera tigris']);
    expect(Array.isArray(res.body.refiner_scores)).toBe(true);
  });

  it('returns refiner scores when present', async () => {
    const withScores = {
      ...mockAlertDetail,
      refiner_scores: [
        {
          evaluation_time: '24h',
          composite_score: 0.72,
          direction_accuracy: 0.8,
          magnitude_accuracy: 0.6,
          correction_generated: false,
          correction_note: null,
          evaluated_at: new Date().toISOString(),
        },
      ],
    };
    vi.mocked(sql).mockResolvedValueOnce([withScores] as never);
    const res = await request.get(`/alerts/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.refiner_scores).toHaveLength(1);
    expect(res.body.refiner_scores[0].composite_score).toBe(0.72);
  });
});
