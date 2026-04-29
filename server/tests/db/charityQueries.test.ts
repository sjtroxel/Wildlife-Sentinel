import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.hoisted(() =>
  Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn() })
);
vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));

import {
  getCharitiesForAlert,
  getAllCharities,
  getCharityBySlug,
  getCharitiesForSpecies,
} from '../../src/db/charityQueries.js';
import type { Charity } from '@wildlife-sentinel/shared/types';

function makeCharity(overrides: Partial<Charity> = {}): Charity {
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

describe('getCharitiesForAlert', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSql.mockResolvedValue([]);
  });

  it('returns species-specific charities when match fills the limit', async () => {
    const charities = [
      makeCharity({ id: 'c1', slug: 'ofi' }),
      makeCharity({ id: 'c2', slug: 'sos' }),
      makeCharity({ id: 'c3', slug: 'wwf' }),
    ];
    // Step 1 (species): returns 3, fills limit — steps 2/3 skipped
    mockSql.mockResolvedValueOnce(charities);

    const result = await getCharitiesForAlert(['pongo abelii'], 'wildfire', 3);

    expect(result).toHaveLength(3);
    expect(result[0]!.slug).toBe('ofi');
  });

  it('falls back to event-type when no species provided', async () => {
    const eventCharities = [
      makeCharity({ id: 'c1', slug: 'rainforest-trust' }),
      makeCharity({ id: 'c2', slug: 'ran' }),
      makeCharity({ id: 'c3', slug: 'wwf' }),
    ];
    // Step 1 skipped (empty array); Step 2 (event-type): fills limit
    mockSql.mockResolvedValueOnce(eventCharities);

    const result = await getCharitiesForAlert([], 'wildfire', 3);

    expect(result).toHaveLength(3);
    expect(result[0]!.slug).toBe('rainforest-trust');
  });

  it('falls back to global charities when no species and empty event-type', async () => {
    const fallbacks = [
      makeCharity({ id: 'c1', slug: 'wwf' }),
      makeCharity({ id: 'c2', slug: 'wcs' }),
      makeCharity({ id: 'c3', slug: 'conservation-international' }),
    ];
    // Step 1 skipped; Step 2 skipped (eventType=''); Step 3 (global): fills limit
    mockSql.mockResolvedValueOnce(fallbacks);

    const result = await getCharitiesForAlert([], '', 3);

    expect(result).toHaveLength(3);
    expect(result.map(c => c.slug)).toContain('wwf');
    expect(result.map(c => c.slug)).toContain('wcs');
  });

  it('deduplicates charities that appear across multiple priority tiers', async () => {
    const wwf = makeCharity({ id: 'c1', slug: 'wwf' });
    const wcs = makeCharity({ id: 'c2', slug: 'wcs' });
    const ci  = makeCharity({ id: 'c3', slug: 'conservation-international' });

    // Step 1 (species): wwf → found=1 < 3
    // Step 2 (event-type): wwf already seen → skip; wcs added → found=2 < 3
    // Step 3 (fallback): ci added → found=3
    mockSql
      .mockResolvedValueOnce([wwf])
      .mockResolvedValueOnce([wwf, wcs])
      .mockResolvedValueOnce([ci]);

    const result = await getCharitiesForAlert(['pongo abelii'], 'wildfire', 3);

    expect(result).toHaveLength(3);
    const ids = result.map(c => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
    expect(ids).toContain('c3');
  });

  it('respects limit — never returns more than limit charities', async () => {
    const charities = [
      makeCharity({ id: 'c1', slug: 'ofi' }),
      makeCharity({ id: 'c2', slug: 'sos' }),
      makeCharity({ id: 'c3', slug: 'bos' }),
    ];
    // SQL returns 3, but limit=1 → only first is kept; steps 2/3 skipped
    mockSql.mockResolvedValueOnce(charities);

    const result = await getCharitiesForAlert(['pongo abelii'], 'wildfire', 1);

    expect(result).toHaveLength(1);
  });

  it('returns empty array when all tiers produce no results', async () => {
    // Step 1: skipped (empty species)
    // Step 2 (event-type): returns []
    // Step 3 (fallback): returns []
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getCharitiesForAlert([], 'unknown_event_type', 3);

    expect(result).toEqual([]);
  });
});

describe('getAllCharities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSql.mockResolvedValue([]);
  });

  it('returns active charities from the database', async () => {
    const rows = [
      makeCharity({ id: 'c1', name: 'African Wildlife Foundation', slug: 'awf' }),
      makeCharity({ id: 'c2', name: 'World Wildlife Fund', slug: 'wwf' }),
    ];
    mockSql.mockResolvedValueOnce(rows);

    const result = await getAllCharities();

    expect(result).toHaveLength(2);
    expect(result[0]!.slug).toBe('awf');
  });

  it('returns empty array when no active charities exist', async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await getAllCharities();

    expect(result).toEqual([]);
  });
});

describe('getCharityBySlug', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSql.mockResolvedValue([]);
  });

  it('returns the charity when slug matches', async () => {
    const wwf = makeCharity({ slug: 'wwf' });
    mockSql.mockResolvedValueOnce([wwf]);

    const result = await getCharityBySlug('wwf');

    expect(result).not.toBeNull();
    expect(result!.slug).toBe('wwf');
    expect(result!.name).toBe('World Wildlife Fund');
  });

  it('returns null for an unknown slug', async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await getCharityBySlug('does-not-exist');

    expect(result).toBeNull();
  });
});

describe('getCharitiesForSpecies', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSql.mockResolvedValue([]);
  });

  it('delegates to getCharitiesForAlert with species name and no event-type', async () => {
    const charity = makeCharity({ slug: 'panthera' });
    // Step 1 (species query): returns [charity] → found=1 < limit=5
    // Step 2 skipped (eventType='')
    // Step 3 (fallback): returns []
    mockSql
      .mockResolvedValueOnce([charity])
      .mockResolvedValueOnce([]);

    const result = await getCharitiesForSpecies('panthera uncia', 5);

    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe('panthera');
  });
});
