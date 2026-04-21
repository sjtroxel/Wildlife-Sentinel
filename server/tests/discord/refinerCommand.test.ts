import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRefinerStats = vi.hoisted(() => vi.fn());

vi.mock('../../src/db/statsQueries.js', () => ({
  getAlertTrends:   vi.fn(),
  getRefinerStats:  mockGetRefinerStats,
}));

vi.mock('../../src/db/client.js', () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn() }),
}));

vi.mock('../../src/redis/client.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), on: vi.fn(), quit: vi.fn() },
}));

vi.mock('../../src/config.js', () => ({
  config: {
    discordToken:                   'test-token',
    discordClientId:                'test-client-id',
    discordGuildId:                 'test-guild-id',
    discordChannelWildlifeAlerts:   'ch-alerts',
    discordChannelSentinelOps:      'ch-ops',
    frontendUrl:                    'https://wildlife-sentinel.vercel.app',
  },
}));

import { buildRefinerEmbed } from '../../src/discord/bot.js';
import type { RefinerStats } from '../../src/db/statsQueries.js';

const NOW = new Date('2026-04-21T12:00:00Z');

const emptyStats: RefinerStats = {
  scores: [],
  queue:  { pending: 0, dueNow: 0, nextDueAt: null },
};

const statsWithScores: RefinerStats = {
  scores: [
    {
      compositeScore:      0.78,
      evaluationTime:      '24h',
      evaluatedAt:         new Date(NOW.getTime() - 2 * 3_600_000 * 24), // 2d ago
      eventType:           'wildfire',
      correctionGenerated: false,
    },
    {
      compositeScore:      0.51,
      evaluationTime:      '48h',
      evaluatedAt:         new Date(NOW.getTime() - 3 * 3_600_000 * 24), // 3d ago
      eventType:           'flood',
      correctionGenerated: true,
    },
  ],
  queue: { pending: 5, dueNow: 2, nextDueAt: null },
};

describe('buildRefinerEmbed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows empty-state message when no scores exist', async () => {
    const embed = await buildRefinerEmbed(emptyStats);
    const data = embed.toJSON();
    expect(data.title).toBe('🔬 Refiner — Prediction Accuracy');
    const evalField = data.fields?.find(f => f.name === 'Recent Evaluations');
    expect(evalField).toBeDefined();
    expect(evalField?.value).toContain('No evaluations completed yet');
  });

  it('shows "queue empty" text when pending is 0', async () => {
    const embed = await buildRefinerEmbed(emptyStats);
    const data = embed.toJSON();
    const queueField = data.fields?.find(f => f.name === 'Queue');
    expect(queueField?.value).toContain('Queue empty');
  });

  it('shows pending count and due-now count in queue field', async () => {
    const embed = await buildRefinerEmbed(statsWithScores);
    const data = embed.toJSON();
    const queueField = data.fields?.find(f => f.name === 'Queue');
    expect(queueField?.value).toContain('5');
    expect(queueField?.value).toContain('2');
  });

  it('renders score lines with event type and composite score', async () => {
    const embed = await buildRefinerEmbed(statsWithScores);
    const data = embed.toJSON();
    const evalField = data.fields?.find(f => f.name?.startsWith('Recent Evaluations'));
    expect(evalField?.value).toContain('wildfire');
    expect(evalField?.value).toContain('0.78');
    expect(evalField?.value).toContain('flood');
    expect(evalField?.value).toContain('0.51');
  });

  it('marks corrected scores with the warning indicator', async () => {
    const embed = await buildRefinerEmbed(statsWithScores);
    const data = embed.toJSON();
    const evalField = data.fields?.find(f => f.name?.startsWith('Recent Evaluations'));
    expect(evalField?.value).toContain('⚠️ corrected');
  });

  it('shows average score field when scores exist', async () => {
    const embed = await buildRefinerEmbed(statsWithScores);
    const data = embed.toJSON();
    const avgField = data.fields?.find(f => f.name === 'Average Score');
    expect(avgField).toBeDefined();
    // avg = (0.78 + 0.51) / 2 = 0.645
    expect(avgField?.value).toContain('0.65');
  });

  it('includes a footer', async () => {
    const embed = await buildRefinerEmbed(emptyStats);
    expect(embed.toJSON().footer?.text).toContain('Refiner');
  });

  it('shows next-due countdown when dueNow is 0 but nextDueAt is set', async () => {
    const futureStats: RefinerStats = {
      scores: [],
      queue: {
        pending:   3,
        dueNow:    0,
        nextDueAt: new Date(Date.now() + 14 * 3_600_000), // 14h from now
      },
    };
    const embed = await buildRefinerEmbed(futureStats);
    const data = embed.toJSON();
    const queueField = data.fields?.find(f => f.name === 'Queue');
    expect(queueField?.value).toContain('next due in');
    expect(queueField?.value).toContain('14h');
  });
});
