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
  readFileSync(join(__dirname, '../fixtures/gdacs-vo-response.json'), 'utf8')
);

import { GdacsVolcanoScout } from '../../src/scouts/GdacsVolcanoScout.js';
import { redis } from '../../src/redis/client.js';

describe('GdacsVolcanoScout', () => {
  let scout: GdacsVolcanoScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new GdacsVolcanoScout();

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

  it('publishes only Orange and Red events — skips Green (unrest)', async () => {
    await scout.run();
    // Fixture has 3 volcanoes: Merapi (Orange), Nyiragongo (Red), Kilauea (Green — skipped)
    expect(redis.xadd).toHaveBeenCalledTimes(2);
  });

  it('sets source to gdacs_volcano and event_type to volcanic_eruption', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('gdacs_volcano');
      expect(event.event_type).toBe('volcanic_eruption');
    }
  });

  it('normalizes severity from alertscore / 3', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { severity: number; raw_data: { alert_score: number } }
    );

    // Nyiragongo: alertscore=2.7 → severity = 2.7/3 = 0.9
    const nyiragongo = published.find(e => e.raw_data.alert_score === 2.7);
    expect(nyiragongo).toBeDefined();
    expect(nyiragongo!.severity).toBeCloseTo(2.7 / 3, 3);
  });

  it('falls back to alertlevel severity when alertscore is absent', async () => {
    const noScore = {
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [120.0, 13.0] },
        properties: {
          eventtype: 'VO',
          eventid: 9001,
          episodeid: 1,
          eventname: 'Mayon, Philippines',
          alertlevel: 'Red',
          country: 'Philippines',
          fromdate: '2025-10-01T00:00:00',
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

    // Red fallback = 1.0
    expect(published[0]!.severity).toBe(1.0);
  });

  it('extracts coordinates in lat/lng order from GeoJSON [lng, lat]', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        coordinates: { lat: number; lng: number };
        raw_data: { volcano_name: string }
      }
    );

    // Nyiragongo is at [29.249, -1.508] in GeoJSON (lng, lat)
    const nyiragongo = published.find(e => e.raw_data.volcano_name === 'Nyiragongo, DRC');
    expect(nyiragongo).toBeDefined();
    expect(nyiragongo!.coordinates.lat).toBeCloseTo(-1.508, 3);
    expect(nyiragongo!.coordinates.lng).toBeCloseTo(29.249, 3);
  });

  it('includes volcano_name, alert_level, and severity_text in raw_data', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        raw_data: { volcano_name: string; alert_level: string; severity_text: string | null }
      }
    );

    const merapi = published.find(e => e.raw_data.volcano_name === 'Merapi, Indonesia');
    expect(merapi).toBeDefined();
    expect(merapi!.raw_data.alert_level).toBe('Orange');
    expect(merapi!.raw_data.severity_text).toBe('Strombolian eruption with lava flows');
  });

  it('prefixes event ID with gdacs_vo_', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { id: string }
    );

    expect(published[0]!.id).toMatch(/^gdacs_vo_\d+_ep\d+$/);
  });

  it('publishes nothing when features array is empty', async () => {
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

  it('skips non-VO event types', async () => {
    const wrongType = {
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {
          eventtype: 'EQ',
          eventid: 9002,
          episodeid: 1,
          eventname: 'Earthquake somewhere',
          alertlevel: 'Red',
          alertscore: 2.5,
          fromdate: '2025-11-01T00:00:00',
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
