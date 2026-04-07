import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const synthesisFixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/llm/synthesis-wildfire.json'), 'utf8')
) as unknown;

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
    ASSESSED: 'alerts:assessed',
    DISCORD: 'discord:queue',
  },
  CONSUMER_GROUPS: { SYNTHESIS: 'synthesis-group' },
  ensureConsumerGroup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/pipelineEvents.js', () => ({
  logPipelineEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db/agentPrompts.js', () => ({
  getAgentPrompt: vi.fn().mockResolvedValue('You are the public voice of Wildlife Sentinel.'),
}));

vi.mock('../../src/discord/warRoom.js', () => ({
  logToWarRoom: vi.fn().mockResolvedValue(undefined),
}));

// Mock discord.js EmbedBuilder with a plain class so vi.resetAllMocks() doesn't strip it
vi.mock('discord.js', () => ({
  EmbedBuilder: class {
    setColor() { return this; }
    setTitle() { return this; }
    setDescription() { return this; }
    addFields() { return this; }
    setFooter() { return this; }
    setTimestamp() { return this; }
    toJSON() { return { type: 'rich', title: 'Test embed' }; }
  },
}));

vi.mock('../../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn(),
    embed: vi.fn(),
  },
}));

vi.mock('../../src/rag/retrieve.js', () => ({
  retrieveConservationContext: vi.fn().mockResolvedValue([]),
  retrieveSpeciesFacts: vi.fn().mockResolvedValue([]),
}));

import { redis } from '../../src/redis/client.js';
import { logPipelineEvent } from '../../src/db/pipelineEvents.js';
import { modelRouter } from '../../src/router/ModelRouter.js';
import { getAgentPrompt } from '../../src/db/agentPrompts.js';
import { logToWarRoom } from '../../src/discord/warRoom.js';
import { retrieveConservationContext } from '../../src/rag/retrieve.js';
import { processAlert, startSynthesisAgent } from '../../src/agents/SynthesisAgent.js';
import type { AssessedAlert, EnrichedDisasterEvent } from '@wildlife-sentinel/shared/types';

function makeAlert(overrides: Partial<AssessedAlert> = {}): AssessedAlert {
  return {
    id: 'test-synthesis-001',
    source: 'nasa_firms',
    event_type: 'wildfire',
    coordinates: { lat: 3.5, lng: 97.0 },
    severity: 0.87,
    timestamp: new Date().toISOString(),
    raw_data: { frp: 87.3 },
    wind_direction: 270,
    wind_speed: 18.5,
    precipitation_probability: 5,
    weather_summary: 'Wind: 18.5 km/h from W.',
    nearby_habitat_ids: ['habitat-uuid-1'],
    species_at_risk: ['Pongo abelii'],
    habitat_distance_km: 18.3,
    gbif_recent_sightings: [],
    species_briefs: [{
      species_name: 'Pongo abelii',
      common_name: 'Sumatran Orangutan',
      iucn_status: 'CR',
      population_estimate: '13,600',
      primary_threats: ['deforestation'],
      habitat_description: 'Lowland tropical rainforest.',
      source_documents: [],
    }],
    sighting_confidence: 'confirmed',
    most_recent_sighting: '2026-03-14',
    threat_level: 'high',
    predicted_impact: 'Fire will spread NW toward habitat.',
    compounding_factors: ['Dry season'],
    recommended_action: 'Alert conservation teams.',
    confidence_score: 0.82,
    prediction_timestamp: new Date().toISOString(),
    sources: ['nasa_firms', 'gbif'],
    db_alert_id: 'db-uuid-test-001',
    ...overrides,
  };
}

describe('SynthesisAgent.processAlert', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    mockSql.mockResolvedValue([]);
    vi.mocked(retrieveConservationContext).mockResolvedValue([]);
    vi.mocked(modelRouter.complete).mockResolvedValue({
      content: JSON.stringify(synthesisFixture),
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 400,
      outputTokens: 150,
      estimatedCostUsd: 0.003,
    });
  });

  it('drops low threat level — does not publish to discord:queue', async () => {
    await processAlert(makeAlert({ threat_level: 'low' }));

    expect(redis.xadd).not.toHaveBeenCalled();
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'filtered', reason: 'threat_level_low' })
    );
  });

  it('routes high threat to sentinel-ops-review channel (HITL)', async () => {
    await processAlert(makeAlert({ threat_level: 'high' }));

    const xaddCall = vi.mocked(redis.xadd).mock.calls[0];
    expect(xaddCall?.[0]).toBe('discord:queue');
    const payload = JSON.parse(xaddCall?.[3] as string) as { channel: string };
    expect(payload.channel).toBe('sentinel-ops-review');
  });

  it('routes medium threat to wildlife-alerts channel', async () => {
    await processAlert(makeAlert({ threat_level: 'medium' }));

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]?.[3] as string
    ) as { channel: string };
    expect(payload.channel).toBe('wildlife-alerts');
  });

  it('routes critical threat to sentinel-ops-review channel', async () => {
    await processAlert(makeAlert({ threat_level: 'critical' }));

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]?.[3] as string
    ) as { channel: string };
    expect(payload.channel).toBe('sentinel-ops-review');
  });

  it('includes threat_level and alert_id in discord:queue item', async () => {
    await processAlert(makeAlert({ threat_level: 'high', id: 'alert-abc-123' }));

    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]?.[3] as string
    ) as { threat_level: string; alert_id: string };
    expect(payload.threat_level).toBe('high');
    expect(payload.alert_id).toBe('alert-abc-123');
  });

  it('logs synthesis stage as published after successful processing', async () => {
    await processAlert(makeAlert({ threat_level: 'high' }));

    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published', stage: 'synthesis' })
    );
  });

  it('calls getAgentPrompt("synthesis") for non-low threats', async () => {
    await processAlert(makeAlert({ threat_level: 'high' }));
    expect(getAgentPrompt).toHaveBeenCalledWith('synthesis');
  });

  it('does NOT call getAgentPrompt for low threat — drops before prompt fetch', async () => {
    await processAlert(makeAlert({ threat_level: 'low' }));
    expect(getAgentPrompt).not.toHaveBeenCalled();
  });

  it('calls retrieveConservationContext for non-low threats', async () => {
    await processAlert(makeAlert({ threat_level: 'high' }));
    expect(retrieveConservationContext).toHaveBeenCalled();
  });

  it('appends RAG conservation context to system prompt when chunks returned', async () => {
    const conservationChunk = {
      id: 'ctx-001',
      content: 'Orangutan populations have declined 50% in 20 years due to habitat loss.',
      document_title: 'WWF Living Planet 2024',
      source_document: 'WWF_Living_Planet_2024.pdf',
      similarity: 0.78,
    };
    vi.mocked(retrieveConservationContext).mockResolvedValueOnce([conservationChunk]);
    await processAlert(makeAlert({ threat_level: 'high' }));
    const callArgs = vi.mocked(modelRouter.complete).mock.calls[0]![0];
    expect(callArgs.systemPrompt).toContain(conservationChunk.content);
    expect(callArgs.systemPrompt).toContain('WWF_Living_Planet_2024.pdf');
  });

  it('calls logToWarRoom with routing information for non-low threats', async () => {
    await processAlert(makeAlert({ threat_level: 'high' }));
    expect(logToWarRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'synthesis',
        detail: expect.stringContaining('sentinel-ops-review'),
      })
    );
  });

  it('logToWarRoom uses alert level for critical threat', async () => {
    await processAlert(makeAlert({ threat_level: 'critical' }));
    expect(logToWarRoom).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'alert' })
    );
  });

  it('logToWarRoom uses info level for medium/high threat', async () => {
    await processAlert(makeAlert({ threat_level: 'high' }));
    expect(logToWarRoom).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info' })
    );
  });

  it('stored_alert_id uses db_alert_id (UUID) not the raw event id', async () => {
    await processAlert(makeAlert({ threat_level: 'high', id: 'alert-match-test', db_alert_id: 'db-uuid-from-neon' }));
    const payload = JSON.parse(
      vi.mocked(redis.xadd).mock.calls[0]?.[3] as string
    ) as { alert_id: string; stored_alert_id: string };
    expect(payload.alert_id).toBe('alert-match-test');
    expect(payload.stored_alert_id).toBe('db-uuid-from-neon');
  });

  it('uses CLAUDE_HAIKU model for embed generation', async () => {
    await processAlert(makeAlert({ threat_level: 'high' }));
    expect(modelRouter.complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
    );
  });

  it('malformed LLM JSON → processAlert throws (caught by outer loop)', async () => {
    vi.mocked(modelRouter.complete).mockResolvedValueOnce({
      content: 'not json at all',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0,
    });
    await expect(processAlert(makeAlert({ threat_level: 'high' }))).rejects.toThrow();
  });
});

// ── startSynthesisAgent loop tests ────────────────────────────────────────────

function makeSynthesisXreadgroupPayload(data: Record<string, unknown>, msgId = 'syn-msg-001') {
  return [['alerts:assessed', [[msgId, ['data', JSON.stringify(data)]]]]];
}

async function runSynthesisIteration(data: Record<string, unknown>, msgId = 'syn-msg-001') {
  vi.mocked(redis.xreadgroup)
    .mockResolvedValueOnce(makeSynthesisXreadgroupPayload(data, msgId))
    .mockRejectedValueOnce(new Error('stop'));
  await expect(startSynthesisAgent()).rejects.toThrow('stop');
}

describe('startSynthesisAgent loop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(logToWarRoom).mockResolvedValue(undefined);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.xack).mockResolvedValue(1);
    vi.mocked(getAgentPrompt).mockResolvedValue('You are the public voice of Wildlife Sentinel.');
    vi.mocked(retrieveConservationContext).mockResolvedValue([]);
    mockSql.mockResolvedValue([]);
    vi.mocked(modelRouter.complete).mockResolvedValue({
      content: JSON.stringify(synthesisFixture),
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 400,
      outputTokens: 150,
      estimatedCostUsd: 0.003,
    });
  });

  it('skips messages without threat_level (FullyEnrichedEvents from ThreatAssembler)', async () => {
    // A FullyEnrichedEvent has no threat_level — ThreatAssembler publishes these first
    const fullyEnrichedEvent: Partial<EnrichedDisasterEvent> & { gbif_recent_sightings: unknown[] } = {
      id: 'assembled-001',
      source: 'nasa_firms',
      event_type: 'wildfire',
      species_at_risk: ['Pongo abelii'],
      gbif_recent_sightings: [],
    };
    await runSynthesisIteration(fullyEnrichedEvent as unknown as Record<string, unknown>, 'skip-no-threat');
    expect(redis.xack).toHaveBeenCalledWith('alerts:assessed', 'synthesis-group', 'skip-no-threat');
    expect(modelRouter.complete).not.toHaveBeenCalled();
  });

  it('processes messages that have threat_level (AssessedAlerts)', async () => {
    await runSynthesisIteration(makeAlert({ threat_level: 'high' }) as unknown as Record<string, unknown>);
    expect(modelRouter.complete).toHaveBeenCalled();
  });

  it('ACKs message after successful processAlert', async () => {
    await runSynthesisIteration(
      makeAlert({ threat_level: 'high' }) as unknown as Record<string, unknown>,
      'syn-success-001'
    );
    expect(redis.xack).toHaveBeenCalledWith('alerts:assessed', 'synthesis-group', 'syn-success-001');
  });

  it('ACKs message even when processAlert throws (malformed JSON) — no message loss', async () => {
    vi.mocked(modelRouter.complete).mockResolvedValueOnce({
      content: 'not json',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0,
    });
    await runSynthesisIteration(
      makeAlert({ threat_level: 'high' }) as unknown as Record<string, unknown>,
      'syn-err-001'
    );
    expect(redis.xack).toHaveBeenCalledWith('alerts:assessed', 'synthesis-group', 'syn-err-001');
  });

  it('logs error status to pipeline_events when processAlert throws', async () => {
    vi.mocked(modelRouter.complete).mockResolvedValueOnce({
      content: 'not json',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0,
    });
    await runSynthesisIteration(makeAlert({ threat_level: 'high' }) as unknown as Record<string, unknown>);
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'synthesis',
        status: 'error',
      })
    );
  });

  it('skips null poll without ACKing', async () => {
    vi.mocked(redis.xreadgroup)
      // @ts-expect-error — null simulates empty xreadgroup poll (no messages available)
      .mockImplementationOnce(() => Promise.resolve(null))
      .mockRejectedValueOnce(new Error('stop'));
    await expect(startSynthesisAgent()).rejects.toThrow('stop');
    expect(redis.xack).not.toHaveBeenCalled();
  });
});
