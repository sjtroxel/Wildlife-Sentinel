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

import { redis } from '../../src/redis/client.js';
import { logPipelineEvent } from '../../src/db/pipelineEvents.js';
import { modelRouter } from '../../src/router/ModelRouter.js';
import { processAlert } from '../../src/agents/SynthesisAgent.js';
import type { AssessedAlert } from '@wildlife-sentinel/shared/types';

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
    ...overrides,
  };
}

describe('SynthesisAgent.processAlert', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(logPipelineEvent).mockResolvedValue(undefined);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    mockSql.mockResolvedValue([]);
    vi.mocked(modelRouter.complete).mockResolvedValue({
      content: JSON.stringify(synthesisFixture),
      model: 'claude-sonnet-4-6',
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

  it('routes high threat to wildlife-alerts channel', async () => {
    await processAlert(makeAlert({ threat_level: 'high' }));

    const xaddCall = vi.mocked(redis.xadd).mock.calls[0];
    expect(xaddCall?.[0]).toBe('discord:queue');
    const payload = JSON.parse(xaddCall?.[3] as string) as { channel: string };
    expect(payload.channel).toBe('wildlife-alerts');
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
});
