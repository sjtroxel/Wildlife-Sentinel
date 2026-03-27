import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const threatFixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/llm/threat-assessment-wildfire.json'), 'utf8')
) as unknown;

// vi.hoisted ensures mockSql is available at vi.mock() hoist time
const mockSql = vi.hoisted(() => vi.fn());

vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xadd: vi.fn().mockResolvedValue('1234-0'),
    xack: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: {
    ASSESSED: 'alerts:assessed',
    DISCORD: 'discord:queue',
  },
  CONSUMER_GROUPS: { THREAT: 'threat-group' },
  ensureConsumerGroup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/pipelineEvents.js', () => ({
  logPipelineEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/agentPrompts.js', () => ({
  getAgentPrompt: vi.fn().mockResolvedValue('You are a wildlife threat assessment specialist.'),
}));

vi.mock('../../src/discord/warRoom.js', () => ({
  logToWarRoom: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn(),
    embed: vi.fn(),
  },
}));

import { redis } from '../../src/redis/client.js';
import { logPipelineEvent } from '../../src/db/pipelineEvents.js';
import { modelRouter } from '../../src/router/ModelRouter.js';
import { processEvent } from '../../src/agents/ThreatAssessmentAgent.js';
import type { FullyEnrichedEvent } from '@wildlife-sentinel/shared/types';

const baseEvent: FullyEnrichedEvent = {
  id: 'test-threat-001',
  source: 'nasa_firms',
  event_type: 'wildfire',
  coordinates: { lat: 3.5, lng: 97.0 },
  severity: 0.87,
  timestamp: new Date().toISOString(),
  raw_data: { frp: 87.3, confidence: 'n' },
  wind_direction: 270,
  wind_speed: 18.5,
  precipitation_probability: 5,
  weather_summary: 'Wind: 18.5 km/h from W. Low precipitation probability.',
  nearby_habitat_ids: ['habitat-uuid-1'],
  species_at_risk: ['Pongo abelii'],
  habitat_distance_km: 18.3,
  gbif_recent_sightings: [
    {
      speciesName: 'Pongo abelii',
      decimalLatitude: 3.6,
      decimalLongitude: 97.1,
      eventDate: '2026-03-14',
      datasetName: 'GBIF Backbone Taxonomy',
      occurrenceID: 'gbif-001',
    },
  ],
  species_briefs: [
    {
      species_name: 'Pongo abelii',
      common_name: 'Sumatran Orangutan',
      iucn_status: 'CR',
      population_estimate: '13,600',
      primary_threats: ['deforestation', 'palm oil expansion'],
      habitat_description: 'Lowland tropical rainforest in northern Sumatra.',
      source_documents: [],
    },
  ],
  sighting_confidence: 'confirmed',
  most_recent_sighting: '2026-03-14',
};

describe('ThreatAssessmentAgent.processEvent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    // sql mock: upsert alert returns [], refiner_queue inserts return []
    mockSql.mockResolvedValue([]);
    vi.mocked(modelRouter.complete).mockResolvedValue({
      content: JSON.stringify(threatFixture),
      model: 'claude-sonnet-4-6',
      inputTokens: 500,
      outputTokens: 200,
      estimatedCostUsd: 0.004,
    });
  });

  it('publishes AssessedAlert to alerts:assessed with threat_level from fixture', async () => {
    await processEvent(baseEvent);

    const xaddCall = vi.mocked(redis.xadd).mock.calls[0];
    expect(xaddCall?.[0]).toBe('alerts:assessed');
    const payload = JSON.parse(xaddCall?.[3] as string) as { threat_level: string };
    expect(payload.threat_level).toBe('high');
  });

  it('computes confidence from observable fields (never self-reported)', async () => {
    await processEvent(baseEvent);

    const xaddCall = vi.mocked(redis.xadd).mock.calls[0];
    const payload = JSON.parse(xaddCall?.[3] as string) as { confidence_score: number; threat_level: string };

    // dataCompleteness: 5/5 = 1.0, sourceQuality: 0.95, habitatCertainty: dist 18.3 → 0.85
    // expected: 0.4*1.0 + 0.35*0.95 + 0.25*0.85 = 0.4 + 0.3325 + 0.2125 = 0.945
    expect(payload.confidence_score).toBeCloseTo(0.945, 2);
  });

  it('falls back to medium threat_level if LLM returns invalid value', async () => {
    vi.mocked(modelRouter.complete).mockResolvedValueOnce({
      content: JSON.stringify({ ...threatFixture as object, threat_level: 'catastrophic' }),
      model: 'claude-sonnet-4-6',
      inputTokens: 500,
      outputTokens: 200,
      estimatedCostUsd: 0.004,
    });

    await processEvent(baseEvent);

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]?.[3] as string
    ) as { threat_level: string };
    expect(payload.threat_level).toBe('medium');
  });

  it('logs published status to pipeline_events', async () => {
    await processEvent(baseEvent);

    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published', stage: 'threat' })
    );
  });

  it('includes sources array in published AssessedAlert', async () => {
    await processEvent(baseEvent);

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]?.[3] as string
    ) as { sources: string[] };
    expect(payload.sources).toContain('nasa_firms');
    expect(payload.sources).toContain('gbif');
  });
});
