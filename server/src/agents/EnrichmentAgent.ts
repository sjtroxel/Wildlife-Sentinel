import type { RawDisasterEvent, EnrichedDisasterEvent } from '@wildlife-sentinel/shared/types';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';

const HABITAT_RADIUS_METERS = 75_000; // 75 km

interface HabitatMatch {
  id: string;
  species_name: string;
  iucn_status: string;
  distance_km: number;
}

interface OpenMeteoHourly {
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  precipitation_probability: number[];
}

export async function startEnrichmentAgent(): Promise<void> {
  await ensureConsumerGroup(STREAMS.RAW, CONSUMER_GROUPS.ENRICHMENT);
  console.log('[enrichment] Consumer group ready. Waiting for events...');

  while (true) {
    const messages = await redis.xreadgroup(
      'GROUP', CONSUMER_GROUPS.ENRICHMENT, 'enrichment-worker-1',
      'COUNT', '10', 'BLOCK', '5000',
      'STREAMS', STREAMS.RAW, '>'
    ) as [string, [string, string[]][]][] | null;

    if (!messages) continue;

    for (const [, entries] of messages) {
      for (const [messageId, fields] of entries) {
        const rawEvent = JSON.parse(fields[1] ?? '{}') as RawDisasterEvent;

        try {
          await processEvent(rawEvent);
          await redis.xack(STREAMS.RAW, CONSUMER_GROUPS.ENRICHMENT, messageId);
        } catch (err) {
          console.error('[enrichment] Error processing event:', err);
          // ACK to prevent infinite redelivery — error is logged for auditing
          await redis.xack(STREAMS.RAW, CONSUMER_GROUPS.ENRICHMENT, messageId);
          await logPipelineEvent({
            event_id: rawEvent.id,
            source: rawEvent.source,
            stage: 'enrichment',
            status: 'error',
            reason: String(err),
          });
        }
      }
    }
  }
}

export async function processEvent(event: RawDisasterEvent): Promise<void> {
  const { lat, lng } = event.coordinates;

  // IMPORTANT: ST_Point(lng, lat) — longitude FIRST in PostGIS
  const habitats = await sql<HabitatMatch[]>`
    SELECT
      id::text,
      species_name,
      iucn_status,
      ST_Distance(geom::geography, ST_Point(${lng}, ${lat})::geography) / 1000 AS distance_km
    FROM species_ranges
    WHERE ST_DWithin(
      geom::geography,
      ST_Point(${lng}, ${lat})::geography,
      ${HABITAT_RADIUS_METERS}
    )
    ORDER BY distance_km ASC
  `;

  if (habitats.length === 0) {
    await logPipelineEvent({
      event_id: event.id,
      source: event.source,
      stage: 'enrichment',
      status: 'filtered',
      reason: 'no_habitat_overlap',
    });
    return;
  }

  const weather = await fetchWeather(lat, lng);

  const windDir = weather.wind_direction_10m[0] ?? null;
  const windSpeed = weather.wind_speed_10m[0] ?? null;
  const precipProb = weather.precipitation_probability[0] ?? null;

  const weather_summary = windSpeed !== null && windDir !== null
    ? `Wind: ${windSpeed.toFixed(1)} km/h from ${bearingToCardinal(windDir)}. Precipitation: ${precipProb ?? 'unknown'}%.`
    : 'Weather data unavailable.';

  const enriched: EnrichedDisasterEvent = {
    ...event,
    wind_direction: windDir,
    wind_speed: windSpeed,
    precipitation_probability: precipProb,
    weather_summary,
    nearby_habitat_ids: habitats.map(h => h.id),
    species_at_risk: [...new Set(habitats.map(h => h.species_name))],
    habitat_distance_km: habitats[0]!.distance_km,
  };

  await redis.xadd(STREAMS.ENRICHED, '*', 'data', JSON.stringify(enriched));

  await logPipelineEvent({
    event_id: event.id,
    source: event.source,
    stage: 'enriched',
    status: 'published',
    reason: `${habitats.length} habitats within ${HABITAT_RADIUS_METERS / 1000}km`,
  });

  console.log(
    `[enrichment] ${event.source} enriched | ` +
    `habitats: ${habitats.length} | ` +
    `nearest: ${enriched.species_at_risk[0]} @ ${enriched.habitat_distance_km.toFixed(1)}km`
  );
}

async function fetchWeather(lat: number, lng: number): Promise<OpenMeteoHourly> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m,precipitation_probability');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('wind_speed_unit', 'kmh');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);

  const data = await res.json() as { hourly: OpenMeteoHourly };
  return data.hourly;
}

function bearingToCardinal(degrees: number): string {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
  return cardinals[index] ?? 'N';
}
