import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';

vi.mock('../../src/db/charityQueries.js', () => ({
  getAllCharities: vi.fn(),
  getCharityBySlug: vi.fn(),
  getCharitiesForAlert: vi.fn(),
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
import { getAllCharities, getCharityBySlug, getCharitiesForAlert } from '../../src/db/charityQueries.js';

const request = supertest(app);

function makeCharity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'charity-uuid-1',
    name: 'World Wildlife Fund',
    slug: 'wwf',
    url: 'https://www.worldwildlife.org',
    donation_url: 'https://www.worldwildlife.org/donate',
    description: 'The world\'s leading conservation organization.',
    logo_url: null,
    charity_navigator_rating: 4,
    headquarters_country: 'USA',
    focus_regions: ['Global'],
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('GET /charities', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all active charities when no query params provided', async () => {
    vi.mocked(getAllCharities).mockResolvedValueOnce([
      makeCharity() as never,
      makeCharity({ id: 'c2', slug: 'wcs', name: 'Wildlife Conservation Society' }) as never,
    ]);

    const res = await request.get('/charities');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(vi.mocked(getAllCharities)).toHaveBeenCalledOnce();
    expect(vi.mocked(getCharitiesForAlert)).not.toHaveBeenCalled();
  });

  it('routes to getCharitiesForAlert when species param is provided', async () => {
    vi.mocked(getCharitiesForAlert).mockResolvedValueOnce([makeCharity()] as never);

    const res = await request.get('/charities?species=Pongo+abelii&event_type=wildfire');

    expect(res.status).toBe(200);
    expect(vi.mocked(getCharitiesForAlert)).toHaveBeenCalledWith(
      ['Pongo abelii'],
      'wildfire',
      3
    );
    expect(vi.mocked(getAllCharities)).not.toHaveBeenCalled();
  });

  it('routes to getCharitiesForAlert when only event_type param is provided', async () => {
    vi.mocked(getCharitiesForAlert).mockResolvedValueOnce([makeCharity()] as never);

    const res = await request.get('/charities?event_type=coral_bleaching');

    expect(res.status).toBe(200);
    expect(vi.mocked(getCharitiesForAlert)).toHaveBeenCalledWith([], 'coral_bleaching', 3);
  });

  it('passes custom limit to getCharitiesForAlert', async () => {
    vi.mocked(getCharitiesForAlert).mockResolvedValueOnce([makeCharity()] as never);

    const res = await request.get('/charities?event_type=wildfire&limit=2');

    expect(res.status).toBe(200);
    expect(vi.mocked(getCharitiesForAlert)).toHaveBeenCalledWith([], 'wildfire', 2);
  });

  it('clamps limit to 10 when provided value exceeds maximum', async () => {
    vi.mocked(getCharitiesForAlert).mockResolvedValueOnce([makeCharity()] as never);

    const res = await request.get('/charities?event_type=wildfire&limit=99');

    expect(res.status).toBe(200);
    expect(vi.mocked(getCharitiesForAlert)).toHaveBeenCalledWith([], 'wildfire', 10);
  });
});

describe('GET /charities/:slug', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the charity for a valid known slug', async () => {
    vi.mocked(getCharityBySlug).mockResolvedValueOnce(makeCharity() as never);

    const res = await request.get('/charities/wwf');

    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('wwf');
    expect(res.body.name).toBe('World Wildlife Fund');
  });

  it('returns 404 for an unknown slug', async () => {
    vi.mocked(getCharityBySlug).mockResolvedValueOnce(null);

    const res = await request.get('/charities/does-not-exist');

    expect(res.status).toBe(404);
  });

  it('returns 400 for a slug with invalid characters', async () => {
    const res = await request.get('/charities/bad_slug');

    expect(res.status).toBe(400);
    expect(vi.mocked(getCharityBySlug)).not.toHaveBeenCalled();
  });
});
