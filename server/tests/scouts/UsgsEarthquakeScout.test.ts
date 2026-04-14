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

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/usgs-earthquake-response.json'), 'utf8')
);

import { UsgsEarthquakeScout } from '../../src/scouts/UsgsEarthquakeScout.js';
import { redis } from '../../src/redis/client.js';

describe('UsgsEarthquakeScout', () => {
  let scout: UsgsEarthquakeScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new UsgsEarthquakeScout();

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.setex).mockResolvedValue('OK');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixture,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes one event per feature in the fixture', async () => {
    await scout.run();
    // Fixture has 3 earthquakes
    expect(redis.xadd).toHaveBeenCalledTimes(3);
  });

  it('sets source to usgs_earthquake and event_type to earthquake', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('usgs_earthquake');
      expect(event.event_type).toBe('earthquake');
    }
  });

  it('normalizes M7.1 severity correctly: (7.1 - 5.5) / 3.5 ≈ 0.457', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { magnitude: number } }
    );

    const m71 = published.find(e => e.raw_data.magnitude === 7.1);
    expect(m71).toBeDefined();
    expect(m71!.severity).toBeCloseTo((7.1 - 5.5) / 3.5, 3);
  });

  it('normalizes M5.8 severity correctly: (5.8 - 5.5) / 3.5 ≈ 0.086', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { magnitude: number } }
    );

    const m58 = published.find(e => e.raw_data.magnitude === 5.8);
    expect(m58).toBeDefined();
    expect(m58!.severity).toBeCloseTo((5.8 - 5.5) / 3.5, 3);
  });

  it('extracts coordinates in lat/lng order from GeoJSON [lng, lat, depth]', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        coordinates: { lat: number; lng: number };
        raw_data: { place: string }
      }
    );

    // Japan event: GeoJSON [142.86, 37.72, 35.0] → lat=37.72, lng=142.86
    const japan = published.find(e => e.raw_data.place.includes('Japan'));
    expect(japan).toBeDefined();
    expect(japan!.coordinates.lat).toBeCloseTo(37.72, 3);
    expect(japan!.coordinates.lng).toBeCloseTo(142.86, 3);
  });

  it('includes depth_km and pager_alert in raw_data', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { raw_data: { depth_km: number; pager_alert: string | null } }
    );

    const japan = published[0]!;
    expect(japan.raw_data.depth_km).toBe(35.0);
    expect(japan.raw_data.pager_alert).toBe('yellow');
  });

  it('sets pager_alert to null when USGS alert field is null', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { raw_data: { place: string; pager_alert: string | null } }
    );

    const peru = published.find(e => e.raw_data.place.includes('Peru'));
    expect(peru).toBeDefined();
    expect(peru!.raw_data.pager_alert).toBeNull();
  });

  it('prefixes event ID with usgs_eq_', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { id: string }
    );

    expect(published[0]!.id).toMatch(/^usgs_eq_/);
  });

  it('publishes nothing when features array is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [] }),
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('deduplicates events already seen in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue('1');

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });
});
