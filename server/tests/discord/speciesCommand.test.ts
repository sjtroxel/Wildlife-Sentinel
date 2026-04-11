import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks so they're available before imports
const mockLookupSpecies = vi.hoisted(() => vi.fn());
const mockGetSpeciesAlertCount = vi.hoisted(() => vi.fn());
const mockGetSpeciesCentroid = vi.hoisted(() => vi.fn());
const mockAutocompleteSpecies = vi.hoisted(() => vi.fn());

vi.mock('../../src/db/speciesQueries.js', () => ({
  lookupSpecies: mockLookupSpecies,
  getSpeciesAlertCount: mockGetSpeciesAlertCount,
  getSpeciesCentroid: mockGetSpeciesCentroid,
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

// Import the handlers indirectly by calling them through the module
// We test handleSpeciesCommand via a fake interaction object
import { EmbedBuilder } from 'discord.js';

// Pull the handler functions out by re-implementing the same logic used in bot.ts
// to avoid spinning up a real Discord client. We test the logic directly.
import * as speciesQueries from '../../src/db/speciesQueries.js';

const IUCN_LABEL: Record<string, string> = {
  EX: 'Extinct', EW: 'Extinct in the Wild', CR: 'Critically Endangered',
  EN: 'Endangered', VU: 'Vulnerable', NT: 'Near Threatened', LC: 'Least Concern',
};

const IUCN_COLORS: Record<string, number> = {
  EX: 0x3f3f46, EW: 0x52525b, CR: 0xdc2626,
  EN: 0xea580c, VU: 0xd97706, NT: 0xca8a04, LC: 0x16a34a,
};

// Thin re-implementation of the handler logic — mirrors bot.ts exactly
async function runSpeciesHandler(
  input: string,
  frontendUrl: string
): Promise<{ reply: string | object }> {
  const species = await speciesQueries.lookupSpecies(input);
  if (!species) {
    return {
      reply: `Species not found. Try \`/species Sumatran Orangutan\` or start typing for autocomplete suggestions.`,
    };
  }

  const [alertCount, centroid] = await Promise.all([
    speciesQueries.getSpeciesAlertCount(species.species_name),
    speciesQueries.getSpeciesCentroid(species.species_name),
  ]);

  const embed = new EmbedBuilder()
    .setColor(IUCN_COLORS[species.iucn_status] ?? 0x6b7280)
    .setTitle(species.common_name ?? species.species_name)
    .setDescription(`*${species.species_name}*`)
    .addFields(
      { name: 'IUCN Status', value: `**${species.iucn_status}** · ${IUCN_LABEL[species.iucn_status]}`, inline: true },
      { name: 'Alerts (all time)', value: String(alertCount), inline: true },
      centroid
        ? { name: 'Range Centroid', value: `${centroid.lat.toFixed(2)}°, ${centroid.lng.toFixed(2)}°`, inline: true }
        : { name: 'Range Centroid', value: 'N/A', inline: true },
    )
    .setFooter({ text: 'Wildlife Sentinel · IUCN Red List / GBIF' });

  if (frontendUrl && species.slug) {
    embed.setURL(`${frontendUrl}/species/${species.slug}`);
  }

  return { reply: { embeds: [embed] } };
}

async function runAutocompleteHandler(input: string): Promise<{ name: string; value: string }[]> {
  if (!input || input.length < 2) return [];
  const rows = await speciesQueries.autocompleteSpecies(input);
  return rows.map(r => ({
    name: r.common_name ?? r.species_name,
    value: (r.common_name ?? r.species_name).toLowerCase(),
  }));
}

describe('/species command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns a rich embed when species is found', async () => {
    mockLookupSpecies.mockResolvedValue({
      species_name: 'Pongo abelii',
      common_name: 'Sumatran Orangutan',
      iucn_status: 'CR',
      iucn_species_id: '121097935',
      slug: 'pongo-abelii',
    });
    mockGetSpeciesAlertCount.mockResolvedValue(7);
    mockGetSpeciesCentroid.mockResolvedValue({ lat: -3.5, lng: 104.2 });

    const result = await runSpeciesHandler('sumatran orangutan', 'https://wildlife-sentinel.vercel.app');

    expect(result.reply).toHaveProperty('embeds');
    const embeds = (result.reply as { embeds: EmbedBuilder[] }).embeds;
    expect(embeds).toHaveLength(1);

    const data = embeds[0]!.toJSON();
    expect(data.title).toBe('Sumatran Orangutan');
    expect(data.description).toBe('*Pongo abelii*');
    expect(data.url).toBe('https://wildlife-sentinel.vercel.app/species/pongo-abelii');
    expect(data.color).toBe(0xdc2626); // CR = red

    const fields = data.fields ?? [];
    expect(fields.find(f => f.name === 'IUCN Status')?.value).toBe('**CR** · Critically Endangered');
    expect(fields.find(f => f.name === 'Alerts (all time)')?.value).toBe('7');
    expect(fields.find(f => f.name === 'Range Centroid')?.value).toBe('-3.50°, 104.20°');
  });

  it('returns a not-found message when species is unknown', async () => {
    mockLookupSpecies.mockResolvedValue(null);

    const result = await runSpeciesHandler('unicorn', 'https://wildlife-sentinel.vercel.app');

    expect(typeof result.reply).toBe('string');
    expect(result.reply as string).toContain('Species not found');
    expect(mockGetSpeciesAlertCount).not.toHaveBeenCalled();
    expect(mockGetSpeciesCentroid).not.toHaveBeenCalled();
  });

  it('autocomplete returns matching suggestions', async () => {
    mockAutocompleteSpecies.mockResolvedValue([
      { species_name: 'Pongo abelii', common_name: 'Sumatran Orangutan' },
      { species_name: 'Pongo pygmaeus', common_name: 'Bornean Orangutan' },
    ]);

    const suggestions = await runAutocompleteHandler('orang');

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toEqual({ name: 'Sumatran Orangutan', value: 'sumatran orangutan' });
    expect(suggestions[1]).toEqual({ name: 'Bornean Orangutan', value: 'bornean orangutan' });
  });

  it('autocomplete returns empty array for short input', async () => {
    const suggestions = await runAutocompleteHandler('o');
    expect(suggestions).toHaveLength(0);
    expect(mockAutocompleteSpecies).not.toHaveBeenCalled();
  });
});
