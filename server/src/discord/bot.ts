import { Client, GatewayIntentBits, TextChannel, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { redis } from '../redis/client.js';

const PAUSE_KEY = 'pipeline:paused';

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
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === 'pause') {
        await redis.set(PAUSE_KEY, new Date().toISOString());
        await interaction.reply('⏸️ **Pipeline paused.** Scouts will stop publishing new events. Use `/resume` to restart.');

      } else if (interaction.commandName === 'resume') {
        await redis.del(PAUSE_KEY);
        await interaction.reply('▶️ **Pipeline resumed.** Scouts will pick up on their next cycle.');

      } else if (interaction.commandName === 'status') {
        const pausedSince = await redis.get(PAUSE_KEY);
        if (pausedSince) {
          await interaction.reply(`⏸️ **Pipeline is PAUSED** (since ${pausedSince}). Use \`/resume\` to restart.`);
        } else {
          await interaction.reply('✅ **Pipeline is running.**');
        }
      }
    } catch (err) {
      console.error('[discord] Slash command error:', err);
      if (!interaction.replied) {
        await interaction.reply({ content: 'Command failed — check server logs.', ephemeral: true });
      }
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

export { client };
