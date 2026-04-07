/**
 * HITL (Human-in-the-Loop) — critical alert review workflow.
 *
 * Critical alerts are posted to #sentinel-ops with ✅/❌ reactions.
 * A human reacts to approve (→ auto-posts to #wildlife-alerts) or suppress.
 * Review window: 24 hours. Timeout is logged to the war room.
 */
import { EmbedBuilder } from 'discord.js';
import { getSentinelOpsChannel, getWildlifeAlertsChannel } from './bot.js';
import { logToWarRoom } from './warRoom.js';
import { sql } from '../db/client.js';

export async function postCriticalForReview(embed: EmbedBuilder, alertId: string, threatLevel = 'critical'): Promise<void> {
  const opsChannel = getSentinelOpsChannel();
  const levelLabel = threatLevel.toUpperCase();
  const icon = threatLevel === 'critical' ? '🔴' : '🟠';

  const reviewMsg = await opsChannel.send({
    content: [
      `${icon} **${levelLabel} ALERT — Human review required**`,
      `Alert ID: \`${alertId}\``,
      `React ✅ to approve for public posting | React ❌ to suppress`,
    ].join('\n'),
    embeds: [embed],
  });

  await reviewMsg.react('✅');
  await reviewMsg.react('❌');

  const collector = reviewMsg.createReactionCollector({
    filter: (reaction, user) =>
      ['✅', '❌'].includes(reaction.emoji.name ?? '') && !user.bot,
    max: 1,
    time: 24 * 60 * 60 * 1000, // 24-hour review window
  });

  collector.on('collect', async (reaction) => {
    try {
      if (reaction.emoji.name === '✅') {
        const posted = await getWildlifeAlertsChannel().send({ embeds: [embed] });
        await reviewMsg.edit({
          content: `✅ **Approved and posted to #wildlife-alerts** | Alert ID: \`${alertId}\``,
        });
        await sql`
          UPDATE alerts SET discord_message_id = ${posted.id}
          WHERE id = ${alertId}::uuid
        `;
        await logToWarRoom({
          agent: 'hitl',
          action: 'Approved',
          detail: `alert_id: ${alertId} → posted to #wildlife-alerts`,
          level: 'alert',
        });
      } else {
        await reviewMsg.edit({
          content: `❌ **Suppressed by reviewer** | Alert ID: \`${alertId}\``,
        });
        await logToWarRoom({
          agent: 'hitl',
          action: 'Suppressed',
          detail: `alert_id: ${alertId}`,
          level: 'warning',
        });
      }
    } catch (err) {
      console.error('[hitl] Error handling reaction:', err);
    }
  });

  collector.on('end', (collected) => {
    if (collected.size === 0) {
      logToWarRoom({
        agent: 'hitl',
        action: 'Timed out — no review',
        detail: `alert_id: ${alertId} (24h window expired)`,
        level: 'warning',
      }).catch(console.error);
    }
  });
}
