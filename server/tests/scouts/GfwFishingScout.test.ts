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

vi.mock('../../src/config.js', () => ({
  config: {
    fishingWatchApiKey: 'test-jwt-token',
  },
}));

const fixtureWith3Vessels = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/gfw-fishing-events-response.json'), 'utf8')
);
const fixtureEmpty = { entries: [], total: 0, limit: 200, offset: 0 };

import { GfwFishingScout } from '../../src/scouts/GfwFishingScout.js';
import { redis } from '../../src/redis/client.js';

// Count MPAs in the bundled JSON to avoid hardcoding 25
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const MPA_COUNT = (require('../../src/scouts/mpaRegions.json') as { mpas: unknown[] }).mpas.length;

describe('GfwFishingScout', () => {
  let scout: GfwFishingScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new GfwFishingScout();

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.setex).mockResolvedValue('OK');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes one event per MPA when vessels detected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureWith3Vessels,
    }));

    await scout.run();

    expect(redis.xadd).toHaveBeenCalledTimes(MPA_COUNT);
  });

  it('sets source=gfw_fishing and event_type=illegal_fishing on all events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureWith3Vessels,
    }));

    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('gfw_fishing');
      expect(event.event_type).toBe('illegal_fishing');
    }
  });

  it('calculates severity as vesselCount / 10, clamped to 1.0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureWith3Vessels,  // 3 unique vessels
    }));

    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number }
    );

    // 3 vessels / 10 = 0.3 for all events (all MPAs return same fixture)
    for (const event of published) {
      expect(event.severity).toBeCloseTo(0.3);
    }
  });

  it('clamps severity to 1.0 when vessel count >= 10', async () => {
    const fixtureMany = {
      entries: Array.from({ length: 12 }, (_, i) => ({
        id: `event-${i}`,
        type: 'fishing',
        position: { lat: 31.2, lon: -114.3 },
        start: '2026-04-15T10:00:00Z',
        end: '2026-04-15T12:00:00Z',
        vessel: { id: `vessel-${i}`, ssvid: `${100000000 + i}`, flag: 'CHN' },
      })),
      total: 12,
      limit: 200,
      offset: 0,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureMany,
    }));

    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number }
    );

    for (const event of published) {
      expect(event.severity).toBe(1.0);
    }
  });

  it('skips MPAs with 0 vessels — no events published', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureEmpty,
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('deduplicates the same MPA within the same week', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureWith3Vessels,
    }));

    // Return '1' specifically for the upper_gulf_california dedup key; null for everything else
    vi.mocked(redis.get).mockImplementation(async (key) => {
      if (typeof key === 'string' && key.includes('upper_gulf_california')) return '1';
      return null;
    });

    await scout.run();

    // One fewer event than total MPAs — the vaquita MPA is deduped
    expect(redis.xadd).toHaveBeenCalledTimes(MPA_COUNT - 1);
  });

  it('populates raw_data.key_species from mpaRegions.json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureWith3Vessels,
    }));

    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { raw_data: { mpa_id: string; key_species: string[] } }
    );

    const vaquitaEvent = published.find(e => e.raw_data.mpa_id === 'upper_gulf_california');
    expect(vaquitaEvent).toBeDefined();
    expect(vaquitaEvent!.raw_data.key_species).toContain('Vaquita');
  });

  it('populates raw_data.vessel_count and vessel_flags', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fixtureWith3Vessels,
    }));

    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        raw_data: { vessel_count: number; vessel_flags: string[] }
      }
    );

    for (const event of published) {
      expect(event.raw_data.vessel_count).toBe(3);
      expect(event.raw_data.vessel_flags).toContain('CHN');
    }
  });

  it('skips gracefully when FISHING_WATCH_API_KEY is empty', async () => {
    vi.doMock('../../src/config.js', () => ({
      config: { fishingWatchApiKey: '' },
    }));

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // Re-import with empty key mock — use a fresh instance that reads the mocked config
    const { GfwFishingScout: FreshScout } = await import('../../src/scouts/GfwFishingScout.js?nocache=' + Date.now());
    const freshScout = new FreshScout();
    await freshScout.run();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('continues to remaining MPAs when one API call fails', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      // GfwFishingScout uses maxAttempts=2 — fail both attempts for MPA 1
      if (callCount <= 2) throw new Error('network error');
      return { ok: true, json: async () => fixtureWith3Vessels };
    }));

    await scout.run();

    // First MPA failed but rest still published
    expect(redis.xadd).toHaveBeenCalledTimes(MPA_COUNT - 1);
  });
});
