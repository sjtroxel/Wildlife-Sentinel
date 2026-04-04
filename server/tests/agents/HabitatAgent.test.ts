import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Fixtures loaded at module scope (not inside vi.mock factories — avoids hoist issues)
const habitatFixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/llm/habitat-output.json'), 'utf8')
) as { sighting_confidence: string; most_recent_sighting: string | null; summary: string };

// vi.hoisted: these mock fns are referenced inside vi.mock factories, so must be hoisted
const { mockXreadgroup, mockXack, mockExists } = vi.hoisted(() => ({
  mockXreadgroup: vi.fn(),
  mockXack: vi.fn(),
  mockExists: vi.fn(),
}));

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xreadgroup: mockXreadgroup,
    xack: mockXack,
    exists: mockExists,
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: {
    RAW: 'disaster:raw',
    ENRICHED: 'disaster:enriched',
    ASSESSED: 'alerts:assessed',
    DISCORD: 'discord:queue',
  },
  CONSUMER_GROUPS: {
    ENRICHMENT: 'enrichment-group',
    HABITAT: 'habitat-group',
    SPECIES: 'species-group',
    THREAT: 'threat-group',
    SYNTHESIS: 'synthesis-group',
    DISCORD: 'discord-group',
  },
  ensureConsumerGroup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/pipelineEvents.js', () => ({
  logPipelineEvent: vi.fn(),
}));

vi.mock('../../src/scouts/gbif.js', () => ({
  fetchRecentSightings: vi.fn(),
}));

vi.mock('../../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn(),
    embed: vi.fn(),
  },
}));

vi.mock('../../src/pipeline/ThreatAssembler.js', () => ({
  storeHabitatResult: vi.fn(),
}));

vi.mock('../../src/discord/warRoom.js', () => ({
  logToWarRoom: vi.fn(),
}));

import { startHabitatAgent } from '../../src/agents/HabitatAgent.js';
import { fetchRecentSightings } from '../../src/scouts/gbif.js';
import { storeHabitatResult } from '../../src/pipeline/ThreatAssembler.js';
import { logPipelineEvent } from '../../src/db/pipelineEvents.js';
import { logToWarRoom } from '../../src/discord/warRoom.js';
import { modelRouter } from '../../src/router/ModelRouter.js';
import type { EnrichedDisasterEvent, GBIFSighting } from '@wildlife-sentinel/shared/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseEnrichedEvent: EnrichedDisasterEvent = {
  id: 'test-enriched-001',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: 3.5, lng: 97.0 },
  severity: 0.87,
  timestamp: '2026-01-15T08:00:00Z',
  raw_data: { frp: 87.3, confidence: 'n' },
  wind_direction: 270,
  wind_speed: 18.5,
  precipitation_probability: 5,
  weather_summary: 'Wind: 18.5 km/h from W. Low precipitation probability.',
  nearby_habitat_ids: ['habitat-uuid-1'],
  species_at_risk: ['Pongo abelii'],
  habitat_distance_km: 18.3,
};

const gbifSighting: GBIFSighting = {
  speciesName: 'Pongo abelii',
  decimalLatitude: 3.6,
  decimalLongitude: 97.1,
  eventDate: '2026-01-15',
  datasetName: 'GBIF Backbone Taxonomy',
  occurrenceID: 'occ-001',
};

const mockRouterResponse = {
  content: JSON.stringify(habitatFixture),
  model: 'gemini-2.5-flash-lite',
  inputTokens: 80,
  outputTokens: 40,
  estimatedCostUsd: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeXreadgroupPayload(event: EnrichedDisasterEvent, msgId = 'msg-001') {
  return [['disaster:enriched', [[msgId, ['data', JSON.stringify(event)]]]]];
}

async function runOneIteration(event = baseEnrichedEvent, msgId = 'msg-001') {
  mockXreadgroup
    .mockResolvedValueOnce(makeXreadgroupPayload(event, msgId))
    .mockRejectedValueOnce(new Error('stop'));
  await expect(startHabitatAgent()).rejects.toThrow('stop');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HabitatAgent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockXack.mockResolvedValue(1);
    mockExists.mockResolvedValue(1); // assembly hash exists by default
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(logToWarRoom).mockResolvedValue(undefined);
    vi.mocked(storeHabitatResult).mockResolvedValue(undefined);
    vi.mocked(fetchRecentSightings).mockResolvedValue([]);
    vi.mocked(modelRouter.complete).mockResolvedValue(mockRouterResponse);
  });

  describe('stream consumption', () => {
    it('calls ensureConsumerGroup for the habitat consumer group', async () => {
      const { ensureConsumerGroup } = await import('../../src/pipeline/streams.js');
      mockXreadgroup
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('stop'));
      await expect(startHabitatAgent()).rejects.toThrow('stop');
      expect(ensureConsumerGroup).toHaveBeenCalledWith('disaster:enriched', 'habitat-group');
    });

    it('skips empty poll without calling storeHabitatResult or XACK', async () => {
      mockXreadgroup
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('stop'));
      await expect(startHabitatAgent()).rejects.toThrow('stop');
      expect(storeHabitatResult).not.toHaveBeenCalled();
      expect(mockXack).not.toHaveBeenCalled();
    });

    it('skips event and does not call storeHabitatResult when assembly hash is absent', async () => {
      mockExists.mockResolvedValueOnce(0); // no assembly hash — old backlog event
      await runOneIteration();
      expect(storeHabitatResult).not.toHaveBeenCalled();
      expect(fetchRecentSightings).not.toHaveBeenCalled();
    });

    it('ACKs the message with correct stream/group/id after successful processing', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      await runOneIteration(baseEnrichedEvent, 'msg-ack-test');
      expect(mockXack).toHaveBeenCalledWith('disaster:enriched', 'habitat-group', 'msg-ack-test');
    });

    it('ACKs the message even when processEvent throws an error — no message loss', async () => {
      vi.mocked(fetchRecentSightings).mockRejectedValueOnce(new Error('GBIF network failure'));
      await runOneIteration(baseEnrichedEvent, 'msg-err-001');
      expect(mockXack).toHaveBeenCalledWith('disaster:enriched', 'habitat-group', 'msg-err-001');
    });

    it('posts error to war room when processEvent throws', async () => {
      vi.mocked(fetchRecentSightings).mockRejectedValueOnce(new Error('GBIF network failure'));
      await runOneIteration();
      expect(logToWarRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'habitat',
          action: 'ERROR',
          level: 'warning',
          detail: expect.stringContaining('GBIF network failure'),
        })
      );
    });

    it('logs error status to pipeline_events when processEvent throws', async () => {
      vi.mocked(fetchRecentSightings).mockRejectedValueOnce(new Error('GBIF network failure'));
      await runOneIteration();
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'test-enriched-001',
          stage: 'habitat',
          status: 'error',
          reason: expect.stringContaining('GBIF network failure'),
        })
      );
    });
  });

  describe('GBIF sighting collection', () => {
    it('calls fetchRecentSightings once per species at risk', async () => {
      const multiSpeciesEvent: EnrichedDisasterEvent = {
        ...baseEnrichedEvent,
        species_at_risk: ['Pongo abelii', 'Panthera tigris sumatrae', 'Dicerorhinus sumatrensis'],
      };
      await runOneIteration(multiSpeciesEvent);
      expect(fetchRecentSightings).toHaveBeenCalledTimes(3);
      expect(fetchRecentSightings).toHaveBeenCalledWith(3.5, 97.0, 'Pongo abelii');
      expect(fetchRecentSightings).toHaveBeenCalledWith(3.5, 97.0, 'Panthera tigris sumatrae');
      expect(fetchRecentSightings).toHaveBeenCalledWith(3.5, 97.0, 'Dicerorhinus sumatrensis');
    });

    it('passes event coordinates to fetchRecentSightings', async () => {
      const coralEvent: EnrichedDisasterEvent = {
        ...baseEnrichedEvent,
        coordinates: { lat: -17.3, lng: 145.8 },
        species_at_risk: ['Acropora cervicornis'],
      };
      await runOneIteration(coralEvent);
      expect(fetchRecentSightings).toHaveBeenCalledWith(-17.3, 145.8, 'Acropora cervicornis');
    });

    it('aggregates sightings from multiple species and passes total count to LLM', async () => {
      const sighting2: GBIFSighting = { ...gbifSighting, speciesName: 'Panthera tigris sumatrae', occurrenceID: 'occ-002' };
      vi.mocked(fetchRecentSightings)
        .mockResolvedValueOnce([gbifSighting])
        .mockResolvedValueOnce([sighting2]);

      const twoSpeciesEvent: EnrichedDisasterEvent = {
        ...baseEnrichedEvent,
        species_at_risk: ['Pongo abelii', 'Panthera tigris sumatrae'],
      };
      await runOneIteration(twoSpeciesEvent);

      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.userMessage).toContain('2 total');
    });

    it('includes "No recent GBIF sightings found" in LLM prompt when list is empty', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([]);
      await runOneIteration();
      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.userMessage).toContain('No recent GBIF sightings found');
    });

    it('formats sighting lines correctly in the LLM user message', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      await runOneIteration();
      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.userMessage).toContain('Pongo abelii');
      expect(callArgs.userMessage).toContain('2026-01-15');
      expect(callArgs.userMessage).toContain('GBIF Backbone Taxonomy');
    });
  });

  describe('LLM analysis and result validation', () => {
    it('happy path: storeHabitatResult called with fixture values', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      await runOneIteration();
      expect(storeHabitatResult).toHaveBeenCalledWith(
        'test-enriched-001',
        expect.objectContaining({
          sighting_confidence: 'confirmed',
          most_recent_sighting: '2026-01-15',
          gbif_recent_sightings: [gbifSighting],
        })
      );
    });

    it('storeHabitatResult receives the raw GBIF sightings array', async () => {
      const sighting2: GBIFSighting = { ...gbifSighting, occurrenceID: 'occ-002' };
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting, sighting2]);
      await runOneIteration();
      const stored = vi.mocked(storeHabitatResult).mock.calls[0]![1];
      expect(stored.gbif_recent_sightings).toHaveLength(2);
    });

    it('validates confidence — falls back to "possible" when sightings exist and LLM returns invalid value', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      vi.mocked(modelRouter.complete).mockResolvedValueOnce({
        content: JSON.stringify({ sighting_confidence: 'INVALID_VALUE', most_recent_sighting: null, summary: 'x' }),
        model: 'gemini-2.5-flash-lite',
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0,
      });
      await runOneIteration();
      const stored = vi.mocked(storeHabitatResult).mock.calls[0]![1];
      expect(stored.sighting_confidence).toBe('possible');
    });

    it('validates confidence — falls back to "historical_only" when no sightings and LLM returns invalid value', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([]);
      vi.mocked(modelRouter.complete).mockResolvedValueOnce({
        content: JSON.stringify({ sighting_confidence: 'bad', most_recent_sighting: null, summary: 'x' }),
        model: 'gemini-2.5-flash-lite',
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0,
      });
      await runOneIteration();
      const stored = vi.mocked(storeHabitatResult).mock.calls[0]![1];
      expect(stored.sighting_confidence).toBe('historical_only');
    });

    it('LLM throws → fallback "possible" classification when sightings exist, storeHabitatResult still called', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('Gemini 503'));
      await runOneIteration();
      expect(storeHabitatResult).toHaveBeenCalled();
      const stored = vi.mocked(storeHabitatResult).mock.calls[0]![1];
      expect(stored.sighting_confidence).toBe('possible');
    });

    it('LLM throws → fallback uses first sighting eventDate as most_recent_sighting', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('timeout'));
      await runOneIteration();
      const stored = vi.mocked(storeHabitatResult).mock.calls[0]![1];
      expect(stored.most_recent_sighting).toBe('2026-01-15');
    });

    it('LLM throws → null most_recent_sighting when no sightings', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([]);
      vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('timeout'));
      await runOneIteration();
      const stored = vi.mocked(storeHabitatResult).mock.calls[0]![1];
      expect(stored.sighting_confidence).toBe('historical_only');
      expect(stored.most_recent_sighting).toBeNull();
    });

    it('uses GEMINI_FLASH_LITE model for GBIF classification', async () => {
      await runOneIteration();
      expect(modelRouter.complete).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.5-flash-lite' })
      );
    });

    it('uses jsonMode: true when calling the LLM', async () => {
      await runOneIteration();
      expect(modelRouter.complete).toHaveBeenCalledWith(
        expect.objectContaining({ jsonMode: true })
      );
    });

    it('ACKs even when LLM throws — no message loss on transient failures', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('rate limited'));
      await runOneIteration(baseEnrichedEvent, 'msg-llm-fail');
      expect(mockXack).toHaveBeenCalledWith('disaster:enriched', 'habitat-group', 'msg-llm-fail');
    });
  });

  describe('observability', () => {
    it('logs published status with sighting count and computed confidence', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      await runOneIteration();
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'test-enriched-001',
          stage: 'habitat',
          status: 'published',
          reason: expect.stringContaining('sightings: 1'),
        })
      );
    });

    it('includes computed_confidence in pipeline log reason', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      await runOneIteration();
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: expect.stringContaining('computed_confidence:'),
        })
      );
    });

    it('logs sighting count of 0 when no GBIF sightings found', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([]);
      await runOneIteration();
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'habitat',
          status: 'published',
          reason: expect.stringContaining('sightings: 0'),
        })
      );
    });

    it('calls logToWarRoom with GBIF agent/action and sighting summary', async () => {
      vi.mocked(fetchRecentSightings).mockResolvedValue([gbifSighting]);
      await runOneIteration();
      expect(logToWarRoom).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'habitat',
          action: 'GBIF',
          detail: expect.stringContaining('sightings'),
        })
      );
    });
  });
});
