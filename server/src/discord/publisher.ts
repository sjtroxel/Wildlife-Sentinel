/**
 * Discord Publisher — consumes DiscordQueueItems and routes to the correct channel.
 *
 * medium/high → auto-post to #wildlife-alerts
 * critical    → HITL review in #sentinel-ops (postCriticalForReview)
 *
 * The publisher is the only place that calls discord.js send() for alerts.
 * It also updates discord_message_id in the alerts table after posting.
 */
import { EmbedBuilder } from 'discord.js';
import type { DiscordQueueItem } from '@wildlife-sentinel/shared/types';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { getWildlifeAlertsChannel } from './bot.js';
import { postCriticalForReview } from './hitl.js';
import { logToWarRoom } from './warRoom.js';
import { sql } from '../db/client.js';

export async function startDiscordPublisher(): Promise<void> {
  await ensureConsumerGroup(STREAMS.DISCORD, CONSUMER_GROUPS.DISCORD);
  console.log('[discord-publisher] Consumer group ready. Listening on discord:queue...');

  while (true) {
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.DISCORD, 'discord-publisher-1',
      'COUNT', '5', 'BLOCK', '5000',
      'STREAMS', STREAMS.DISCORD, '>'
    ) as [string, [string, string[]][]][] | null;

    if (!messages) continue;

    for (const [, entries] of messages) {
      for (const [messageId, fields] of entries) {
        const item = JSON.parse(fields[1] ?? '{}') as DiscordQueueItem;

        try {
          await publishItem(item);
          await redis.xack(STREAMS.DISCORD, CONSUMER_GROUPS.DISCORD, messageId);
        } catch (err) {
          console.error('[discord-publisher] Error publishing:', err);
          await redis.xack(STREAMS.DISCORD, CONSUMER_GROUPS.DISCORD, messageId);
          await logToWarRoom({
            agent: 'discord',
            action: 'Publish failed',
            detail: `alert_id: ${item.alert_id} | ${String(err)}`,
            level: 'warning',
          });
        }
      }
    }
  }
}

async function publishItem(item: DiscordQueueItem): Promise<void> {
  // Reconstruct EmbedBuilder from the serialized embed data
  const embed = EmbedBuilder.from(item.embed as Parameters<typeof EmbedBuilder.from>[0]);

  if (item.channel === 'sentinel-ops-review') {
    // Critical alert — post to #sentinel-ops for HITL review
    await postCriticalForReview(embed, item.alert_id);
    await logToWarRoom({
      agent: 'discord',
      action: 'Critical posted for review',
      detail: `alert_id: ${item.alert_id} → #sentinel-ops`,
      level: 'alert',
    });
  } else {
    // medium or high — auto-post to #wildlife-alerts
    const posted = await getWildlifeAlertsChannel().send({ embeds: [embed] });

    await sql`
      UPDATE alerts SET discord_message_id = ${posted.id}
      WHERE id = ${item.stored_alert_id}::uuid
    `;

    await logToWarRoom({
      agent: 'discord',
      action: 'Posted to #wildlife-alerts',
      detail: `alert_id: ${item.alert_id} | threat: ${item.threat_level} | msg_id: ${posted.id}`,
    });

    console.log(`[discord-publisher] Posted alert ${item.alert_id} to #wildlife-alerts | msg: ${posted.id}`);
  }
}
