import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

// M5.5 minimum — below this threshold habitat damage is minimal.
// M9.0 is the practical ceiling (largest recorded: M9.5 Chile 1960).
const MIN_MAGNITUDE = 5.5;
const MAX_MAGNITUDE = 9.0;
const SEVERITY_RANGE = MAX_MAGNITUDE - MIN_MAGNITUDE;

// USGS FDSN Event API — returns GeoJSON FeatureCollection.
// limit=100 covers a 15-min window comfortably (M5.5+ events average ~3/day globally).
const USGS_EQ_URL =
  `https://earthquake.usgs.gov/fdsnws/event/1/query` +
  `?format=geojson&minmagnitude=${MIN_MAGNITUDE}&limit=100&orderby=time`;

interface USGSProperties {
  mag: number;
  place: string;
  time: number;      // Unix ms
  updated: number;   // Unix ms
  url: string;
  alert: string | null;  // PAGER level: "green" | "yellow" | "orange" | "red" | null
  tsunami: number;   // 0 | 1
  sig: number;       // significance score 0–1000 (USGS internal)
  magType: string;   // "mww" | "mb" | "ml" | etc.
  title: string;
}

interface USGSFeature {
  type: string;
  id: string;
  properties: USGSProperties;
  geometry: {
    type: string;
    coordinates: [number, number, number];  // [lng, lat, depth_km]
  };
}

interface USGSResponse {
  type: string;
  features: USGSFeature[];
}

function normalizeMagnitude(mag: number): number {
  if (mag <= MIN_MAGNITUDE) return 0;
  return Math.min((mag - MIN_MAGNITUDE) / SEVERITY_RANGE, 1.0);
}

export class UsgsEarthquakeScout extends BaseScout {
  constructor() {
    super({
      name: 'usgs_earthquake',
      dedupTtlSeconds: 7 * 24 * 3_600,  // 7 days — earthquakes are unique point events
      maxConsecutiveFailures: 5,
      circuitOpenMinutes: 30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const res = await fetchWithRetry(USGS_EQ_URL);
    const data = await res.json() as USGSResponse;

    const features: USGSFeature[] = data.features ?? [];
    const events: RawDisasterEvent[] = [];

    for (const feature of features) {
      const props = feature.properties;

      // Guard: must have a valid magnitude
      if (typeof props.mag !== 'number' || isNaN(props.mag)) continue;
      if (props.mag < MIN_MAGNITUDE) continue;

      // GeoJSON coordinates: [lng, lat, depth_km]
      const [lng, lat, depthKm] = feature.geometry.coordinates;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      if (isNaN(lat) || isNaN(lng)) continue;

      const eventId = `usgs_eq_${feature.id}`;

      const timestamp = props.time
        ? new Date(props.time).toISOString()
        : new Date().toISOString();

      events.push({
        id: eventId,
        source: 'usgs_earthquake',
        event_type: 'earthquake',
        coordinates: { lat, lng },
        severity: normalizeMagnitude(props.mag),
        timestamp,
        raw_data: {
          magnitude: props.mag,
          mag_type: props.magType,
          place: props.place,
          depth_km: depthKm ?? null,
          pager_alert: props.alert ?? null,
          tsunami_warning: props.tsunami === 1,
          significance: props.sig,
          usgs_url: props.url,
        },
      });
    }

    return events;
  }
}
