import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Fixtures loaded at module scope (not inside vi.mock factories — avoids hoist issues)
const speciesFixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/llm/species-context-output.json'), 'utf8')
) as {
  common_name: string;
  population_estimate: string | null;
  primary_threats: string[];
  habitat_description: string;
  confidence_note: string;
};

// vi.hoisted: these mock fns are referenced inside vi.mock factories, so must be hoisted
const { mockXreadgroup, mockXack, mockRedisExists, mockSql } = vi.hoisted(() => ({
  mockXreadgroup: vi.fn(),
  mockXack: vi.fn(),
  mockRedisExists: vi.fn().mockResolvedValue(1), // default: assembly hash exists → process event
  mockSql: vi.fn(),
}));

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xreadgroup: mockXreadgroup,
    xack: mockXack,
    exists: mockRedisExists,
    publish: vi.fn().mockResolvedValue(0),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));

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

vi.mock('../../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn(),
    embed: vi.fn(),
  },
}));

vi.mock('../../src/pipeline/ThreatAssembler.js', () => ({
  storeSpeciesResult: vi.fn(),
}));

vi.mock('../../src/rag/retrieve.js', () => ({
  retrieveSpeciesFacts: vi.fn(),
  retrieveConservationContext: vi.fn().mockResolvedValue([]),
}));

import { startSpeciesContextAgent } from '../../src/agents/SpeciesContextAgent.js';
import { storeSpeciesResult } from '../../src/pipeline/ThreatAssembler.js';
import { logPipelineEvent } from '../../src/db/pipelineEvents.js';
import { modelRouter } from '../../src/router/ModelRouter.js';
import { retrieveSpeciesFacts } from '../../src/rag/retrieve.js';
import type { EnrichedDisasterEvent } from '@wildlife-sentinel/shared/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseEnrichedEvent: EnrichedDisasterEvent = {
  id: 'test-enriched-002',
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

const ragChunkFixture = {
  id: 'chunk-001',
  content: 'Pongo abelii is critically endangered due to habitat loss and fires in Sumatra.',
  section_type: 'threats',
  source_document: 'IUCN_Pongo_abelii_2024.pdf',
  similarity: 0.82,
};

const mockRouterResponse = {
  content: JSON.stringify(speciesFixture),
  model: 'gemini-2.5-flash',
  inputTokens: 120,
  outputTokens: 60,
  estimatedCostUsd: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeXreadgroupPayload(event: EnrichedDisasterEvent, msgId = 'msg-002') {
  return [['disaster:enriched', [[msgId, ['data', JSON.stringify(event)]]]]];
}

async function runOneIteration(event = baseEnrichedEvent, msgId = 'msg-002') {
  mockXreadgroup
    .mockResolvedValueOnce(makeXreadgroupPayload(event, msgId))
    .mockRejectedValueOnce(new Error('stop'));
  await expect(startSpeciesContextAgent()).rejects.toThrow('stop');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SpeciesContextAgent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockXack.mockResolvedValue(1);
    mockRedisExists.mockResolvedValue(1); // assembly hash exists by default
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(storeSpeciesResult).mockResolvedValue(undefined);
    vi.mocked(retrieveSpeciesFacts).mockResolvedValue([]);
    vi.mocked(modelRouter.complete).mockResolvedValue(mockRouterResponse);
    mockSql.mockResolvedValue([{ iucn_status: 'CR' }]);
  });

  describe('stream consumption', () => {
    it('calls ensureConsumerGroup for the species consumer group', async () => {
      const { ensureConsumerGroup } = await import('../../src/pipeline/streams.js');
      mockXreadgroup
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('stop'));
      await expect(startSpeciesContextAgent()).rejects.toThrow('stop');
      expect(ensureConsumerGroup).toHaveBeenCalledWith('disaster:enriched', 'species-group');
    });

    it('skips empty poll without calling storeSpeciesResult or XACK', async () => {
      mockXreadgroup
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('stop'));
      await expect(startSpeciesContextAgent()).rejects.toThrow('stop');
      expect(storeSpeciesResult).not.toHaveBeenCalled();
      expect(mockXack).not.toHaveBeenCalled();
    });

    it('ACKs the message with correct stream/group/id after successful processing', async () => {
      await runOneIteration(baseEnrichedEvent, 'msg-ack-species');
      expect(mockXack).toHaveBeenCalledWith('disaster:enriched', 'species-group', 'msg-ack-species');
    });

    it('ACKs the message even when processSpeciesEvent throws — no message loss', async () => {
      vi.mocked(storeSpeciesResult).mockRejectedValueOnce(new Error('DB write failed'));
      await runOneIteration(baseEnrichedEvent, 'msg-err-species');
      expect(mockXack).toHaveBeenCalledWith('disaster:enriched', 'species-group', 'msg-err-species');
    });

    it('logs error status when processSpeciesEvent throws', async () => {
      vi.mocked(storeSpeciesResult).mockRejectedValueOnce(new Error('DB write failed'));
      await runOneIteration();
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'test-enriched-002',
          stage: 'species',
          status: 'error',
          reason: expect.stringContaining('DB write failed'),
        })
      );
    });
  });

  describe('iucn_status sourcing — DB is authoritative, never the LLM', () => {
    it('uses iucn_status from DB row', async () => {
      mockSql.mockResolvedValue([{ iucn_status: 'CR' }]);
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs[0]!.iucn_status).toBe('CR');
    });

    it('defaults to LC when DB returns no row for species', async () => {
      mockSql.mockResolvedValue([]);
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs[0]!.iucn_status).toBe('LC');
    });

    it('defaults to LC when DB returns an unrecognized status string', async () => {
      mockSql.mockResolvedValue([{ iucn_status: 'UNKNOWN_CODE' }]);
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs[0]!.iucn_status).toBe('LC');
    });

    it('accepts all valid IUCN status codes from DB without modification', async () => {
      const validStatuses = ['EX', 'EW', 'CR', 'EN', 'VU', 'NT', 'LC'] as const;
      for (const status of validStatuses) {
        vi.resetAllMocks();
        mockXack.mockResolvedValue(1);
        mockRedisExists.mockResolvedValue(1);
        vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
        vi.mocked(storeSpeciesResult).mockResolvedValue(undefined);
        vi.mocked(retrieveSpeciesFacts).mockResolvedValue([]);
        vi.mocked(modelRouter.complete).mockResolvedValue(mockRouterResponse);
        mockSql.mockResolvedValue([{ iucn_status: status }]);

        await runOneIteration();

        const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
        expect(stored.species_briefs[0]!.iucn_status).toBe(status);
      }
    });

    it('queries DB with species_name from the event', async () => {
      await runOneIteration();
      expect(mockSql).toHaveBeenCalled();
      // The SQL template tag is called with the species name
      const sqlArgs = mockSql.mock.calls[0];
      expect(JSON.stringify(sqlArgs)).toContain('Pongo abelii');
    });
  });

  describe('RAG grounding', () => {
    it('calls retrieveSpeciesFacts with species name and threatened-by context', async () => {
      await runOneIteration();
      expect(retrieveSpeciesFacts).toHaveBeenCalledWith('Pongo abelii', 'threatened by wildfire');
    });

    it('calls retrieveSpeciesFacts once per species in species_at_risk', async () => {
      const multiSpeciesEvent: EnrichedDisasterEvent = {
        ...baseEnrichedEvent,
        species_at_risk: ['Pongo abelii', 'Panthera tigris sumatrae'],
      };
      mockSql.mockResolvedValue([{ iucn_status: 'CR' }]);
      await runOneIteration(multiSpeciesEvent);
      expect(retrieveSpeciesFacts).toHaveBeenCalledTimes(2);
    });

    it('includes RAG chunk content in system prompt when chunks returned', async () => {
      vi.mocked(retrieveSpeciesFacts).mockResolvedValue([ragChunkFixture]);
      await runOneIteration();
      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.systemPrompt).toContain('IUCN Red List');
      expect(callArgs.systemPrompt).toContain(ragChunkFixture.content);
    });

    it('includes source document name in system prompt with RAG chunks', async () => {
      vi.mocked(retrieveSpeciesFacts).mockResolvedValue([ragChunkFixture]);
      await runOneIteration();
      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.systemPrompt).toContain('IUCN_Pongo_abelii_2024.pdf');
    });

    it('includes grounding-only instruction in system prompt with RAG chunks', async () => {
      vi.mocked(retrieveSpeciesFacts).mockResolvedValue([ragChunkFixture]);
      await runOneIteration();
      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.systemPrompt).toContain('may ONLY state facts that appear in the above retrieved context');
    });

    it('uses "No RAG context" fallback system prompt when no chunks retrieved', async () => {
      vi.mocked(retrieveSpeciesFacts).mockResolvedValue([]);
      await runOneIteration();
      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.systemPrompt).toContain('No RAG context was retrieved');
      expect(callArgs.systemPrompt).toContain('training data only');
    });

    it('stores unique source_documents from RAG chunks in the brief', async () => {
      const chunk2 = { ...ragChunkFixture, id: 'chunk-002', section_type: 'habitat', source_document: 'WWF_Orangutan_2023.pdf' };
      vi.mocked(retrieveSpeciesFacts).mockResolvedValue([ragChunkFixture, chunk2]);
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs[0]!.source_documents).toContain('IUCN_Pongo_abelii_2024.pdf');
      expect(stored.species_briefs[0]!.source_documents).toContain('WWF_Orangutan_2023.pdf');
    });

    it('deduplicates source_documents when multiple chunks share the same source', async () => {
      const chunk2 = { ...ragChunkFixture, id: 'chunk-002', section_type: 'habitat', source_document: 'IUCN_Pongo_abelii_2024.pdf' };
      vi.mocked(retrieveSpeciesFacts).mockResolvedValue([ragChunkFixture, chunk2]);
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      const docs = stored.species_briefs[0]!.source_documents;
      expect(docs.filter((d: string) => d === 'IUCN_Pongo_abelii_2024.pdf')).toHaveLength(1);
    });

    it('stores empty source_documents array when no RAG chunks', async () => {
      vi.mocked(retrieveSpeciesFacts).mockResolvedValue([]);
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs[0]!.source_documents).toEqual([]);
    });
  });

  describe('brief generation', () => {
    it('happy path: storeSpeciesResult called with correct brief from fixture', async () => {
      mockSql.mockResolvedValue([{ iucn_status: 'CR' }]);
      await runOneIteration();
      expect(storeSpeciesResult).toHaveBeenCalledWith(
        'test-enriched-002',
        expect.objectContaining({
          species_briefs: [
            expect.objectContaining({
              species_name: 'Pongo abelii',
              common_name: 'Sumatran Orangutan',
              iucn_status: 'CR',
              population_estimate: 'approximately 13,000',
              primary_threats: expect.arrayContaining(['habitat loss from deforestation', 'wildfires']),
              habitat_description: expect.stringContaining('Sumatra'),
            }),
          ],
        })
      );
    });

    it('generates one brief per species when multiple species_at_risk', async () => {
      const multiSpeciesEvent: EnrichedDisasterEvent = {
        ...baseEnrichedEvent,
        species_at_risk: ['Pongo abelii', 'Panthera tigris sumatrae'],
      };
      mockSql.mockResolvedValue([{ iucn_status: 'CR' }]);
      await runOneIteration(multiSpeciesEvent);
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs).toHaveLength(2);
    });

    it('LLM throws → fallback brief returned, storeSpeciesResult still called', async () => {
      vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('Gemini 429'));
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs).toHaveLength(1);
      expect(stored.species_briefs[0]!.habitat_description).toBe('Species information unavailable.');
      expect(stored.species_briefs[0]!.primary_threats).toEqual([]);
      expect(stored.species_briefs[0]!.source_documents).toEqual([]);
    });

    it('LLM throws → fallback brief uses species_name as common_name', async () => {
      vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('timeout'));
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs[0]!.common_name).toBe('Pongo abelii');
    });

    it('LLM throws → fallback brief preserves correct iucn_status from DB', async () => {
      mockSql.mockResolvedValue([{ iucn_status: 'EN' }]);
      vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('timeout'));
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs[0]!.iucn_status).toBe('EN');
    });

    it('malformed LLM JSON → fallback brief, storeSpeciesResult still called', async () => {
      vi.mocked(modelRouter.complete).mockResolvedValueOnce({
        content: '{ this is not valid JSON at all }',
        model: 'gemini-2.5-flash',
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0,
      });
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(stored.species_briefs[0]!.habitat_description).toBe('Species information unavailable.');
    });

    it('defaults primary_threats to empty array when LLM returns null for that field', async () => {
      vi.mocked(modelRouter.complete).mockResolvedValueOnce({
        content: JSON.stringify({ ...speciesFixture, primary_threats: null }),
        model: 'gemini-2.5-flash',
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0,
      });
      await runOneIteration();
      const stored = vi.mocked(storeSpeciesResult).mock.calls[0]![1];
      expect(Array.isArray(stored.species_briefs[0]!.primary_threats)).toBe(true);
      expect(stored.species_briefs[0]!.primary_threats).toEqual([]);
    });

    it('uses GEMINI_FLASH (not Flash-Lite) for species brief generation', async () => {
      await runOneIteration();
      expect(modelRouter.complete).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.5-flash' })
      );
    });

    it('uses jsonMode: true for structured brief output', async () => {
      await runOneIteration();
      expect(modelRouter.complete).toHaveBeenCalledWith(
        expect.objectContaining({ jsonMode: true })
      );
    });

    it('includes species_name and iucn_status in the LLM user message', async () => {
      mockSql.mockResolvedValue([{ iucn_status: 'CR' }]);
      await runOneIteration();
      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.userMessage).toContain('Pongo abelii');
      expect(callArgs.userMessage).toContain('CR');
    });

    it('includes event_type in the LLM user message as threat context', async () => {
      await runOneIteration();
      const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
      expect(callArgs.userMessage).toContain('wildfire');
    });

    it('ACKs even when LLM throws — no message loss on Gemini failures', async () => {
      vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('rate limited'));
      await runOneIteration(baseEnrichedEvent, 'msg-llm-fail-species');
      expect(mockXack).toHaveBeenCalledWith('disaster:enriched', 'species-group', 'msg-llm-fail-species');
    });
  });

  describe('observability', () => {
    it('logs published status after successful processing', async () => {
      await runOneIteration();
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'test-enriched-002',
          stage: 'species',
          status: 'published',
        })
      );
    });

    it('includes brief count in the published log reason', async () => {
      await runOneIteration();
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: expect.stringContaining('1 species briefs'),
        })
      );
    });

    it('logs correct brief count for multiple species', async () => {
      const multiSpeciesEvent: EnrichedDisasterEvent = {
        ...baseEnrichedEvent,
        species_at_risk: ['Pongo abelii', 'Panthera tigris sumatrae', 'Dicerorhinus sumatrensis'],
      };
      mockSql.mockResolvedValue([{ iucn_status: 'CR' }]);
      await runOneIteration(multiSpeciesEvent);
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: expect.stringContaining('3 species briefs'),
        })
      );
    });
  });
});
