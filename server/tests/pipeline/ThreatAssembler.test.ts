import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  hset: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  hgetall: vi.fn(),
  xadd: vi.fn().mockResolvedValue('1234-0'),
  del: vi.fn().mockResolvedValue(1),
  set: vi.fn().mockResolvedValue('OK'), // claim lock: 'OK' = claimed, null = already taken
}));

vi.mock('../../src/redis/client.js', () => ({ redis: mockRedis }));
vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: { ASSESSED: 'alerts:assessed' },
}));
vi.mock('../../src/discord/warRoom.js', () => ({
  logToWarRoom: vi.fn().mockResolvedValue(undefined),
}));

import {
  storeEventForAssembly,
  storeHabitatResult,
  storeSpeciesResult,
  type HabitatAssemblyResult,
  type SpeciesAssemblyResult,
} from '../../src/pipeline/ThreatAssembler.js';
import { logToWarRoom } from '../../src/discord/warRoom.js';
import type { EnrichedDisasterEvent } from '@wildlife-sentinel/shared/types';

const BASE_EVENT: EnrichedDisasterEvent = {
  id: 'event-1',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: -3.42, lng: 104.21 },
  severity: 0.8,
  timestamp: '2026-03-31T10:00:00.000Z',
  raw_data: {},
  wind_direction: 270,
  wind_speed: 15,
  precipitation_probability: 0.1,
  nearby_habitat_ids: ['habitat-1'],
  species_at_risk: ['Pongo abelii'],
  habitat_distance_km: 18.3,
  weather_summary: 'Dry and windy conditions.',
};

const HABITAT_RESULT: HabitatAssemblyResult = {
  gbif_recent_sightings: [],
  sighting_confidence: 'confirmed',
  most_recent_sighting: '2026-01-15',
};

const SPECIES_RESULT: SpeciesAssemblyResult = {
  species_briefs: [],
};

describe('storeEventForAssembly', () => {
  beforeEach(() => vi.resetAllMocks());

  it('stores the event as JSON in the assembly hash', async () => {
    await storeEventForAssembly('event-1', BASE_EVENT);

    expect(mockRedis.hset).toHaveBeenCalledWith(
      'assembly:event-1',
      'event',
      JSON.stringify(BASE_EVENT)
    );
  });

  it('sets TTL of 86400s on the assembly hash', async () => {
    await storeEventForAssembly('event-1', BASE_EVENT);

    expect(mockRedis.expire).toHaveBeenCalledWith('assembly:event-1', 86_400);
  });
});

describe('partial assembly', () => {
  beforeEach(() => vi.resetAllMocks());

  it('does not publish when only event + habitat are stored', async () => {
    // hgetall returns hash with event + habitat but no species
    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      habitat: JSON.stringify(HABITAT_RESULT),
    });

    await storeHabitatResult('event-1', HABITAT_RESULT);

    expect(mockRedis.xadd).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('does not publish when only event + species are stored', async () => {
    // hgetall returns hash with event + species but no habitat
    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      species: JSON.stringify(SPECIES_RESULT),
    });

    await storeSpeciesResult('event-1', SPECIES_RESULT);

    expect(mockRedis.xadd).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('does not publish and emits a warning when habitat+species present but event missing', async () => {
    // This is the specific failure mode: old backlog event processed without
    // storeEventForAssembly being called. Both downstream agents stored their
    // results, but the event field was never written.
    mockRedis.hgetall.mockResolvedValueOnce({
      habitat: JSON.stringify(HABITAT_RESULT),
      species: JSON.stringify(SPECIES_RESULT),
    });

    await storeSpeciesResult('event-orphan', SPECIES_RESULT);

    expect(mockRedis.xadd).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(vi.mocked(logToWarRoom)).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'assembler',
        level: 'warning',
        detail: expect.stringContaining('event-orphan'),
      })
    );
  });

  it('does NOT warn for normal partial state — event+habitat present, species pending', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      habitat: JSON.stringify(HABITAT_RESULT),
    });

    await storeHabitatResult('event-1', HABITAT_RESULT);

    expect(vi.mocked(logToWarRoom)).not.toHaveBeenCalled();
  });
});

describe('full assembly — species arrives last', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedis.set.mockResolvedValue('OK');
  });

  it('publishes FullyEnrichedEvent to alerts:assessed when all three parts present', async () => {
    // storeHabitatResult → tryAssemble → partial (no species yet)
    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      habitat: JSON.stringify(HABITAT_RESULT),
    });

    await storeHabitatResult('event-1', HABITAT_RESULT);
    expect(mockRedis.xadd).not.toHaveBeenCalled();

    // storeSpeciesResult → tryAssemble → all three present
    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      habitat: JSON.stringify(HABITAT_RESULT),
      species: JSON.stringify(SPECIES_RESULT),
    });

    await storeSpeciesResult('event-1', SPECIES_RESULT);

    expect(mockRedis.xadd).toHaveBeenCalledOnce();
    expect(mockRedis.xadd).toHaveBeenCalledWith(
      'alerts:assessed',
      '*',
      'data',
      expect.stringContaining('"id":"event-1"')
    );
  });

  it('deletes the assembly hash after publishing', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      habitat: JSON.stringify(HABITAT_RESULT),
      species: JSON.stringify(SPECIES_RESULT),
    });

    await storeSpeciesResult('event-1', SPECIES_RESULT);

    expect(mockRedis.del).toHaveBeenCalledWith('assembly:event-1');
  });

  it('merges habitat and species fields into the published event', async () => {
    const habitatWithSighting: HabitatAssemblyResult = {
      gbif_recent_sightings: [{ speciesName: 'Pongo abelii', decimalLatitude: -3.0, decimalLongitude: 104.0, eventDate: '2026-01-15', datasetName: 'GBIF Backbone Taxonomy', occurrenceID: 'occ-001' }],
      sighting_confidence: 'confirmed',
      most_recent_sighting: '2026-01-15',
    };

    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      habitat: JSON.stringify(habitatWithSighting),
      species: JSON.stringify(SPECIES_RESULT),
    });

    await storeSpeciesResult('event-1', SPECIES_RESULT);

    const publishedPayload = JSON.parse(
      (mockRedis.xadd.mock.calls[0] as string[])[3] as string
    ) as Record<string, unknown>;

    expect(publishedPayload['sighting_confidence']).toBe('confirmed');
    expect(publishedPayload['most_recent_sighting']).toBe('2026-01-15');
    expect((publishedPayload['gbif_recent_sightings'] as unknown[]).length).toBe(1);
  });
});

describe('full assembly — habitat arrives last', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedis.set.mockResolvedValue('OK');
  });

  it('publishes when habitat is the final piece to arrive', async () => {
    // species stored first — partial
    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      species: JSON.stringify(SPECIES_RESULT),
    });

    await storeSpeciesResult('event-1', SPECIES_RESULT);
    expect(mockRedis.xadd).not.toHaveBeenCalled();

    // habitat arrives — triggers assembly with all three
    mockRedis.hgetall.mockResolvedValueOnce({
      event: JSON.stringify(BASE_EVENT),
      habitat: JSON.stringify(HABITAT_RESULT),
      species: JSON.stringify(SPECIES_RESULT),
    });

    await storeHabitatResult('event-1', HABITAT_RESULT);

    expect(mockRedis.xadd).toHaveBeenCalledOnce();
    expect(mockRedis.del).toHaveBeenCalledWith('assembly:event-1');
  });
});

describe('race condition — concurrent habitat+species arrival', () => {
  beforeEach(() => vi.resetAllMocks());

  it('publishes exactly once when the claim lock is taken on the second concurrent call', async () => {
    const fullHash = {
      event: JSON.stringify(BASE_EVENT),
      habitat: JSON.stringify(HABITAT_RESULT),
      species: JSON.stringify(SPECIES_RESULT),
    };

    // Both concurrent calls see a complete hash
    mockRedis.hgetall.mockResolvedValue(fullHash);

    // First call wins the SETNX lock ('OK'), second call loses (null)
    mockRedis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await Promise.all([
      storeHabitatResult('event-race', HABITAT_RESULT),
      storeSpeciesResult('event-race', SPECIES_RESULT),
    ]);

    expect(mockRedis.xadd).toHaveBeenCalledOnce();
  });
});
