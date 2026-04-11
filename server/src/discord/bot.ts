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

      } else if (interaction.commandName === 'help') {
        await handleHelpCommand(interaction);
      }
    } catch (err) {
      console.error('[discord] Slash command error:', err);
      await interaction.editReply('Command failed — check server logs.').catch(() => undefined);
    }
  });

  await new Promise<void>((resolve, reject) => {
    client.once('clientReady', async () => {
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
      console.error('[discord] Client error:', err);
      reject(err);
    });
    client.login(config.discordToken).catch(reject);
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
