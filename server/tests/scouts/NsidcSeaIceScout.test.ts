import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xadd:   vi.fn().mockResolvedValue('1234-0'),
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    on:     vi.fn(),
    quit:   vi.fn(),
  },
}));

vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: { RAW: 'disaster:raw' },
}));

// April 15 north: extent=12.00, median=13.89, std=0.53 → sigma≈-3.57 → triggers
const NORTH_CSV = readFileSync(
  join(__dirname, '../fixtures/nsidc-sea-ice-north.csv'),
  'utf8'
);

// April 15 south: extent=6.50, median=6.60, std=0.65 → sigma≈-0.15 → no alert
const SOUTH_CSV = readFileSync(
  join(__dirname, '../fixtures/nsidc-sea-ice-south.csv'),
  'utf8'
);

import { NsidcSeaIceScout } from '../../src/scouts/NsidcSeaIceScout.js';
import { redis } from '../../src/redis/client.js';

function mockFetch(northCsv: string, southCsv: string) {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok: true, text: async () => northCsv })
    .mockResolvedValueOnce({ ok: true, text: async () => southCsv })
  );
}

describe('NsidcSeaIceScout', () => {
  let scout: NsidcSeaIceScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new NsidcSeaIceScout();

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.setex).mockResolvedValue('OK');

    mockFetch(NORTH_CSV, SOUTH_CSV);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes one event when only north hemisphere is anomalous', async () => {
    await scout.run();
    // South (sigma≈-0.15) is normal → only north fires
    expect(redis.xadd).toHaveBeenCalledTimes(1);
  });

  it('sets source to nsidc_sea_ice and event_type to sea_ice_loss', async () => {
    await scout.run();

    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.source).toBe('nsidc_sea_ice');
    expect(event.event_type).toBe('sea_ice_loss');
  });

  it('uses Arctic coordinates for north hemisphere event', async () => {
    await scout.run();

    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.coordinates.lat).toBeCloseTo(80.0, 1);
    expect(event.coordinates.lng).toBeCloseTo(0.0, 1);
  });

  it('computes severity from sigma: |sigma|/3.0 clamped to 1.0', async () => {
    // sigma = (12.00 - 13.89) / 0.53 ≈ -3.566 → |sigma|/3 ≈ 1.189 → clamped to 1.0
    await scout.run();

    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.severity).toBe(1.0);
  });

  it('prefixes event ID with nsidc_north_', async () => {
    await scout.run();

    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.id).toMatch(/^nsidc_north_/);
  });

  it('includes anomaly metadata in raw_data', async () => {
    await scout.run();

    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.raw_data.hemisphere).toBe('north');
    expect(event.raw_data.extent_mkm2).toBe(12.0);
    expect(event.raw_data.median_1981_2010).toBe(13.89);
    expect(event.raw_data.sigma_deviation).toBeLessThan(-1.0);
  });

  it('publishes two events when both hemispheres are anomalous', async () => {
    // South CSV with a severely anomalous reading: extent=2.5, median=3.76, std=0.66 → sigma≈-1.91
    const anomalousSouthCsv = [
      'Year, Month, Day, Extent, Missing, Source Data',
      '2026,2,15,2.50,0.000,AMSR2',
    ].join('\n');

    mockFetch(NORTH_CSV, anomalousSouthCsv);

    await scout.run();

    expect(redis.xadd).toHaveBeenCalledTimes(2);

    const events = vi.mocked(redis.xadd).mock.calls.map(c =>
      JSON.parse(c[3] as string) as { id: string; event_type: string }
    );
    const ids = events.map(e => e.id);
    expect(ids.some(id => id.startsWith('nsidc_north_'))).toBe(true);
    expect(ids.some(id => id.startsWith('nsidc_south_'))).toBe(true);
  });

  it('publishes nothing when both hemispheres are in normal range', async () => {
    // North CSV with normal April reading: extent=13.85, median=13.89, std=0.53 → sigma≈-0.08
    const normalNorthCsv = [
      'Year, Month, Day, Extent, Missing, Source Data',
      '2026,4,15,13.85,0.000,AMSR2',
    ].join('\n');

    mockFetch(normalNorthCsv, SOUTH_CSV);

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('deduplicates events already seen in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue('1');

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('skips lines with non-numeric year (header rows)', async () => {
    const csvWithExtraHeaders = [
      '# NSIDC Sea Ice Index v3',
      'Year, Month, Day, Extent, Missing, Source Data',
      '2026,4,15,12.00,0.000,AMSR2',
    ].join('\n');

    mockFetch(csvWithExtraHeaders, SOUTH_CSV);

    await scout.run();

    // Still parses the one valid data row → one event
    expect(redis.xadd).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing when CSV is empty or unparseable', async () => {
    mockFetch('# no data\n', SOUTH_CSV);

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('trips circuit breaker after 3 consecutive fetch failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    vi.mocked(redis.incr).mockResolvedValue(3);

    await scout.run();

    expect(redis.incr).toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining('circuit:open_until:nsidc_sea_ice'),
      expect.any(Number),
      expect.any(String)
    );
  });
});
