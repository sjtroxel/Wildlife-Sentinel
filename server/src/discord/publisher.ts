import type { EnrichedDisasterEvent } from '@wildlife-sentinel/shared/types';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { getWildlifeAlertsChannel, getSentinelOpsChannel } from './bot.js';
import { sql } from '../db/client.js';

// Phase 1: plain text messages.
// Phase 5: replaced with rich embed construction via the Synthesis Agent.

export async function startDiscordPublisher(): Promise<void> {
  await ensureConsumerGroup(STREAMS.ENRICHED, CONSUMER_GROUPS.DISCORD);
  console.log('[discord-publisher] Consumer group ready. Listening for enriched events...');

  while (true) {
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.DISCORD, 'discord-publisher-1',
      'COUNT', '5', 'BLOCK', '5000',
      'STREAMS', STREAMS.ENRICHED, '>'
    ) as [string, [string, string[]][]][] | null;

    if (!messages) continue;

    for (const [, entries] of messages) {
      for (const [messageId, fields] of entries) {
        const event = JSON.parse(fields[1] ?? '{}') as EnrichedDisasterEvent;

        try {
          await publishAlert(event);
          await redis.xack(STREAMS.ENRICHED, CONSUMER_GROUPS.DISCORD, messageId);
        } catch (err) {
          console.error('[discord-publisher] Error publishing:', err);
          await redis.xack(STREAMS.ENRICHED, CONSUMER_GROUPS.DISCORD, messageId);
        }
      }
    }
  }
}

async function publishAlert(event: EnrichedDisasterEvent): Promise<void> {
  const species = event.species_at_risk[0] ?? 'Unknown species';
  const distance = event.habitat_distance_km.toFixed(1);
  const windInfo = event.wind_speed !== null && event.wind_direction !== null
    ? `Wind: ${event.wind_speed.toFixed(0)} km/h from ${event.wind_direction.toFixed(0)}°`
    : 'Wind data unavailable';

  const alertsChannel = getWildlifeAlertsChannel();
  const opsChannel = getSentinelOpsChannel();

  const alertMsg = [
    `FIRE ALERT — ${species} Habitat`,
    `Fire detected ${distance}km from critical habitat boundary`,
    `${windInfo} | Precipitation: ${event.precipitation_probability ?? '?'}%`,
    `Severity: ${(event.severity * 100).toFixed(0)}% | Source: NASA FIRMS VIIRS`,
    `Detected: ${new Date(event.timestamp).toUTCString()}`,
  ].join('\n');

  const posted = await alertsChannel.send(alertMsg);

  await sql`
    INSERT INTO alerts (raw_event_id, source, event_type, coordinates, severity, enrichment_data, discord_message_id)
    VALUES (
      ${event.id},
      ${event.source},
      ${event.event_type},
      ${JSON.stringify(event.coordinates)},
      ${event.severity},
      ${JSON.stringify({ weather: event.weather_summary, habitats: event.nearby_habitat_ids })},
      ${posted.id}
    )
  `;

  await opsChannel.send(
    `[firms:scout] Fire: lat=${event.coordinates.lat}, lng=${event.coordinates.lng} | severity=${(event.severity * 100).toFixed(0)}%\n` +
    `[enrichment] Habitat overlap: ${species} ${distance}km | weather attached | published`
  );
}
