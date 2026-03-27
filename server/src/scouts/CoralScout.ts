import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const CRW_ALERT_AREAS_URL =
  'https://coralreefwatch.noaa.gov/vs/gauges/crw_vs_alert_areas.json';

// 0=no stress, 1=watch, 2=warning, 3=alert1, 4=alert2
// Only publish warning and above
const MIN_ALERT_LEVEL = 2;

interface CRWProperties {
  alert_level: number;
  alert_label: string;
  max_dhw: number;   // degree heating weeks
}

interface CRWFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: CRWProperties;
}

interface CRWGeoJSON {
  type: 'FeatureCollection';
  features: CRWFeature[];
}

// Simple centroid: average of all polygon ring vertices [lng, lat]
function computeCentroid(ring: number[][]): { lat: number; lng: number } {
  let sumLng = 0;
  let sumLat = 0;
  for (const point of ring) {
    sumLng += point[0] ?? 0;
    sumLat += point[1] ?? 0;
  }
  return {
    lng: sumLng / ring.length,
    lat: sumLat / ring.length,
  };
}

export class CoralScout extends BaseScout {
  constructor() {
    super({
      name: 'coral_reef_watch',
      dedupTtlSeconds: 6 * 3_600, // 6h — matches CRW update frequency
      maxConsecutiveFailures: 5,
      circuitOpenMinutes: 30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const res = await fetchWithRetry(CRW_ALERT_AREAS_URL);
    const data = await res.json() as CRWGeoJSON;

    const features: CRWFeature[] = data.features ?? [];
    const events: RawDisasterEvent[] = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const feature of features) {
      const { alert_level, alert_label, max_dhw } = feature.properties;

      if (alert_level < MIN_ALERT_LEVEL) continue;

      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length === 0) continue;

      const { lat, lng } = computeCentroid(ring);
      if (isNaN(lat) || isNaN(lng)) continue;

      // ID is stable for the day — changes if alert level changes or moves
      const eventId = `coral_${lat.toFixed(2)}_${lng.toFixed(2)}_al${alert_level}_${today}`;

      events.push({
        id: eventId,
        source: 'coral_reef_watch',
        event_type: 'coral_bleaching',
        coordinates: { lat, lng },
        severity: alert_level / 4,
        timestamp: new Date().toISOString(),
        raw_data: {
          alert_level,
          alert_label,
          max_dhw,
          bleaching_watch: alert_level === 1,
          bleaching_warning: alert_level === 2,
          bleaching_alert_1: alert_level === 3,
          bleaching_alert_2: alert_level === 4,
        },
      });
    }

    return events;
  }
}
