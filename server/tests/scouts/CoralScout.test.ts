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
  readFileSync(join(__dirname, '../fixtures/crw-response.json'), 'utf8')
);

import { CoralScout } from '../../src/scouts/CoralScout.js';
import { redis } from '../../src/redis/client.js';

describe('CoralScout', () => {
  let scout: CoralScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new CoralScout();

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

  it('filters out alert_level < 2 (watch only)', async () => {
    await scout.run();

    // Fixture has 3 features: level 3, level 1 (filtered), level 2
    // Level 1 (watch) must not be published
    expect(redis.xadd).toHaveBeenCalledTimes(2);
  });

  it('sets source to coral_reef_watch and event_type to coral_bleaching', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('coral_reef_watch');
      expect(event.event_type).toBe('coral_bleaching');
    }
  });

  it('computes severity as alert_level / 4', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { alert_level: number } }
    );

    // Alert level 3 → severity = 0.75
    const alertLevel3 = published.find(e => e.raw_data.alert_level === 3);
    expect(alertLevel3).toBeDefined();
    expect(alertLevel3!.severity).toBeCloseTo(0.75, 3);

    // Alert level 2 → severity = 0.5
    const alertLevel2 = published.find(e => e.raw_data.alert_level === 2);
    expect(alertLevel2).toBeDefined();
    expect(alertLevel2!.severity).toBeCloseTo(0.5, 3);
  });

  it('uses Point geometry coordinates directly', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { coordinates: { lat: number; lng: number }; raw_data: { alert_level: number } }
    );

    // First feature: Point at [145.5, -16.5] (lng, lat)
    const alertLevel3 = published.find(e => e.raw_data.alert_level === 3);
    expect(alertLevel3).toBeDefined();
    expect(alertLevel3!.coordinates.lng).toBeCloseTo(145.5, 1);
    expect(alertLevel3!.coordinates.lat).toBeCloseTo(-16.5, 1);
  });

  it('deduplicates events already seen in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue('1');

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('publishes nothing when features array is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'FeatureCollection', features: [] }),
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });
});
