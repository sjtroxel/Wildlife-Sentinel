/**
 * Weekly Digest Scheduler
 *
 * Posts a summary embed to #wildlife-alerts every Sunday at 18:00 UTC.
 * Covers the prior 7 days: alert counts, top species, accuracy trend, and AI cost.
 */
import cron from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import { sql } from '../db/client.js';
import { getWildlifeAlertsChannel } from './bot.js';

interface ThreatCount {
  threat_level: string;
  count: string;
}

interface EventTypeCount {
  event_type: string;
  count: string;
}

interface SpeciesCount {
  species_name: string;
  count: string;
}

interface AvgScore {
  avg_score: string | null;
}

interface WeeklyCost {
  total: string;
}

export async function buildWeeklyDigestEmbed(): Promise<EmbedBuilder> {
  // 1. Alert counts by threat level
  const threatCounts = await sql<ThreatCount[]>`
    SELECT threat_level, COUNT(*)::text AS count
    FROM alerts
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY threat_level
  `;

  const byLevel: Record<string, number> = {};
  let totalAlerts = 0;
  for (const row of threatCounts) {
    byLevel[row.threat_level] = parseInt(row.count, 10);
    totalAlerts += parseInt(row.count, 10);
  }

  // 2. Most active event type
  const eventTypeCounts = await sql<EventTypeCount[]>`
    SELECT event_type, COUNT(*)::text AS count
    FROM alerts
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY event_type
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `;
  const topEventType = eventTypeCounts[0]?.event_type?.replace(/_/g, ' ') ?? 'none';

  // 3. Average prediction accuracy from refiner_scores
  const avgScoreResult = await sql<AvgScore[]>`
    SELECT AVG(composite_score)::numeric(4,2)::text AS avg_score
    FROM refiner_scores
    WHERE evaluated_at > NOW() - INTERVAL '7 days'
  `;
  const avgScore = avgScoreResult[0]?.avg_score;
  const accuracyDisplay = avgScore != null ? `${(parseFloat(avgScore) * 100).toFixed(0)}%` : 'n/a';

  // 4. Top 3 species most frequently at risk
  // species_at_risk is stored inside enrichment_data JSONB, not a top-level column
  const speciesCounts = await sql<SpeciesCount[]>`
    SELECT species_name, COUNT(*)::text AS count
    FROM alerts,
         LATERAL jsonb_array_elements_text(
           COALESCE(enrichment_data->'species_at_risk', '[]'::jsonb)
         ) AS species_name
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY species_name
    ORDER BY COUNT(*) DESC
    LIMIT 3
  `;
  const topSpecies = speciesCounts.length > 0
    ? speciesCounts.map(r => r.species_name).join(', ')
    : 'none';

  // 5. AI cost this week
  const costResult = await sql<WeeklyCost[]>`
    SELECT COALESCE(SUM(estimated_cost_usd), 0)::numeric(6,4)::text AS total
    FROM model_usage
    WHERE called_at > NOW() - INTERVAL '7 days'
  `;
  const weeklyCost = parseFloat(costResult[0]?.total ?? '0').toFixed(2);

  const critical = byLevel['critical'] ?? 0;
  const high = byLevel['high'] ?? 0;
  const medium = byLevel['medium'] ?? 0;

  return new EmbedBuilder()
    .setColor(0x14b8a6)
    .setTitle('📊 Weekly Wildlife Sentinel Report')
    .setDescription(`Summary for the past 7 days ending <t:${Math.floor(Date.now() / 1000)}:D>.`)
    .addFields(
      {
        name: 'Alerts Fired',
        value: `**${totalAlerts}** total — ${critical} critical, ${high} high, ${medium} medium`,
        inline: false,
      },
      { name: 'Most Active Event Type', value: topEventType,    inline: true },
      { name: 'Avg Prediction Accuracy', value: accuracyDisplay, inline: true },
      { name: 'AI Cost This Week',       value: `$${weeklyCost}`, inline: true },
      { name: 'Species Most at Risk',    value: topSpecies,      inline: false },
    )
    .setFooter({ text: 'Wildlife Sentinel • Weekly Digest' })
    .setTimestamp();
}

export async function runWeeklyDigest(): Promise<void> {
  const embed = await buildWeeklyDigestEmbed();
  await getWildlifeAlertsChannel().send({ embeds: [embed] });
  console.log('[weekly-digest] Posted weekly summary to #wildlife-alerts');
}

export function startWeeklyDigestScheduler(): void {
  // Every Sunday at 18:00 UTC
  cron.schedule('0 18 * * 0', () => {
    runWeeklyDigest().catch((err) => {
      console.error('[weekly-digest] Failed to post weekly summary:', err);
    });
  }, { timezone: 'UTC' });

  console.log('[weekly-digest] Scheduler started — posts every Sunday 18:00 UTC');
}
