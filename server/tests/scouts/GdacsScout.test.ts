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
  readFileSync(join(__dirname, '../fixtures/gdacs-tc-response.json'), 'utf8')
);

import { GdacsScout } from '../../src/scouts/GdacsScout.js';
import { redis } from '../../src/redis/client.js';

describe('GdacsScout', () => {
  let scout: GdacsScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new GdacsScout();

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

  it('publishes one event per TC feature', async () => {
    await scout.run();
    // Fixture has 3 storms across different basins
    expect(redis.xadd).toHaveBeenCalledTimes(3);
  });

  it('sets source to gdacs and event_type to tropical_storm', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('gdacs');
      expect(event.event_type).toBe('tropical_storm');
    }
  });

  it('normalizes Knots severity against Cat 5 threshold (137 kts)', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { max_wind_value: number; max_wind_unit: string } }
    );

    // MAWAR: 115 knots → severity = 115/137 ≈ 0.839
    const mawar = published.find(e => e.raw_data.max_wind_value === 115 && e.raw_data.max_wind_unit === 'Knots');
    expect(mawar).toBeDefined();
    expect(mawar!.severity).toBeCloseTo(115 / 137, 3);
  });

  it('normalizes Km/h severity against Cat 5 threshold (254 km/h)', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { max_wind_value: number; max_wind_unit: string } }
    );

    // BERYL: 203 km/h → severity = 203/254 ≈ 0.799
    const beryl = published.find(e => e.raw_data.max_wind_value === 203 && e.raw_data.max_wind_unit === 'Km/h');
    expect(beryl).toBeDefined();
    expect(beryl!.severity).toBeCloseTo(203 / 254, 3);
  });

  it('extracts coordinates in lat/lng order from GeoJSON [lng, lat]', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { coordinates: { lat: number; lng: number }; raw_data: { storm_name: string } }
    );

    // REMAL is at [88.2, 17.5] in GeoJSON (lng, lat)
    const remal = published.find(e => e.raw_data.storm_name === 'Cyclone REMAL');
    expect(remal).toBeDefined();
    expect(remal!.coordinates.lat).toBeCloseTo(17.5, 3);
    expect(remal!.coordinates.lng).toBeCloseTo(88.2, 3);
  });

  it('includes episode ID in event ID', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { id: string }
    );

    expect(published[0]!.id).toMatch(/^gdacs_\d+_ep\d+$/);
  });

  it('publishes nothing when features is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('deduplicates events already seen in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue('1');

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('skips features with missing or zero wind value', async () => {
    const noWind = {
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [100.0, 10.0] },
          properties: {
            eventtype: 'TC',
            eventid: 9999,
            episodeid: 1,
            eventname: 'Weak TD',
            alertlevel: 'Green',
            severity: { value: 0, unit: 'Knots', unitshortname: 'Kts', severitytext: 'Tropical Depression' },
            fromdate: '2025-06-01T00:00:00',
          },
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => noWind,
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });
});
