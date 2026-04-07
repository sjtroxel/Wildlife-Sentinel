import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const weatherFixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/open-meteo-response.json'), 'utf8')
);

// vi.hoisted ensures mockSql is available at vi.mock() hoist time
const mockSql = vi.hoisted(() => vi.fn());

vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xadd: vi.fn().mockResolvedValue('1234-0'),
    xreadgroup: vi.fn(),
    xack: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: {
    RAW: 'disaster:raw',
    ENRICHED: 'disaster:enriched',
  },
  CONSUMER_GROUPS: { ENRICHMENT: 'enrichment-group' },
  ensureConsumerGroup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/pipelineEvents.js', () => ({
  logPipelineEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/pipeline/ThreatAssembler.js', () => ({
  storeEventForAssembly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn().mockResolvedValue({
      content: 'Wind: 18.5 km/h from W. Precipitation: 5%.',
      model: 'gemini-2.5-flash-lite',
      inputTokens: 50,
      outputTokens: 20,
      estimatedCostUsd: 0,
    }),
    embed: vi.fn(),
  },
}));

import { redis } from '../../src/redis/client.js';
import { logPipelineEvent } from '../../src/db/pipelineEvents.js';
import { storeEventForAssembly } from '../../src/pipeline/ThreatAssembler.js';
import { processEvent, startEnrichmentAgent } from '../../src/agents/EnrichmentAgent.js';
import { modelRouter } from '../../src/router/ModelRouter.js';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';

const nearSumatraEvent: RawDisasterEvent = {
  id: 'test-event-001',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: 3.5, lng: 97.0 },
  severity: 0.0873,
  timestamp: new Date().toISOString(),
  raw_data: { frp: 87.3, confidence: 'n' },
};

const remoteOceanEvent: RawDisasterEvent = {
  id: 'test-event-002',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: -30.0, lng: 0.0 },
  severity: 0.05,
  timestamp: new Date().toISOString(),
  raw_data: { frp: 50.0, confidence: 'n' },
};

describe('EnrichmentAgent.processEvent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops event with no habitat overlap and logs filtered status', async () => {
    mockSql.mockResolvedValueOnce([]); // PostGIS returns empty

    await processEvent(remoteOceanEvent);

    expect(redis.xadd).not.toHaveBeenCalled();
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'filtered', reason: 'no_habitat_overlap' })
    );
  });

  it('publishes to disaster:enriched when habitat overlap found', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'habitat-uuid-1',
      species_name: 'Pongo abelii',
      iucn_status: 'CR',
      distance_km: 18.3,
    }]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));

    await processEvent(nearSumatraEvent);

    expect(redis.xadd).toHaveBeenCalledWith(
      'disaster:enriched',
      '*',
      'data',
      expect.stringContaining('Pongo abelii')
    );
  });

  it('includes correct species_at_risk and habitat_distance_km in enriched event', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'habitat-uuid-1',
      species_name: 'Pongo abelii',
      iucn_status: 'CR',
      distance_km: 18.3,
    }]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));

    await processEvent(nearSumatraEvent);

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { species_at_risk: string[]; habitat_distance_km: number };

    expect(payload.species_at_risk).toContain('Pongo abelii');
    expect(payload.habitat_distance_km).toBeCloseTo(18.3, 1);
  });

  it('builds correct weather_summary from Open-Meteo hourly[0]', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'habitat-uuid-1',
      species_name: 'Pongo abelii',
      iucn_status: 'CR',
      distance_km: 18.3,
    }]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));

    await processEvent(nearSumatraEvent);

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { weather_summary: string };

    // fixture: wind_speed[0]=18.5, wind_direction[0]=270°→W, precipitation[0]=5%
    expect(payload.weather_summary).toMatch(/18\.5 km\/h from W/);
    expect(payload.weather_summary).toMatch(/Precipitation: 5%/);
  });

  it('logs published status after successful enrichment', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'habitat-uuid-1',
      species_name: 'Pongo abelii',
      iucn_status: 'CR',
      distance_km: 18.3,
    }]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));

    await processEvent(nearSumatraEvent);

    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published', stage: 'enriched' })
    );
  });

  it('throws when Open-Meteo returns non-OK status', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'habitat-uuid-1',
      species_name: 'Pongo abelii',
      iucn_status: 'CR',
      distance_km: 18.3,
    }]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    }));

    // The outer loop in production catches this and logs it — here we verify the throw
    await expect(processEvent(nearSumatraEvent)).rejects.toThrow('Open-Meteo 503');
  });

  it('calls storeEventForAssembly after publishing to disaster:enriched', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'habitat-uuid-1',
      species_name: 'Pongo abelii',
      iucn_status: 'CR',
      distance_km: 18.3,
    }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));

    await processEvent(nearSumatraEvent);

    expect(storeEventForAssembly).toHaveBeenCalledWith(
      'test-event-001',
      expect.objectContaining({ species_at_risk: ['Pongo abelii'] })
    );
  });

  it('aggregates unique species from multiple habitat matches, uses nearest distance', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'h-1', species_name: 'Pongo abelii', iucn_status: 'CR', distance_km: 12.0 },
      { id: 'h-2', species_name: 'Panthera tigris sumatrae', iucn_status: 'CR', distance_km: 25.5 },
      { id: 'h-3', species_name: 'Pongo abelii', iucn_status: 'CR', distance_km: 30.0 }, // duplicate
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));

    await processEvent(nearSumatraEvent);

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { species_at_risk: string[]; habitat_distance_km: number };

    expect(payload.species_at_risk).toEqual(['Pongo abelii', 'Panthera tigris sumatrae']);
    expect(payload.habitat_distance_km).toBeCloseTo(12.0, 1);
  });

  it('weather summary LLM failure → uses fallback string, event still published', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'h-1', species_name: 'Pongo abelii', iucn_status: 'CR', distance_km: 18.3,
    }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));
    vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('LLM rate limit'));

    await processEvent(nearSumatraEvent);

    // Event still published — graceful degradation
    expect(redis.xadd).toHaveBeenCalledWith('disaster:enriched', '*', 'data', expect.any(String));
    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { weather_summary: string };
    // Fallback string contains wind/precip info from raw data
    expect(payload.weather_summary).toBeTruthy();
  });

  it('tropical_storm event → storm projection fields added to raw_data', async () => {
    const stormEvent: RawDisasterEvent = {
      id: 'storm-001',
      source: 'noaa_nhc',
      event_type: 'tropical_storm',
      coordinates: { lat: 20.0, lng: -70.0 },
      severity: 0.75,
      timestamp: new Date().toISOString(),
      raw_data: {
        movement_dir_deg: 315,  // NW
        movement_speed_knots: 10,
      },
    };
    mockSql.mockResolvedValueOnce([{
      id: 'h-1', species_name: 'Manatee', iucn_status: 'VU', distance_km: 30.0,
    }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));

    await processEvent(stormEvent);

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { raw_data: Record<string, unknown> };
    expect(payload.raw_data['projected_24h_lat']).toBeDefined();
    expect(payload.raw_data['projected_24h_lng']).toBeDefined();
    expect(payload.raw_data['projected_24h_distance_km']).toBeDefined();
  });

  it('non-storm event → no storm projection fields in raw_data', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'h-1', species_name: 'Pongo abelii', iucn_status: 'CR', distance_km: 18.3,
    }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));

    await processEvent(nearSumatraEvent);

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]![3] as string
    ) as { raw_data: Record<string, unknown> };
    expect(payload.raw_data['projected_24h_lat']).toBeUndefined();
  });
});

// ── startEnrichmentAgent loop tests ──────────────────────────────────────────

function makeRawXreadgroupPayload(event: RawDisasterEvent, msgId = 'raw-msg-001') {
  return [['disaster:raw', [[msgId, ['data', JSON.stringify(event)]]]]];
}

async function runEnrichmentIteration(event = nearSumatraEvent, msgId = 'raw-msg-001') {
  vi.mocked(redis.xreadgroup)
    .mockResolvedValueOnce(makeRawXreadgroupPayload(event, msgId))
    .mockRejectedValueOnce(new Error('stop'));
  await expect(startEnrichmentAgent()).rejects.toThrow('stop');
}

describe('startEnrichmentAgent loop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.xack).mockResolvedValue(1);
    vi.mocked(storeEventForAssembly).mockResolvedValue(undefined);
    vi.mocked(modelRouter.complete).mockResolvedValue({
      content: 'Wind: 18.5 km/h from W. Low precipitation probability.',
      model: 'gemini-2.5-flash-lite',
      inputTokens: 50,
      outputTokens: 20,
      estimatedCostUsd: 0,
    });
    mockSql.mockResolvedValue([{
      id: 'h-1', species_name: 'Pongo abelii', iucn_status: 'CR', distance_km: 18.3,
    }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ACKs message after successful processEvent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => weatherFixture,
    }));
    await runEnrichmentIteration(nearSumatraEvent, 'raw-success-001');
    expect(redis.xack).toHaveBeenCalledWith('disaster:raw', 'enrichment-group', 'raw-success-001');
  });

  it('ACKs message even when processEvent throws — no message loss', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => 'error',
    }));
    await runEnrichmentIteration(nearSumatraEvent, 'raw-err-001');
    expect(redis.xack).toHaveBeenCalledWith('disaster:raw', 'enrichment-group', 'raw-err-001');
  });

  it('logs error status to pipeline_events when processEvent throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => 'Service Unavailable',
    }));
    await runEnrichmentIteration();
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'enrichment',
        status: 'error',
        reason: expect.stringContaining('503'),
      })
    );
  });

  it('skips null poll (empty queue) without ACKing', async () => {
    vi.mocked(redis.xreadgroup)
      .mockImplementationOnce(() => Promise.resolve(null))
      .mockRejectedValueOnce(new Error('stop'));
    await expect(startEnrichmentAgent()).rejects.toThrow('stop');
    expect(redis.xack).not.toHaveBeenCalled();
  });
});
