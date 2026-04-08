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
  readFileSync(join(__dirname, '../fixtures/gdacs-fl-response.json'), 'utf8')
);

import { GdacsFloodScout } from '../../src/scouts/GdacsFloodScout.js';
import { redis } from '../../src/redis/client.js';

describe('GdacsFloodScout', () => {
  let scout: GdacsFloodScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new GdacsFloodScout();

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

  it('publishes one event per FL feature', async () => {
    await scout.run();
    // Fixture has 3 floods: Amazon, Mekong, Congo
    expect(redis.xadd).toHaveBeenCalledTimes(3);
  });

  it('sets source to gdacs_flood and event_type to flood', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('gdacs_flood');
      expect(event.event_type).toBe('flood');
    }
  });

  it('normalizes severity from alertscore / 3', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { alert_score: number } }
    );

    // Amazon: alertscore=2.4 → severity = 2.4/3 = 0.8
    const amazon = published.find(e => e.raw_data.alert_score === 2.4);
    expect(amazon).toBeDefined();
    expect(amazon!.severity).toBeCloseTo(2.4 / 3, 3);
  });

  it('falls back to alertlevel severity when alertscore is absent', async () => {
    const noScore = {
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [30.0, 5.0] },
        properties: {
          eventtype: 'FL',
          eventid: 9001,
          episodeid: 1,
          eventname: 'Flood in Sudan',
          alertlevel: 'Orange',
          country: 'Sudan',
          fromdate: '2025-09-01T00:00:00',
        },
      }],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => noScore,
    }));

    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number }
    );

    // Orange fallback = 0.60
    expect(published[0]!.severity).toBe(0.60);
  });

  it('extracts coordinates in lat/lng order from GeoJSON [lng, lat]', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { coordinates: { lat: number; lng: number }; raw_data: { event_name: string } }
    );

    // Mekong is at [104.9, 11.6] in GeoJSON (lng, lat)
    const mekong = published.find(e => e.raw_data.event_name === 'Flood in Mekong Basin, Cambodia');
    expect(mekong).toBeDefined();
    expect(mekong!.coordinates.lat).toBeCloseTo(11.6, 3);
    expect(mekong!.coordinates.lng).toBeCloseTo(104.9, 3);
  });

  it('includes episode ID in event ID with fl prefix', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { id: string }
    );

    expect(published[0]!.id).toMatch(/^gdacs_fl_\d+_ep\d+$/);
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

  it('skips non-FL event types', async () => {
    const wrongType = {
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {
          eventtype: 'EQ', // earthquake — wrong type
          eventid: 9002,
          episodeid: 1,
          eventname: 'Earthquake somewhere',
          alertlevel: 'Red',
          alertscore: 2.5,
          fromdate: '2025-09-01T00:00:00',
        },
      }],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => wrongType,
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });
});
