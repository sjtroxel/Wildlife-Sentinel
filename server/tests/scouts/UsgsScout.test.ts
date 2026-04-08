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
  readFileSync(join(__dirname, '../fixtures/usgs-response.json'), 'utf8')
);

import { UsgsScout } from '../../src/scouts/UsgsScout.js';
import { redis } from '../../src/redis/client.js';

describe('UsgsScout', () => {
  let scout: UsgsScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new UsgsScout();

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

  it('only publishes sites above flood stage', async () => {
    // Fixture: Russian River 13500 cfs (flood_stage=11000 — ABOVE)
    //          Turner River 650 cfs (flood_stage=800 — below, should be filtered)
    await scout.run();

    expect(redis.xadd).toHaveBeenCalledTimes(1);

    const published = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { raw_data: { site_code: string } };

    expect(published.raw_data.site_code).toBe('11463980');
  });

  it('sets source to usgs_nwis and event_type to flood', async () => {
    await scout.run();

    const published = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { source: string; event_type: string };

    expect(published.source).toBe('usgs_nwis');
    expect(published.event_type).toBe('flood');
  });

  it('computes severity from excess above flood stage', async () => {
    await scout.run();

    const published = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { severity: number; raw_data: { discharge_cfs: number; flood_stage_cfs: number } };

    // Russian River: (13500 - 11000) / 11000 = 0.2272...
    const expected = (13500 - 11000) / 11000;
    expect(published.severity).toBeCloseTo(expected, 3);
  });

  it('ignores site codes not in the curated list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        value: {
          timeSeries: [
            {
              sourceInfo: { siteCode: [{ value: '99999999' }] },
              values: [{ value: [{ value: '99999.0', dateTime: '2025-01-15T12:00:00.000Z' }] }],
            },
          ],
        },
      }),
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
