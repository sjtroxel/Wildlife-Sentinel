import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { config } from '../config.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

let botStatus: 'connected' | 'disconnected' = 'disconnected';

export function getBotStatus(): 'connected' | 'disconnected' {
  return botStatus;
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
  await new Promise<void>((resolve, reject) => {
    client.once('ready', async () => {
      botStatus = 'connected';
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
      botStatus = 'disconnected';
      console.error('[discord] Client error:', err);
      reject(err);
    });
    client.login(config.discordToken).catch(reject);
  });
}

export { client };
