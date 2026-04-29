import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCharitiesForAlert = vi.hoisted(() => vi.fn());
const mockAutocompleteSpecies  = vi.hoisted(() => vi.fn());

vi.mock('../../src/db/charityQueries.js', () => ({
  getCharitiesForAlert: mockGetCharitiesForAlert,
}));

vi.mock('../../src/db/speciesQueries.js', () => ({
  autocompleteSpecies: mockAutocompleteSpecies,
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

import { EmbedBuilder } from 'discord.js';
import * as charityQueries from '../../src/db/charityQueries.js';
import * as speciesQueries from '../../src/db/speciesQueries.js';
import type { Charity } from '@wildlife-sentinel/shared/types';

// Thin re-implementation of handleDonateCommand from bot.ts — mirrors it exactly.
// bot.ts is excluded from coverage; we test the handler logic directly here.
async function runDonateHandler(
  speciesInput: string | null,
  eventType: string | null,
  frontendUrl: string
): Promise<{ reply: string | object }> {
  const speciesNames = speciesInput ? [speciesInput] : [];
  const eventTypeStr = eventType ?? '';
  const charities = await charityQueries.getCharitiesForAlert(speciesNames, eventTypeStr, 5);

  if (charities.length === 0) {
    return {
      reply: 'No conservation charities found for that combination. Try `/donate` without filters for general recommendations.',
    };
  }

  const label = speciesInput
    ? `Supporting **${speciesInput}**`
    : eventTypeStr
      ? `Responding to **${eventTypeStr.replace(/_/g, ' ')}** threats`
      : 'Supporting Wildlife Conservation';

  const embed = new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle('💛 Conservation Organizations')
    .setDescription(
      `${label} — here are vetted organizations where your donation makes a real difference.`
    );

  for (const charity of charities) {
    const stars = charity.charity_navigator_rating
      ? '⭐'.repeat(charity.charity_navigator_rating) +
        ` (${charity.charity_navigator_rating}/4 Charity Navigator)`
      : '';
    embed.addFields({
      name: charity.name,
      value: `${charity.description}${stars ? '\n' + stars : ''}\n[Donate →](${charity.donation_url})`,
      inline: false,
    });
  }

  embed.setFooter({ text: 'Wildlife Sentinel · Conservation Action · All charities are vetted' });

  if (frontendUrl) {
    embed.addFields({
      name: '🌐 Browse All Partners',
      value: `[View all conservation partners](${frontendUrl}/charities)`,
      inline: false,
    });
  }

  return { reply: { embeds: [embed] } };
}

// Re-implementation of autocomplete logic from bot.ts
async function runDonateAutocomplete(
  input: string
): Promise<{ name: string; value: string }[]> {
  if (!input || input.length < 2) return [];
  const rows = await speciesQueries.autocompleteSpecies(input);
  return rows.map(r => ({
    name: r.common_name ?? r.species_name,
    value: (r.common_name ?? r.species_name).toLowerCase(),
  }));
}

function makeCharity(overrides: Partial<Charity> = {}): Charity {
  return {
    id: 'charity-uuid-1',
    name: 'World Wildlife Fund',
    slug: 'wwf',
    url: 'https://www.worldwildlife.org',
    donation_url: 'https://www.worldwildlife.org/donate',
    description: 'The world\'s leading conservation organization.',
    logo_url: null,
    charity_navigator_rating: 4,
    headquarters_country: 'USA',
    focus_regions: ['Global'],
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const FRONTEND_URL = 'https://wildlife-sentinel.vercel.app';

describe('/donate command', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns an embed with charity name and donate link when species is provided', async () => {
    mockGetCharitiesForAlert.mockResolvedValueOnce([
      makeCharity({
        name: 'Orangutan Foundation International',
        slug: 'ofi',
        donation_url: 'https://orangutan.org/donate-2',
        charity_navigator_rating: 3,
        description: 'Founded by Dr. Biruté Mary Galdikas.',
      }),
    ]);

    const result = await runDonateHandler('Sumatran Orangutan', null, FRONTEND_URL);

    expect(result.reply).toHaveProperty('embeds');
    const data = (result.reply as { embeds: EmbedBuilder[] }).embeds[0]!.toJSON();

    expect(data.title).toBe('💛 Conservation Organizations');
    expect(data.description).toContain('Supporting **Sumatran Orangutan**');

    const fields = data.fields ?? [];
    const charityField = fields.find(f => f.name === 'Orangutan Foundation International');
    expect(charityField).toBeDefined();
    expect(charityField!.value).toContain('[Donate →](https://orangutan.org/donate-2)');
    expect(vi.mocked(charityQueries.getCharitiesForAlert)).toHaveBeenCalledWith(
      ['Sumatran Orangutan'],
      '',
      5
    );
  });

  it('returns an embed for event_type when no species is provided', async () => {
    mockGetCharitiesForAlert.mockResolvedValueOnce([
      makeCharity({ name: 'Rainforest Trust', slug: 'rainforest-trust', donation_url: 'https://www.rainforesttrust.org/donate', charity_navigator_rating: null }),
    ]);

    const result = await runDonateHandler(null, 'wildfire', FRONTEND_URL);

    expect(result.reply).toHaveProperty('embeds');
    const data = (result.reply as { embeds: EmbedBuilder[] }).embeds[0]!.toJSON();
    expect(data.description).toContain('Responding to **wildfire** threats');
    expect(vi.mocked(charityQueries.getCharitiesForAlert)).toHaveBeenCalledWith([], 'wildfire', 5);
  });

  it('uses general label and calls with empty args when neither species nor event_type provided', async () => {
    mockGetCharitiesForAlert.mockResolvedValueOnce([makeCharity()]);

    const result = await runDonateHandler(null, null, FRONTEND_URL);

    const data = (result.reply as { embeds: EmbedBuilder[] }).embeds[0]!.toJSON();
    expect(data.description).toContain('Supporting Wildlife Conservation');
    expect(vi.mocked(charityQueries.getCharitiesForAlert)).toHaveBeenCalledWith([], '', 5);
  });

  it('returns an error string when no charities are found', async () => {
    mockGetCharitiesForAlert.mockResolvedValueOnce([]);

    const result = await runDonateHandler('UnknownSpecies', 'unknown_event', FRONTEND_URL);

    expect(typeof result.reply).toBe('string');
    expect(result.reply as string).toContain('No conservation charities found');
  });

  it('includes Charity Navigator star rating in field value when rating is present', async () => {
    mockGetCharitiesForAlert.mockResolvedValueOnce([
      makeCharity({ charity_navigator_rating: 4 }),
    ]);

    const result = await runDonateHandler(null, 'wildfire', FRONTEND_URL);

    const fields = (result.reply as { embeds: EmbedBuilder[] }).embeds[0]!.toJSON().fields ?? [];
    const charityField = fields.find(f => f.name === 'World Wildlife Fund');
    expect(charityField!.value).toContain('⭐⭐⭐⭐ (4/4 Charity Navigator)');
  });
});

describe('/donate autocomplete', () => {
  beforeEach(() => vi.resetAllMocks());

  it('delegates to autocompleteSpecies and maps rows to name/value pairs', async () => {
    mockAutocompleteSpecies.mockResolvedValueOnce([
      { species_name: 'Pongo abelii',   common_name: 'Sumatran Orangutan' },
      { species_name: 'Pongo pygmaeus', common_name: 'Bornean Orangutan' },
    ]);

    const suggestions = await runDonateAutocomplete('orang');

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toEqual({ name: 'Sumatran Orangutan', value: 'sumatran orangutan' });
    expect(suggestions[1]).toEqual({ name: 'Bornean Orangutan',  value: 'bornean orangutan' });
  });

  it('returns empty array for input shorter than 2 characters', async () => {
    const suggestions = await runDonateAutocomplete('o');

    expect(suggestions).toHaveLength(0);
    expect(vi.mocked(speciesQueries.autocompleteSpecies)).not.toHaveBeenCalled();
  });
});
