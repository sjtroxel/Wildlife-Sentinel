import type { RawDisasterEvent, EnrichedDisasterEvent } from '@wildlife-sentinel/shared/types';
import { MODELS } from '@wildlife-sentinel/shared/models';
import { sql } from '../db/client.js';
import { redis } from '../redis/client.js';
import { STREAMS, CONSUMER_GROUPS, ensureConsumerGroup } from '../pipeline/streams.js';
import { logPipelineEvent } from '../db/pipelineEvents.js';
import { modelRouter } from '../router/ModelRouter.js';
import { storeEventForAssembly } from '../pipeline/ThreatAssembler.js';

const HABITAT_RADIUS_METERS = 75_000; // 75 km
const CORRELATION_TTL_SECONDS = 3_600; // 1 hour — same disaster, 50km radius

/**
 * Returns a Redis key that buckets events by type and ~50km geographic cell.
 * 0.45° ≈ 50km at the equator. Events of the same type in the same cell within
 * CORRELATION_TTL_SECONDS are considered the same physical disaster.
 */
function correlationKey(event: RawDisasterEvent): string {
  const latBin = (Math.round(event.coordinates.lat / 0.45) * 0.45).toFixed(2);
  const lngBin = (Math.round(event.coordinates.lng / 0.45) * 0.45).toFixed(2);
  return `corr:${event.event_type}:${latBin}:${lngBin}`;
}

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
    if (await redis.get('pipeline:paused')) { await new Promise(r => setTimeout(r, 5_000)); continue; }
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

  // Correlation check — drop events that are part of the same physical disaster.
  // A 50km / 1h window prevents N separate pipeline runs (and N Discord alerts)
  // for a single large fire or storm. The first event through claims the cell;
  // subsequent events within the TTL are silently dropped.
  const corrKey = correlationKey(event);
  const existingId = await redis.get(corrKey);
  if (existingId) {
    console.log(`[enrichment] ${event.id} correlated with ${existingId} (${event.event_type} within 50km/1h) — dropping`);
    await logPipelineEvent({
      event_id: event.id,
      source: event.source,
      stage: 'enrichment',
      status: 'filtered',
      reason: `correlated_with:${existingId}`,
    });
    return;
  }
  await redis.setex(corrKey, CORRELATION_TTL_SECONDS, event.id);

  const [weather, ensoPhase, ensoAnomaly] = await Promise.all([
    fetchWeather(lat, lng),
    redis.get('enso:current_phase'),
    redis.get('enso:oni_anomaly'),
  ]);

  const windDir = weather.wind_direction_10m[0] ?? null;
  const windSpeed = weather.wind_speed_10m[0] ?? null;
  const precipProb = weather.precipitation_probability[0] ?? null;

  const weather_summary = await generateWeatherSummary(windSpeed, windDir, precipProb, ensoPhase, ensoAnomaly);

  const enriched: EnrichedDisasterEvent = {
    ...event,
    raw_data: {
      ...event.raw_data,
      ...buildStormProjection(event),
    },
    wind_direction: windDir,
    wind_speed: windSpeed,
    precipitation_probability: precipProb,
    weather_summary,
    nearby_habitat_ids: habitats.map(h => h.id),
    species_at_risk: [...new Set(habitats.map(h => h.species_name))],
    habitat_distance_km: habitats[0]!.distance_km,
  };

  // Store the assembly hash BEFORE publishing to the stream.
  // SpeciesContextAgent checks redis.exists('assembly:ID') immediately on
  // reading the message — if we published first, there would be a race window
  // where the check returns 0 and the event gets silently skipped.
  await storeEventForAssembly(event.id, enriched);

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

async function generateWeatherSummary(
  windSpeed: number | null,
  windDir: number | null,
  precipProb: number | null,
  ensoPhase: string | null = null,
  ensoAnomaly: string | null = null,
): Promise<string> {
  if (windSpeed === null && windDir === null) return 'Weather data unavailable.';

  const fallback = windSpeed !== null && windDir !== null
    ? `Wind: ${windSpeed.toFixed(1)} km/h from ${bearingToCardinal(windDir)}. Precipitation: ${precipProb ?? 'unknown'}%.`
    : 'Weather data unavailable.';

  const ensoNote = ensoPhase && ensoPhase !== 'neutral' && ensoAnomaly
    ? ` Active ${ensoPhase === 'el_nino' ? 'El Niño' : 'La Niña'} (ONI: ${parseFloat(ensoAnomaly) > 0 ? '+' : ''}${ensoAnomaly}°C) — factor compounding climate stress into the summary.`
    : '';

  try {
    const result = await modelRouter.complete({
      model: MODELS.GEMINI_FLASH_LITE,
      systemPrompt: 'Summarize weather conditions for a wildlife disaster assessment in one concise sentence. Focus on fire spread or flood risk implications.',
      userMessage: `Wind speed: ${windSpeed?.toFixed(1) ?? 'unknown'} km/h from ${windDir !== null ? bearingToCardinal(windDir) : 'unknown'} direction. Precipitation probability: ${precipProb ?? 'unknown'}%.${ensoNote}`,
      maxTokens: 100,
      temperature: 0.1,
    });
    return result.content.trim();
  } catch (err) {
    console.warn('[enrichment] Weather summary generation failed, using fallback:', err);
    return fallback;
  }
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

// For tropical_storm events: project the storm's position 24h forward based on
// current track (movement direction + speed from NHC raw_data).
// Returns extra fields to merge into raw_data, or {} for non-storm events.
function buildStormProjection(event: RawDisasterEvent): Record<string, unknown> {
  if (event.event_type !== 'tropical_storm') return {};

  const movementDirDeg = event.raw_data['movement_dir_deg'];
  const movementSpeedKts = event.raw_data['movement_speed_knots'];

  if (typeof movementDirDeg !== 'number' || typeof movementSpeedKts !== 'number') return {};

  // Distance in 24h: speed (knots) × 1.852 km/knot × 24h
  const distanceKm = movementSpeedKts * 1.852 * 24;

  const { lat, lng } = event.coordinates;
  const { lat: projLat, lng: projLng } = projectCoordinate(lat, lng, movementDirDeg, distanceKm);

  return {
    projected_24h_lat: Math.round(projLat * 1000) / 1000,
    projected_24h_lng: Math.round(projLng * 1000) / 1000,
    projected_24h_distance_km: Math.round(distanceKm),
  };
}

// Spherical Earth projection: given origin (lat/lng), bearing (degrees clockwise from N),
// and distance (km), returns the destination lat/lng.
function projectCoordinate(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceKm: number
): { lat: number; lng: number } {
  const R = 6_371; // Earth radius km
  const d = distanceKm / R;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

function bearingToCardinal(degrees: number): string {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
  return cardinals[index] ?? 'N';
}
