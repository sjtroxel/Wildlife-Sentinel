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
  readFileSync(join(__dirname, '../fixtures/nhc-response.json'), 'utf8')
);

import { NhcScout } from '../../src/scouts/NhcScout.js';
import { redis } from '../../src/redis/client.js';

describe('NhcScout', () => {
  let scout: NhcScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new NhcScout();

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

  it('publishes one event per active storm', async () => {
    await scout.run();
    // Fixture has 2 storms
    expect(redis.xadd).toHaveBeenCalledTimes(2);
  });

  it('sets source to noaa_nhc and event_type to tropical_storm', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('noaa_nhc');
      expect(event.event_type).toBe('tropical_storm');
    }
  });

  it('computes severity as wind_knots / 137, capped at 1.0', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { max_wind_knots: number } }
    );

    // Hurricane ANA: 75 knots → severity = 75/137 ≈ 0.547
    const ana = published.find(e => e.raw_data.max_wind_knots === 75);
    expect(ana).toBeDefined();
    expect(ana!.severity).toBeCloseTo(75 / 137, 3);
  });

  it('parses W longitude as negative', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { coordinates: { lat: number; lng: number } }
    );

    // ANA is at 74.5W — should be stored as -74.5
    const ana = published[0]!;
    expect(ana.coordinates.lng).toBeLessThan(0);
  });

  it('includes advisory number in event ID', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { id: string }
    );

    expect(published[0]!.id).toContain('adv009A');
  });

  it('publishes nothing when activeStorms is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ activeStorms: [] }),
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
