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
  readFileSync(join(__dirname, '../fixtures/gfw-integrated-alerts-response.json'), 'utf8')
);

import { GladDeforestationScout } from '../../src/scouts/GladDeforestationScout.js';
import { redis } from '../../src/redis/client.js';

describe('GladDeforestationScout', () => {
  let scout: GladDeforestationScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new GladDeforestationScout();

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

  it('publishes one event per unique (iso, adm1, date) — BRA adm1=22 two rows → one event', async () => {
    await scout.run();
    // Fixture: BRA/22/2026-04-12 (2 rows, aggregated), COD/2/2026-04-12, IDN/13/2026-04-11 → 3 events
    expect(redis.xadd).toHaveBeenCalledTimes(3);
  });

  it('sets source to glad_deforestation and event_type to deforestation', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { source: string; event_type: string }
    );

    for (const event of published) {
      expect(event.source).toBe('glad_deforestation');
      expect(event.event_type).toBe('deforestation');
    }
  });

  it('aggregates two BRA/22 rows: escalates to highest confidence, severity=0.95', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        severity: number;
        raw_data: { iso_code: string; adm1_code: number; confidence: string; alert_count: number }
      }
    );

    const bra22 = published.find(e =>
      e.raw_data.iso_code === 'BRA' && e.raw_data.adm1_code === 22
    );
    expect(bra22).toBeDefined();
    expect(bra22!.severity).toBe(0.95);                      // 'highest' escalated
    expect(bra22!.raw_data.confidence).toBe('highest');
    expect(bra22!.raw_data.alert_count).toBe(2772 + 289);    // summed
  });

  it('resolves BRA adm1=22 to Rondônia centroid (lat=-11.5, lng=-63.5)', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        coordinates: { lat: number; lng: number };
        raw_data: { iso_code: string; adm1_code: number; region_name: string }
      }
    );

    const bra22 = published.find(e =>
      e.raw_data.iso_code === 'BRA' && e.raw_data.adm1_code === 22
    );
    expect(bra22).toBeDefined();
    expect(bra22!.coordinates.lat).toBe(-11.5);
    expect(bra22!.coordinates.lng).toBe(-63.5);
    expect(bra22!.raw_data.region_name).toBe('Rondônia');
  });

  it('resolves COD adm1=2 to Équateur centroid (lat=0.5, lng=22.0)', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        coordinates: { lat: number; lng: number };
        raw_data: { iso_code: string; adm1_code: number }
      }
    );

    const cod2 = published.find(e =>
      e.raw_data.iso_code === 'COD' && e.raw_data.adm1_code === 2
    );
    expect(cod2).toBeDefined();
    expect(cod2!.coordinates.lat).toBe(0.5);
    expect(cod2!.coordinates.lng).toBe(22.0);
  });

  it('formats event ID as glad_{ISO}_{adm1}_{YYYYMMDD}', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as { id: string }
    );

    expect(published.some(e => e.id === 'glad_BRA_22_20260412')).toBe(true);
    expect(published.some(e => e.id === 'glad_COD_2_20260412')).toBe(true);
    expect(published.some(e => e.id === 'glad_IDN_13_20260411')).toBe(true);
  });

  it('sets severity=0.75 for high confidence (IDN Kalimantan Barat)', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        severity: number;
        raw_data: { iso_code: string; adm1_code: number }
      }
    );

    const idn13 = published.find(e =>
      e.raw_data.iso_code === 'IDN' && e.raw_data.adm1_code === 13
    );
    expect(idn13).toBeDefined();
    expect(idn13!.severity).toBe(0.75);
  });

  it('includes alert_count, alert_area_ha, and data_source in raw_data', async () => {
    await scout.run();

    const published = vi.mocked(redis.xadd).mock.calls.map(call =>
      JSON.parse(call[3] as string) as {
        raw_data: {
          alert_count: number;
          alert_area_ha: number;
          data_source: string;
        }
      }
    );

    const first = published[0]!;
    expect(typeof first.raw_data.alert_count).toBe('number');
    expect(typeof first.raw_data.alert_area_ha).toBe('number');
    expect(first.raw_data.data_source).toContain('GFW');
  });

  it('publishes nothing when API returns empty data array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], status: 'success' }),
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('deduplicates already-seen events via Redis', async () => {
    vi.mocked(redis.get).mockResolvedValue('1');

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it('silently skips rows for countries not in gladRegions lookup', async () => {
    const unknownCountry = {
      data: [
        {
          iso: 'XYZ',
          adm1: 5,
          gfw_integrated_alerts__date: '2026-04-12',
          gfw_integrated_alerts__confidence: 'high',
          alert__count: 200,
          alert_area__ha: 10.0,
        },
      ],
      status: 'success',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => unknownCountry,
    }));

    await scout.run();

    expect(redis.xadd).not.toHaveBeenCalled();
  });
});
