import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xadd: vi.fn().mockResolvedValue('1234-0'),
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('../../src/config.js', () => ({
  config: {
    nasaFirmsKey: 'test_key',
    redisUrl: 'redis://localhost:6379',
  },
}));

vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: { RAW: 'disaster:raw' },
}));

const csvFixture = readFileSync(
  join(__dirname, '../fixtures/firms-response.csv'),
  'utf8'
);

import { FirmsScout } from '../../src/scouts/FirmsScout.js';
import { redis } from '../../src/redis/client.js';

describe('FirmsScout', () => {
  let scout: FirmsScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new FirmsScout();

    vi.mocked(redis.get).mockResolvedValue(null); // no dupes by default
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

  it('filters out rows with FRP < 10', async () => {
    await scout.run();

    const publishedData = vi.mocked(redis.xadd).mock.calls.map(call => {
      return JSON.parse(call[3] as string) as { raw_data: { frp: number } };
    });

    // Row with frp=8.5 must not be published
    const weakFire = publishedData.find(e => e.raw_data.frp < 10);
    expect(weakFire).toBeUndefined();
  });

  it('filters out rows with confidence "l"', async () => {
    await scout.run();

    const publishedData = vi.mocked(redis.xadd).mock.calls.map(call => {
      return JSON.parse(call[3] as string) as { raw_data: { confidence: string } };
    });

    const lowConfidence = publishedData.find(e => e.raw_data.confidence === 'l');
    expect(lowConfidence).toBeUndefined();
  });

  it('publishes valid rows with correct severity (frp / 1000)', async () => {
    await scout.run();

    const publishedData = vi.mocked(redis.xadd).mock.calls.map(call => {
      return JSON.parse(call[3] as string) as { severity: number; raw_data: { frp: number } };
    });

    // frp=87.3 → severity=0.0873
    const firmsRow = publishedData.find(e => Math.abs(e.raw_data.frp - 87.3) < 0.01);
    expect(firmsRow).toBeDefined();
    expect(firmsRow!.severity).toBeCloseTo(0.0873, 3);
  });

  it('deduplicates events already seen in Redis', async () => {
    // Mark all events as already seen
    vi.mocked(redis.get).mockResolvedValue('1');

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('sets event source to nasa_firms and event_type to wildfire', async () => {
    await scout.run();

    const publishedData = vi.mocked(redis.xadd).mock.calls.map(call => {
      return JSON.parse(call[3] as string) as { source: string; event_type: string };
    });

    for (const event of publishedData) {
      expect(event.source).toBe('nasa_firms');
      expect(event.event_type).toBe('wildfire');
    }
  });

  it('skips bbox when FIRMS returns HTML error page instead of CSV', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Error: Invalid API key</body></html>',
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('continues polling other bboxes when one bbox fetch fails', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++;
      // Fail the first 2 bboxes, succeed on the rest
      if (callCount <= 2) return Promise.reject(new Error('Network error'));
      return Promise.resolve({ ok: true, text: async () => csvFixture });
    }));

    await scout.run();

    // Should have published events from the 3 successful bboxes
    expect(redis.xadd).toHaveBeenCalled();
  });
});
