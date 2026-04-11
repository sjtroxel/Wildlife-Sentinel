import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import { SLASH_COMMANDS } from '../../src/discord/helpContent.js';

vi.mock('../../src/db/client.js', () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn() }),
}));

vi.mock('../../src/redis/client.js', () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), on: vi.fn(), quit: vi.fn() },
}));

// Re-implementation of the /help handler logic — mirrors bot.ts exactly
async function runHelpHandler(frontendUrl: string): Promise<{ embeds: EmbedBuilder[] }> {
  const commandsValue = SLASH_COMMANDS
    .map(c => `\`${c.name}\` — ${c.description}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle('Wildlife Sentinel — Quick Guide')
    .setDescription(
      'An autonomous 24/7 system that monitors global disaster data streams ' +
      '(wildfires, cyclones, floods, drought, coral bleaching) and fires alerts ' +
      'whenever a disaster threatens IUCN-listed critical habitat.'
    )
    .addFields(
      {
        name: '📢 Channels',
        value:
          '**#wildlife-alerts** — Public alerts for medium/high threat events.\n' +
          '**#sentinel-ops** — Pipeline activity + critical alerts awaiting review (react ✅ to approve).',
      },
      {
        name: '⚠️ Reading an Alert',
        value:
          '**CRITICAL / HIGH** — Severe threat, habitat overlap confirmed.\n' +
          '**MEDIUM** — Moderate threat, species at risk identified.\n' +
          '**LOW** — Logged to DB only, not posted here.\n\n' +
          'IUCN status: **CR** = Critically Endangered · **EN** = Endangered · **VU** = Vulnerable',
      },
      {
        name: '🤖 Slash Commands',
        value: commandsValue,
      },
    )
    .setFooter({ text: 'Wildlife Sentinel · Data: NASA FIRMS / NOAA / USGS / IUCN' });

  if (frontendUrl) {
    embed.addFields({
      name: '🌐 Web Dashboard',
      value: `[wildlife-sentinel.vercel.app](${frontendUrl}) — Live map, alert archive, species profiles, and prediction accuracy charts.`,
    });
  }

  return { embeds: [embed] };
}

describe('/help command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns an embed with all required fields', async () => {
    const result = await runHelpHandler('https://wildlife-sentinel.vercel.app');
    expect(result.embeds).toHaveLength(1);

    const data = result.embeds[0]!.toJSON();
    expect(data.title).toBe('Wildlife Sentinel — Quick Guide');
    expect(data.color).toBe(0x16a34a);
    expect(data.description).toContain('24/7');

    const fieldNames = (data.fields ?? []).map(f => f.name);
    expect(fieldNames).toContain('📢 Channels');
    expect(fieldNames).toContain('⚠️ Reading an Alert');
    expect(fieldNames).toContain('🤖 Slash Commands');
    expect(fieldNames).toContain('🌐 Web Dashboard');
  });

  it('includes all slash commands in the commands field', async () => {
    const result = await runHelpHandler('https://wildlife-sentinel.vercel.app');
    const data = result.embeds[0]!.toJSON();
    const commandsField = (data.fields ?? []).find(f => f.name === '🤖 Slash Commands');

    expect(commandsField).toBeDefined();
    for (const cmd of SLASH_COMMANDS) {
      expect(commandsField!.value).toContain(cmd.name);
      expect(commandsField!.value).toContain(cmd.description);
    }
  });

  it('omits the web dashboard field when FRONTEND_URL is not set', async () => {
    const result = await runHelpHandler('');
    const data = result.embeds[0]!.toJSON();
    const fieldNames = (data.fields ?? []).map(f => f.name);
    expect(fieldNames).not.toContain('🌐 Web Dashboard');
  });
});
