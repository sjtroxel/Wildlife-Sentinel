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

const csvFixture = readFileSync(
  join(__dirname, '../fixtures/drought-response.csv'),
  'utf8'
);

import { DroughtScout } from '../../src/scouts/DroughtScout.js';
import { redis } from '../../src/redis/client.js';

describe('DroughtScout', () => {
  let scout: DroughtScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new DroughtScout();

    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.setex).mockResolvedValue('OK');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => csvFixture,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only publishes D3/D4 counties in the curated FIPS list', async () => {
    await scout.run();

    // Fixture rows:
    // 12021 FL Collier — D3=80,D4=20 — IN LIST → publish
    // 12053 FL Glades  — D3=0,D4=0   — no drought → skip
    // 06023 CA Humboldt— D3=60,D4=0  — IN LIST → publish
    // 99999 XX Unknown — D3=100       — NOT IN LIST → skip
    // 48043 TX Brewster— D3=65,D4=0  — IN LIST → publish
    expect(redis.xadd).toHaveBeenCalledTimes(3);
  });

  it('sets source to drought_monitor and event_type to drought', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('drought_monitor');
      expect(event.event_type).toBe('drought');
    }
  });

  it('computes severity from (D3 + D4) / 100', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        severity: number;
        raw_data: { fips: string; d3_percent: number; d4_percent: number }
      }
    );

    // Collier: D3=80, D4=20 → severity = (80+20)/100 = 1.0
    const collier = published.find(e => e.raw_data.fips === '12021');
    expect(collier).toBeDefined();
    expect(collier!.severity).toBeCloseTo(1.0, 3);

    // Brewster: D3=65, D4=0 → severity = 0.65
    const brewster = published.find(e => e.raw_data.fips === '48043');
    expect(brewster).toBeDefined();
    expect(brewster!.severity).toBeCloseTo(0.65, 3);
  });

  it('skips counties with D3=0 and D4=0', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { raw_data: { fips: string } }
    );

    // Glades (12053) has no D3/D4 — must not appear
    const glades = published.find(e => e.raw_data.fips === '12053');
    expect(glades).toBeUndefined();
  });

  it('skips counties not in the curated FIPS list', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { raw_data: { fips: string } }
    );

    const unknown = published.find(e => e.raw_data.fips === '99999');
    expect(unknown).toBeUndefined();
  });

  it('deduplicates events already seen in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue('1');

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('publishes nothing when CSV is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });
});
