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
    xreadgroup: vi.fn(),
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
import { getAgentPrompt } from '../../src/db/agentPrompts.js';
import { logToWarRoom } from '../../src/discord/warRoom.js';
import { processEvent, startThreatAssessmentAgent } from '../../src/agents/ThreatAssessmentAgent.js';
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
      model: 'claude-haiku-4-5-20251001',
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
      model: 'claude-haiku-4-5-20251001',
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

  it('calls getAgentPrompt with "threat_assessment"', async () => {
    await processEvent(baseEvent);
    expect(getAgentPrompt).toHaveBeenCalledWith('threat_assessment');
  });

  it('calls logToWarRoom with threat level and confidence info', async () => {
    await processEvent(baseEvent);
    expect(logToWarRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'threat_assess',
        action: expect.stringContaining('HIGH'),
        detail: expect.stringContaining('confidence='),
      })
    );
  });

  it('publishes alert with warning level logToWarRoom for high threat', async () => {
    await processEvent(baseEvent);
    expect(logToWarRoom).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' })
    );
  });

  it('publishes alert with alert level logToWarRoom for critical threat', async () => {
    vi.mocked(modelRouter.complete).mockResolvedValueOnce({
      content: JSON.stringify({ ...threatFixture as object, threat_level: 'critical' }),
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 500,
      outputTokens: 200,
      estimatedCostUsd: 0.004,
    });
    await processEvent(baseEvent);
    expect(logToWarRoom).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'alert' })
    );
  });

  it('includes prediction_timestamp in published AssessedAlert', async () => {
    await processEvent(baseEvent);
    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]?.[3] as string
    ) as { prediction_timestamp: string };
    expect(payload.prediction_timestamp).toBeTruthy();
    expect(new Date(payload.prediction_timestamp).toString()).not.toBe('Invalid Date');
  });

  it('executes SQL to upsert the alert record', async () => {
    await processEvent(baseEvent);
    // sql is called at least 3 times: alert upsert + two refiner_queue inserts
    expect(mockSql).toHaveBeenCalled();
  });

  it('inserts two refiner_queue entries for non-drought events (24h and 48h)', async () => {
    await processEvent(baseEvent); // wildfire
    // 3 sql calls: INSERT alerts + INSERT refiner_queue 24h + INSERT refiner_queue 48h
    expect(mockSql.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('inserts one refiner_queue entry for drought events (weekly)', async () => {
    const droughtEvent: FullyEnrichedEvent = { ...baseEvent, event_type: 'drought', source: 'drought_monitor' };
    await processEvent(droughtEvent);
    // 2 sql calls: INSERT alerts + INSERT refiner_queue weekly
    expect(mockSql.mock.calls.length).toBeGreaterThanOrEqual(2);
    const calls = mockSql.mock.calls.map((c: unknown[]) => JSON.stringify(c));
    const weeklyCall = calls.find((c: string) => c.includes('weekly'));
    expect(weeklyCall).toBeDefined();
  });

  it('malformed LLM JSON → processEvent throws (caught by outer loop)', async () => {
    vi.mocked(modelRouter.complete).mockResolvedValueOnce({
      content: '{ not valid json',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0,
    });
    await expect(processEvent(baseEvent)).rejects.toThrow();
  });

  it('getAgentPrompt failure → processEvent throws', async () => {
    vi.mocked(getAgentPrompt).mockRejectedValueOnce(new Error('No prompt found'));
    await expect(processEvent(baseEvent)).rejects.toThrow('No prompt found');
  });
});

// ── startThreatAssessmentAgent loop tests ─────────────────────────────────────

function makeThreatXreadgroupPayload(data: Record<string, unknown>, msgId = 'threat-msg-001') {
  return [['alerts:assessed', [[msgId, ['data', JSON.stringify(data)]]]]];
}

async function runThreatIteration(data: Record<string, unknown>, msgId = 'threat-msg-001') {
  vi.mocked(redis.xreadgroup)
    .mockResolvedValueOnce(makeThreatXreadgroupPayload(data, msgId))
    .mockRejectedValueOnce(new Error('stop'));
  await expect(startThreatAssessmentAgent()).rejects.toThrow('stop');
}

describe('startThreatAssessmentAgent loop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(logToWarRoom).mockResolvedValue(undefined);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.xack).mockResolvedValue(1);
    vi.mocked(getAgentPrompt).mockResolvedValue('You are a wildlife threat assessment specialist.');
    mockSql.mockResolvedValue([]);
    vi.mocked(modelRouter.complete).mockResolvedValue({
      content: JSON.stringify(threatFixture),
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 500,
      outputTokens: 200,
      estimatedCostUsd: 0.004,
    });
  });

  it('skips messages that already have threat_level (AssessedAlerts) — ACKs without processing', async () => {
    const alreadyAssessed = { ...baseEvent, threat_level: 'high', predicted_impact: '...' };
    await runThreatIteration(alreadyAssessed as unknown as Record<string, unknown>, 'skip-msg-001');
    expect(redis.xack).toHaveBeenCalledWith('alerts:assessed', 'threat-group', 'skip-msg-001');
    expect(modelRouter.complete).not.toHaveBeenCalled();
  });

  it('processes messages without threat_level (FullyEnrichedEvents)', async () => {
    await runThreatIteration(baseEvent as unknown as Record<string, unknown>);
    expect(modelRouter.complete).toHaveBeenCalled();
  });

  it('ACKs message after successful processEvent', async () => {
    await runThreatIteration(baseEvent as unknown as Record<string, unknown>, 'threat-success-001');
    expect(redis.xack).toHaveBeenCalledWith('alerts:assessed', 'threat-group', 'threat-success-001');
  });

  it('ACKs message even when processEvent throws — no message loss', async () => {
    vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('Claude API error'));
    await runThreatIteration(baseEvent as unknown as Record<string, unknown>, 'threat-err-001');
    expect(redis.xack).toHaveBeenCalledWith('alerts:assessed', 'threat-group', 'threat-err-001');
  });

  it('logs error status to pipeline_events when processEvent throws', async () => {
    vi.mocked(modelRouter.complete).mockRejectedValueOnce(new Error('Claude API error'));
    await runThreatIteration(baseEvent as unknown as Record<string, unknown>);
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'threat',
        status: 'error',
        reason: expect.stringContaining('Claude API error'),
      })
    );
  });

  it('getAgentPrompt failure → error caught by outer loop → XACK + error log', async () => {
    vi.mocked(getAgentPrompt).mockRejectedValueOnce(new Error('No prompt found'));
    await runThreatIteration(baseEvent as unknown as Record<string, unknown>, 'prompt-err-001');
    expect(redis.xack).toHaveBeenCalledWith('alerts:assessed', 'threat-group', 'prompt-err-001');
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', reason: expect.stringContaining('No prompt found') })
    );
  });

  it('skips null poll without ACKing', async () => {
    vi.mocked(redis.xreadgroup)
      .mockImplementationOnce(() => Promise.resolve(null))
      .mockRejectedValueOnce(new Error('stop'));
    await expect(startThreatAssessmentAgent()).rejects.toThrow('stop');
    expect(redis.xack).not.toHaveBeenCalled();
  });
});
