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
  readFileSync(join(__dirname, '../fixtures/gdacs-dr-response.json'), 'utf8')
);

import { GdacsDroughtScout } from '../../src/scouts/GdacsDroughtScout.js';
import { redis } from '../../src/redis/client.js';

describe('GdacsDroughtScout', () => {
  let scout: GdacsDroughtScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new GdacsDroughtScout();

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

  it('publishes one event per DR feature', async () => {
    await scout.run();
    // Fixture has 3 droughts: Horn of Africa, Central Asia, Australia
    expect(redis.xadd).toHaveBeenCalledTimes(3);
  });

  it('sets source to gdacs_drought and event_type to drought', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('gdacs_drought');
      expect(event.event_type).toBe('drought');
    }
  });

  it('normalizes severity from alertscore / 3', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { alert_score: number } }
    );

    // Ethiopia: alertscore=2.7 → severity = 2.7/3 = 0.9
    const ethiopia = published.find(e => e.raw_data.alert_score === 2.7);
    expect(ethiopia).toBeDefined();
    expect(ethiopia!.severity).toBeCloseTo(2.7 / 3, 3);
  });

  it('falls back to alertlevel severity when alertscore is absent', async () => {
    const noScore = {
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [25.0, -20.0] },
        properties: {
          eventtype: 'DR',
          eventid: 9001,
          episodeid: 1,
          eventname: 'Drought in Zimbabwe',
          alertlevel: 'Red',
          country: 'Zimbabwe',
          fromdate: '2025-07-01T00:00:00',
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

    // Red fallback = 0.90
    expect(published[0]!.severity).toBe(0.90);
  });

  it('extracts coordinates in lat/lng order from GeoJSON [lng, lat]', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { coordinates: { lat: number; lng: number }; raw_data: { event_name: string } }
    );

    // Kazakhstan is at [67.4, 47.8] in GeoJSON (lng, lat)
    const kazakhstan = published.find(e => e.raw_data.event_name === 'Drought in Central Asia, Kazakhstan');
    expect(kazakhstan).toBeDefined();
    expect(kazakhstan!.coordinates.lat).toBeCloseTo(47.8, 3);
    expect(kazakhstan!.coordinates.lng).toBeCloseTo(67.4, 3);
  });

  it('includes episode ID in event ID with dr prefix', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { id: string }
    );

    expect(published[0]!.id).toMatch(/^gdacs_dr_\d+_ep\d+$/);
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

  it('skips non-DR event types', async () => {
    const wrongType = {
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {
          eventtype: 'FL',
          eventid: 9002,
          episodeid: 1,
          eventname: 'Flood somewhere',
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
