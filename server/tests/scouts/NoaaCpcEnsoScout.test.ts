import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Mock the JSON require() inside the scout using vi.mock for the module
vi.mock('../../src/scouts/ensoImpactZones.json', () => ({
  default: {
    el_nino: [
      { id: 'galapagos',     lat: -0.62, lng: -90.42, ecosystem: 'Marine food web', key_species: ['Galápagos penguin'] },
      { id: 'borneo_sumatra', lat:  0.5,  lng: 113.0,  ecosystem: 'Tropical peat',   key_species: ['Bornean orangutan'] },
      { id: 'peruvian_amazon', lat: -5.0, lng: -75.0,  ecosystem: 'Amazon floodplain', key_species: ['Amazon river dolphin'] },
      { id: 'east_africa',    lat: -2.5,  lng: 37.0,   ecosystem: 'Savanna',          key_species: ['African elephant'] },
      { id: 'great_barrier_reef', lat: -18.0, lng: 147.5, ecosystem: 'Coral reef',   key_species: ['dugong'] },
    ],
    la_nina: [
      { id: 'southern_africa',       lat: -18.0, lng: 30.0,  ecosystem: 'Southern savanna', key_species: ['black rhino'] },
      { id: 'philippine_archipelago', lat:  12.0, lng: 122.0, ecosystem: 'Philippine forest', key_species: ['Philippine eagle'] },
      { id: 'eastern_australia',      lat: -17.0, lng: 145.5, ecosystem: 'QLD rainforest',    key_species: ['cassowary'] },
      { id: 'amazon_colombia',        lat:   2.0, lng: -67.0, ecosystem: 'N. Amazon',         key_species: ['boto dolphin'] },
      { id: 'mekong_basin',           lat:  14.0, lng: 105.0, ecosystem: 'Mekong floodplain', key_species: ['Irrawaddy dolphin'] },
    ],
  },
}));

import { NoaaCpcEnsoScout } from '../../src/scouts/NoaaCpcEnsoScout.js';
import { redis } from '../../src/redis/client.js';

// Helper to build a minimal ONI ASCII fixture (4-column format matching real NOAA CPC file)
function oniCsv(anom: number): string {
  return [
    'SEAS  YR   TOTAL   ANOM',
    `DJF  2025  24.83  -1.31`,
    `JFM  2025  25.11  -0.99`,
    `FMA  2026  27.50  ${anom.toFixed(2)}`,
  ].join('\n');
}

function mockFetch(text: string, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, text: async () => text }));
}

describe('NoaaCpcEnsoScout', () => {
  let scout: NoaaCpcEnsoScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new NoaaCpcEnsoScout();
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.setex).mockResolvedValue('OK');
    vi.mocked(redis.del).mockResolvedValue(1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Phase & fan-out ────────────────────────────────────────────────────────

  it('generates 5 zone events for El Niño advisory (ONI +1.2)', async () => {
    mockFetch(oniCsv(1.2));
    await scout.run();
    expect(redis.xadd).toHaveBeenCalledTimes(5);
  });

  it('generates 5 zone events for La Niña warning (ONI -1.6)', async () => {
    mockFetch(oniCsv(-1.6));
    await scout.run();
    expect(redis.xadd).toHaveBeenCalledTimes(5);
  });

  it('generates no events for neutral (ONI +0.3)', async () => {
    mockFetch(oniCsv(0.3));
    await scout.run();
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('sets source to noaa_cpc and event_type to climate_anomaly', async () => {
    mockFetch(oniCsv(1.2));
    await scout.run();
    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.source).toBe('noaa_cpc');
    expect(event.event_type).toBe('climate_anomaly');
  });

  // ── Severity ──────────────────────────────────────────────────────────────

  it('assigns severity 0.35 for watch tier (ONI +0.6)', async () => {
    mockFetch(oniCsv(0.6));
    await scout.run();
    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.severity).toBe(0.35);
  });

  it('assigns severity 0.55 for advisory tier (ONI +1.2)', async () => {
    mockFetch(oniCsv(1.2));
    await scout.run();
    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.severity).toBe(0.55);
  });

  it('assigns severity 0.75 for warning tier (ONI +1.6)', async () => {
    mockFetch(oniCsv(1.6));
    await scout.run();
    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.severity).toBe(0.75);
  });

  it('assigns severity 0.95 for extreme tier (ONI +2.3)', async () => {
    mockFetch(oniCsv(2.3));
    await scout.run();
    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.severity).toBe(0.95);
  });

  // ── Event ID format ────────────────────────────────────────────────────────

  it('event IDs follow enso_{phase}_{tier}_{zone}_{YYYYMM} pattern', async () => {
    mockFetch(oniCsv(1.2));
    await scout.run();
    const event = JSON.parse(vi.mocked(redis.xadd).mock.calls[0]![3] as string);
    expect(event.id).toMatch(/^enso_el_nino_advisory_\w+_\d{6}$/);
  });

  it('all 5 zone events have unique IDs', async () => {
    mockFetch(oniCsv(1.2));
    await scout.run();
    const ids = vi.mocked(redis.xadd).mock.calls.map(c =>
      (JSON.parse(c[3] as string) as { id: string }).id
    );
    expect(new Set(ids).size).toBe(5);
  });

  // ── Redis modifier keys ────────────────────────────────────────────────────

  it('sets enso:current_phase to el_nino on active El Niño', async () => {
    mockFetch(oniCsv(1.2));
    await scout.run();
    expect(redis.setex).toHaveBeenCalledWith(
      'enso:current_phase',
      expect.any(Number),
      'el_nino'
    );
  });

  it('sets enso:oni_anomaly to the ONI value string', async () => {
    mockFetch(oniCsv(1.2));
    await scout.run();
    expect(redis.setex).toHaveBeenCalledWith(
      'enso:oni_anomaly',
      expect.any(Number),
      '1.20'
    );
  });

  it('deletes modifier keys on neutral phase', async () => {
    mockFetch(oniCsv(0.3));
    await scout.run();
    expect(redis.del).toHaveBeenCalledWith('enso:current_phase');
    expect(redis.del).toHaveBeenCalledWith('enso:oni_anomaly');
  });

  // ── Dedup ──────────────────────────────────────────────────────────────────

  it('skips already-seen zone events (dedup)', async () => {
    // All dedup checks return '1' → all 5 zones are already seen
    vi.mocked(redis.get).mockResolvedValue('1');
    mockFetch(oniCsv(1.2));
    await scout.run();
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  // ── Parse robustness ───────────────────────────────────────────────────────

  it('returns no events when CSV is empty', async () => {
    mockFetch('# no data\n');
    await scout.run();
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('uses the last row when multiple data rows are present', async () => {
    // Last row is neutral — should produce no events
    const csv = [
      'SEAS  YR   TOTAL   ANOM',
      'DJF  2025  24.83  1.20',   // El Niño advisory
      'JFM  2026  25.11  0.10',   // neutral (most recent)
    ].join('\n');
    mockFetch(csv);
    await scout.run();
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  // ── Circuit breaker ────────────────────────────────────────────────────────

  it('trips circuit breaker after 3 consecutive fetch failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    vi.mocked(redis.incr).mockResolvedValue(3);
    await scout.run();
    expect(redis.incr).toHaveBeenCalled();
    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining('circuit:open_until:noaa_cpc'),
      expect.any(Number),
      expect.any(String)
    );
  });
});
