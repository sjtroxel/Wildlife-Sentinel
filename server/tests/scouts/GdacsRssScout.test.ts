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

const fixtureXml = readFileSync(
  join(__dirname, '../fixtures/gdacs-rss-response.xml'), 'utf8'
);

import { GdacsRssScout } from '../../src/scouts/GdacsRssScout.js';
import { redis } from '../../src/redis/client.js';

type PublishedEvent = {
  id: string;
  source: string;
  event_type: string;
  severity: number;
  coordinates: { lat: number; lng: number };
  timestamp: string;
  raw_data: Record<string, unknown>;
};

function getPublished(): PublishedEvent[] {
  return vi.mocked(redis.xadd).mock.calls.map(
    (call) => JSON.parse(call[3] as string) as PublishedEvent
  );
}

describe('GdacsRssScout', () => {
  let scout: GdacsRssScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new GdacsRssScout();
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.setex).mockResolvedValue('OK');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      text: async () => fixtureXml,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Coverage ─────────────────────────────────────────────────────────────

  it('publishes 4 events from 7-item fixture (skips VO-green, WF, EQ)', async () => {
    await scout.run();
    expect(redis.xadd).toHaveBeenCalledTimes(4);
  });

  it('ignores WF (wildfire) and EQ (earthquake) items', async () => {
    await scout.run();
    const events = getPublished();
    expect(events.find(e => e.event_type === 'wildfire')).toBeUndefined();
    expect(events.find(e => e.event_type === 'earthquake')).toBeUndefined();
  });

  // ── Type mapping ─────────────────────────────────────────────────────────

  it('maps TC → source:gdacs / event_type:tropical_storm', async () => {
    await scout.run();
    const tc = getPublished().find(e => e.source === 'gdacs');
    expect(tc).toBeDefined();
    expect(tc!.event_type).toBe('tropical_storm');
  });

  it('maps FL → source:gdacs_flood / event_type:flood', async () => {
    await scout.run();
    const fl = getPublished().find(e => e.source === 'gdacs_flood');
    expect(fl).toBeDefined();
    expect(fl!.event_type).toBe('flood');
  });

  it('maps DR → source:gdacs_drought / event_type:drought', async () => {
    await scout.run();
    const dr = getPublished().find(e => e.source === 'gdacs_drought');
    expect(dr).toBeDefined();
    expect(dr!.event_type).toBe('drought');
  });

  it('maps VO (orange) → source:gdacs_volcano / event_type:volcanic_eruption', async () => {
    await scout.run();
    const vo = getPublished().find(e => e.source === 'gdacs_volcano');
    expect(vo).toBeDefined();
    expect(vo!.event_type).toBe('volcanic_eruption');
  });

  // ── Coordinates ──────────────────────────────────────────────────────────

  it('parses georss:point as lat-first (opposite of GeoJSON)', async () => {
    await scout.run();
    // TC fixture: georss:point = "16.0 144.9" → lat=16, lng=144.9
    const tc = getPublished().find(e => e.source === 'gdacs');
    expect(tc!.coordinates.lat).toBeCloseTo(16.0, 3);
    expect(tc!.coordinates.lng).toBeCloseTo(144.9, 3);
  });

  it('parses negative latitude correctly (Merapi VO at -7.54 N)', async () => {
    await scout.run();
    const vo = getPublished().find(e => e.source === 'gdacs_volcano');
    expect(vo!.coordinates.lat).toBeCloseTo(-7.54, 3);
    expect(vo!.coordinates.lng).toBeCloseTo(110.44, 3);
  });

  // ── Severity normalization ────────────────────────────────────────────────

  it('normalizes TC severity from wind speed against Cat 5 threshold (254 km/h)', async () => {
    await scout.run();
    // Fixture TC: 287.04 km/h → min(287.04/254, 1.0) = 1.0
    const tc = getPublished().find(e => e.source === 'gdacs');
    expect(tc!.severity).toBeCloseTo(Math.min(287.04 / 254, 1.0), 3);
  });

  it('normalizes FL severity from alertscore / 3', async () => {
    await scout.run();
    // Fixture FL: alertscore=1.8 → 1.8/3 = 0.6
    const fl = getPublished().find(e => e.source === 'gdacs_flood');
    expect(fl!.severity).toBeCloseTo(1.8 / 3, 3);
  });

  it('normalizes DR severity from alertscore / 3', async () => {
    await scout.run();
    // Fixture DR: alertscore=1 → 1/3 ≈ 0.333
    const dr = getPublished().find(e => e.source === 'gdacs_drought');
    expect(dr!.severity).toBeCloseTo(1 / 3, 3);
  });

  it('normalizes VO severity from alertscore / 3', async () => {
    await scout.run();
    // Fixture VO-Orange: alertscore=2.1 → 2.1/3 = 0.7
    const vo = getPublished().find(e => e.source === 'gdacs_volcano');
    expect(vo!.severity).toBeCloseTo(2.1 / 3, 3);
  });

  it('TC falls back to alertlevel severity when wind speed is missing', async () => {
    const noWind = `<?xml version="1.0"?><rss version="2.0"
      xmlns:gdacs="http://www.gdacs.org"
      xmlns:georss="http://www.georss.org/georss">
      <channel><item>
        <gdacs:eventtype>TC</gdacs:eventtype>
        <gdacs:alertlevel>Orange</gdacs:alertlevel>
        <gdacs:alertscore>0</gdacs:alertscore>
        <gdacs:eventid>9001</gdacs:eventid>
        <gdacs:episodeid>1</gdacs:episodeid>
        <georss:point>12.0 108.0</georss:point>
        <gdacs:fromdate>Wed, 15 Apr 2026 00:00:00 GMT</gdacs:fromdate>
      </item></channel></rss>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => noWind }));
    await scout.run();

    const events = getPublished();
    // alertscore=0, no wind → fallback LEVEL_SEVERITY['orange'] = 0.60
    expect(events[0]!.severity).toBe(0.60);
  });

  // ── Filtering ────────────────────────────────────────────────────────────

  it('filters VO Green items (volcanic unrest — not an eruption)', async () => {
    await scout.run();
    const volcanoes = getPublished().filter(e => e.source === 'gdacs_volcano');
    expect(volcanoes).toHaveLength(1);
    expect(volcanoes[0]!.raw_data['alert_level']).toBe('Orange');
  });

  it('includes DR Green items (all alert levels are valid for drought)', async () => {
    await scout.run();
    const droughts = getPublished().filter(e => e.source === 'gdacs_drought');
    expect(droughts).toHaveLength(1);
    expect(droughts[0]!.raw_data['alert_level']).toBe('Green');
  });

  // ── Event IDs ────────────────────────────────────────────────────────────

  it('generates event IDs with correct type-specific prefixes', async () => {
    await scout.run();
    const events = getPublished();
    expect(events.find(e => e.source === 'gdacs')!.id).toMatch(/^gdacs_\d+_ep\d+$/);
    expect(events.find(e => e.source === 'gdacs_flood')!.id).toMatch(/^gdacs_fl_\d+_ep\d+$/);
    expect(events.find(e => e.source === 'gdacs_drought')!.id).toMatch(/^gdacs_dr_\d+_ep\d+$/);
    expect(events.find(e => e.source === 'gdacs_volcano')!.id).toMatch(/^gdacs_vo_\d+_ep\d+$/);
  });

  // ── Dedup & edge cases ───────────────────────────────────────────────────

  it('deduplicates events already seen in Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue('1'); // all items already seen
    await scout.run();
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('publishes nothing when RSS feed has no items', async () => {
    const emptyRss = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => emptyRss }));
    await scout.run();
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('skips items with missing or malformed georss:point', async () => {
    const badCoords = `<?xml version="1.0"?><rss version="2.0"
      xmlns:gdacs="http://www.gdacs.org"
      xmlns:georss="http://www.georss.org/georss">
      <channel><item>
        <gdacs:eventtype>FL</gdacs:eventtype>
        <gdacs:alertlevel>Orange</gdacs:alertlevel>
        <gdacs:alertscore>2</gdacs:alertscore>
        <gdacs:eventid>9002</gdacs:eventid>
        <gdacs:episodeid>1</gdacs:episodeid>
        <georss:point>not-a-number xyz</georss:point>
        <gdacs:fromdate>Wed, 15 Apr 2026 00:00:00 GMT</gdacs:fromdate>
      </item></channel></rss>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => badCoords }));
    await scout.run();
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('opens circuit breaker after 5 consecutive fetch failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    // Drive 5 failures
    vi.mocked(redis.incr).mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5);

    for (let i = 0; i < 5; i++) await scout.run();

    // 5th failure triggers setex for circuit:open_until:gdacs
    const openUntilCall = vi.mocked(redis.setex).mock.calls.find(
      (c) => (c[0] as string).startsWith('circuit:open_until:gdacs')
    );
    expect(openUntilCall).toBeDefined();
  });
});
