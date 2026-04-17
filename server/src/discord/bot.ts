import {
  Client,
  GatewayIntentBits,
  TextChannel,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { redis } from '../redis/client.js';
import {
  lookupSpecies,
  getSpeciesAlertCount,
  getSpeciesCentroid,
  autocompleteSpecies,
} from '../db/speciesQueries.js';
import { getAlertTrends } from '../db/statsQueries.js';
import { SLASH_COMMANDS } from './helpContent.js';
import type { IUCNStatus } from '../../../shared/types.js';

const PAUSE_KEY = 'pipeline:paused';

const IUCN_LABEL: Record<IUCNStatus, string> = {
  EX: 'Extinct',
  EW: 'Extinct in the Wild',
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
};

const IUCN_COLORS: Record<IUCNStatus, number> = {
  EX: 0x3f3f46,
  EW: 0x52525b,
  CR: 0xdc2626,
  EN: 0xea580c,
  VU: 0xd97706,
  NT: 0xca8a04,
  LC: 0x16a34a,
};

const commands = [
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the Wildlife Sentinel pipeline (stops scouts from publishing new events)'),
  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the Wildlife Sentinel pipeline'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show current pipeline pause state'),
  new SlashCommandBuilder()
    .setName('species')
    .setDescription('Look up a monitored species')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Common name or Latin binomial (e.g. "Sumatran Orangutan" or "pongo abelii")')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName('trends')
    .setDescription('Show alert frequency breakdown for the last N days')
    .addIntegerOption(opt =>
      opt
        .setName('days')
        .setDescription('How many days to look back (default: 30)')
        .setRequired(false)
        .addChoices(
          { name: '7 days',  value: 7  },
          { name: '14 days', value: 14 },
          { name: '30 days', value: 30 },
          { name: '90 days', value: 90 },
        )
    ),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn what Wildlife Sentinel does and how to use this bot'),
].map(cmd => cmd.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

export function getBotStatus(): 'connected' | 'disconnected' {
  return client.isReady() ? 'connected' : 'disconnected';
}

export function getSentinelOpsChannel(): TextChannel {
  const ch = client.channels.cache.get(config.discordChannelSentinelOps);
  if (!ch || !(ch instanceof TextChannel)) throw new Error('sentinel-ops channel unavailable');
  return ch;
}

export function getWildlifeAlertsChannel(): TextChannel {
  const ch = client.channels.cache.get(config.discordChannelWildlifeAlerts);
  if (!ch || !(ch instanceof TextChannel)) throw new Error('wildlife-alerts channel unavailable');
  return ch;
}

export async function startBot(): Promise<void> {
  // Register guild slash commands (instant, no propagation delay)
  const rest = new REST().setToken(config.discordToken);
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: commands }
  );

  client.on('interactionCreate', async (interaction) => {
    // --- Autocomplete ---
    if (interaction.isAutocomplete() && interaction.commandName === 'species') {
      const input = interaction.options.getFocused();
      if (!input || input.length < 2) {
        await interaction.respond([]);
        return;
      }
      try {
        const rows = await autocompleteSpecies(input);
        await interaction.respond(
          rows.map(r => ({
            name: r.common_name ?? r.species_name,
            value: (r.common_name ?? r.species_name).toLowerCase(),
          }))
        );
      } catch {
        await interaction.respond([]);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // Acknowledge immediately — Discord requires a response within 3 seconds
    await interaction.deferReply();

    try {
      if (interaction.commandName === 'pause') {
        await redis.set(PAUSE_KEY, new Date().toISOString());
        await interaction.editReply('⏸️ **Pipeline paused.** Scouts will stop publishing new events. Use `/resume` to restart.');

      } else if (interaction.commandName === 'resume') {
        await redis.del(PAUSE_KEY);
        await interaction.editReply('▶️ **Pipeline resumed.** Scouts will pick up on their next cycle.');

      } else if (interaction.commandName === 'status') {
        const pausedSince = await redis.get(PAUSE_KEY);
        if (pausedSince) {
          await interaction.editReply(`⏸️ **Pipeline is PAUSED** (since ${pausedSince}). Use \`/resume\` to restart.`);
        } else {
          await interaction.editReply('✅ **Pipeline is running.**');
        }

      } else if (interaction.commandName === 'species') {
        await handleSpeciesCommand(interaction);

      } else if (interaction.commandName === 'trends') {
        await handleTrendsCommand(interaction);

      } else if (interaction.commandName === 'help') {
        await handleHelpCommand(interaction);
      }
    } catch (err) {
      console.error('[discord] Slash command error:', err);
      await interaction.editReply('Command failed — check server logs.').catch(() => undefined);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn('[discord] Gateway connection timed out after 20s — continuing startup without bot');
      resolve();
    }, 20_000);

    client.once('clientReady', async () => {
      clearTimeout(timeout);
      console.log(`[discord] Online as ${client.user?.tag}`);
      try {
        const ops = getSentinelOpsChannel();
        await ops.send('Wildlife Sentinel is online. Pipeline starting up...');
      } catch (err) {
        console.error('[discord] Failed to post startup message:', err);
      }
      resolve();
    });
    client.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[discord] Client error:', err);
      reject(err);
    });
    client.login(config.discordToken).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function handleSpeciesCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const input = interaction.options.getString('name') ?? '';
  const species = await lookupSpecies(input);

  if (!species) {
    await interaction.editReply(
      `Species not found. Try \`/species Sumatran Orangutan\` or start typing for autocomplete suggestions.`
    );
    return;
  }

  const [alertCount, centroid] = await Promise.all([
    getSpeciesAlertCount(species.species_name),
    getSpeciesCentroid(species.species_name),
  ]);

  const embed = new EmbedBuilder()
    .setColor(IUCN_COLORS[species.iucn_status] ?? 0x6b7280)
    .setTitle(species.common_name ?? species.species_name)
    .setDescription(`*${species.species_name}*`)
    .addFields(
      {
        name: 'IUCN Status',
        value: `**${species.iucn_status}** · ${IUCN_LABEL[species.iucn_status]}`,
        inline: true,
      },
      { name: 'Alerts (all time)', value: String(alertCount), inline: true },
      centroid
        ? { name: 'Range Centroid', value: `${centroid.lat.toFixed(2)}°, ${centroid.lng.toFixed(2)}°`, inline: true }
        : { name: 'Range Centroid', value: 'N/A', inline: true },
    )
    .setFooter({ text: 'Wildlife Sentinel · IUCN Red List / GBIF' });

  if (config.frontendUrl && species.slug) {
    embed.setURL(`${config.frontendUrl}/species/${species.slug}`);
  }

  await interaction.editReply({ embeds: [embed] });
}

const EVENT_LABELS: Record<string, string> = {
  wildfire:         '🔥 Wildfire',
  tropical_storm:   '🌀 Tropical Storm',
  flood:            '🌊 Flood',
  drought:          '🌵 Drought',
  coral_bleaching:  '🪸 Coral Bleaching',
  climate_anomaly:  '🌡️ Climate Anomaly',
  illegal_fishing:  '🐟 Illegal Fishing',
};

async function handleTrendsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const days = interaction.options.getInteger('days') ?? 30;
  const trends = await getAlertTrends(days);

  // Sum totals across all days
  let wildfire = 0, tropical_storm = 0, flood = 0, drought = 0, coral_bleaching = 0,
      climate_anomaly = 0, illegal_fishing = 0, total = 0;
  for (const p of trends) {
    wildfire         += p.wildfire;
    tropical_storm   += p.tropical_storm;
    flood            += p.flood;
    drought          += p.drought;
    coral_bleaching  += p.coral_bleaching;
    climate_anomaly  += p.climate_anomaly;
    illegal_fishing  += p.illegal_fishing;
    total            += p.total;
  }

  if (total === 0) {
    await interaction.editReply(`📊 No alerts recorded in the last ${days} days.`);
    return;
  }

  const activeDays = trends.filter(p => p.total > 0).length;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`📊 Alert Trends — Last ${days} Days`)
    .addFields(
      { name: EVENT_LABELS['wildfire']!,         value: `${wildfire} (${pct(wildfire)})`,                 inline: true },
      { name: EVENT_LABELS['tropical_storm']!,  value: `${tropical_storm} (${pct(tropical_storm)})`,     inline: true },
      { name: EVENT_LABELS['flood']!,           value: `${flood} (${pct(flood)})`,                       inline: true },
      { name: EVENT_LABELS['drought']!,         value: `${drought} (${pct(drought)})`,                   inline: true },
      { name: EVENT_LABELS['coral_bleaching']!, value: `${coral_bleaching} (${pct(coral_bleaching)})`,   inline: true },
      { name: EVENT_LABELS['climate_anomaly']!, value: `${climate_anomaly} (${pct(climate_anomaly)})`,   inline: true },
      { name: EVENT_LABELS['illegal_fishing']!, value: `${illegal_fishing} (${pct(illegal_fishing)})`,   inline: true },
    )
    .setFooter({
      text: `Total: ${total} alert${total !== 1 ? 's' : ''} · ${activeDays} active day${activeDays !== 1 ? 's' : ''} of ${days} · Wildlife Sentinel`,
    });

  if (config.frontendUrl) {
    embed.setURL(config.frontendUrl);
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleHelpCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
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

  if (config.frontendUrl) {
    embed.addFields({
      name: '🌐 Web Dashboard',
      value: `[wildlife-sentinel.vercel.app](${config.frontendUrl}) — Live map, alert archive, species profiles, and prediction accuracy charts.`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

export { client };
