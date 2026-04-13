import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';

const mockGetAlertTrends = vi.hoisted(() => vi.fn());

vi.mock('../../src/db/statsQueries.js', () => ({
  getAlertTrends: mockGetAlertTrends,
}));

vi.mock('../../src/db/client.js', () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn() }),
}));

vi.mock('../../src/redis/client.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), on: vi.fn(), quit: vi.fn() },
}));

vi.mock('../../src/config.js', () => ({
  config: {
    discordToken: 'test-token',
    discordClientId: 'test-client-id',
    discordGuildId: 'test-guild-id',
    discordChannelWildlifeAlerts: 'ch-alerts',
    discordChannelSentinelOps: 'ch-ops',
    frontendUrl: 'https://wildlife-sentinel.vercel.app',
  },
}));

import * as statsQueries from '../../src/db/statsQueries.js';
import type { TrendPoint } from '../../../shared/types.js';

const EVENT_LABELS: Record<string, string> = {
  wildfire:        '🔥 Wildfire',
  tropical_storm:  '🌀 Tropical Storm',
  flood:           '🌊 Flood',
  drought:         '🌵 Drought',
  coral_bleaching: '🪸 Coral Bleaching',
};

// Mirrors handleTrendsCommand from bot.ts
async function runTrendsHandler(
  days: number,
  frontendUrl: string
): Promise<string | { embeds: EmbedBuilder[] }> {
  const trends = await statsQueries.getAlertTrends(days);

  let wildfire = 0, tropical_storm = 0, flood = 0, drought = 0, coral_bleaching = 0, total = 0;
  for (const p of trends) {
    wildfire        += p.wildfire;
    tropical_storm  += p.tropical_storm;
    flood           += p.flood;
    drought         += p.drought;
    coral_bleaching += p.coral_bleaching;
    total           += p.total;
  }

  if (total === 0) {
    return `📊 No alerts recorded in the last ${days} days.`;
  }

  const activeDays = trends.filter((p: TrendPoint) => p.total > 0).length;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`📊 Alert Trends — Last ${days} Days`)
    .addFields(
      { name: EVENT_LABELS['wildfire']!,        value: `${wildfire} (${pct(wildfire)})`,               inline: true },
      { name: EVENT_LABELS['tropical_storm']!,  value: `${tropical_storm} (${pct(tropical_storm)})`,   inline: true },
      { name: EVENT_LABELS['flood']!,           value: `${flood} (${pct(flood)})`,                     inline: true },
      { name: EVENT_LABELS['drought']!,         value: `${drought} (${pct(drought)})`,                 inline: true },
      { name: EVENT_LABELS['coral_bleaching']!, value: `${coral_bleaching} (${pct(coral_bleaching)})`, inline: true },
    )
    .setFooter({
      text: `Total: ${total} alert${total !== 1 ? 's' : ''} · ${activeDays} active day${activeDays !== 1 ? 's' : ''} of ${days} · Wildlife Sentinel`,
    });

  if (frontendUrl) {
    embed.setURL(frontendUrl);
  }

  return { embeds: [embed] };
}

const mockTrends: TrendPoint[] = [
  { date: '2026-04-11', wildfire: 3, tropical_storm: 0, flood: 1, drought: 0, coral_bleaching: 0, total: 4 },
  { date: '2026-04-12', wildfire: 1, tropical_storm: 2, flood: 0, drought: 0, coral_bleaching: 1, total: 4 },
];

describe('/trends command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns an embed with all event-type fields', async () => {
    mockGetAlertTrends.mockResolvedValueOnce(mockTrends);
    const result = await runTrendsHandler(30, 'https://wildlife-sentinel.vercel.app');

    expect(typeof result).toBe('object');
    const { embeds } = result as { embeds: EmbedBuilder[] };
    expect(embeds).toHaveLength(1);

    const data = embeds[0]!.toJSON();
    expect(data.title).toBe('📊 Alert Trends — Last 30 Days');
    expect(data.color).toBe(0x3b82f6);
    expect(data.url).toBe('https://wildlife-sentinel.vercel.app');

    const fieldNames = (data.fields ?? []).map(f => f.name);
    expect(fieldNames).toContain('🔥 Wildfire');
    expect(fieldNames).toContain('🌀 Tropical Storm');
    expect(fieldNames).toContain('🌊 Flood');
    expect(fieldNames).toContain('🌵 Drought');
    expect(fieldNames).toContain('🪸 Coral Bleaching');
  });

  it('shows correct counts and percentages', async () => {
    mockGetAlertTrends.mockResolvedValueOnce(mockTrends);
    const result = await runTrendsHandler(30, 'https://wildlife-sentinel.vercel.app');
    const { embeds } = result as { embeds: EmbedBuilder[] };
    const data = embeds[0]!.toJSON();

    // wildfire = 4 total, total = 8 → 50%
    const wildfireField = (data.fields ?? []).find(f => f.name === '🔥 Wildfire');
    expect(wildfireField?.value).toBe('4 (50%)');
  });

  it('returns a plain string when there are no alerts', async () => {
    mockGetAlertTrends.mockResolvedValueOnce([]);
    const result = await runTrendsHandler(7, 'https://wildlife-sentinel.vercel.app');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('No alerts recorded');
    expect(result as string).toContain('7 days');
  });

  it('footer shows active days count', async () => {
    mockGetAlertTrends.mockResolvedValueOnce(mockTrends);
    const result = await runTrendsHandler(30, 'https://wildlife-sentinel.vercel.app');
    const { embeds } = result as { embeds: EmbedBuilder[] };
    const data = embeds[0]!.toJSON();
    expect(data.footer?.text).toContain('2 active days of 30');
  });

  it('omits embed URL when frontendUrl is empty', async () => {
    mockGetAlertTrends.mockResolvedValueOnce(mockTrends);
    const result = await runTrendsHandler(30, '');
    const { embeds } = result as { embeds: EmbedBuilder[] };
    const data = embeds[0]!.toJSON();
    expect(data.url).toBeUndefined();
  });
});
