import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const CRW_VS_POLYGONS_URL =
  'https://coralreefwatch.noaa.gov/product/vs/vs_polygons.json';

// 0=no stress, 1=watch, 2=warning, 3=alert1, 4=alert2
// Only publish warning and above
const MIN_ALERT_LEVEL = 2;

const ALERT_LABELS: Record<number, string> = {
  0: 'No Stress',
  1: 'Bleaching Watch',
  2: 'Bleaching Warning',
  3: 'Bleaching Alert Level 1',
  4: 'Bleaching Alert Level 2',
};

interface CRWProperties {
  name: string;
  date: string;
  sst: string;
  ssta: string;
  hs: string;
  dhw: string;      // degree heating weeks as string
  alert: string;    // alert level "0"–"4" as string
  gauge_page: string;
}

interface CRWFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };  // [lng, lat]
  properties: CRWProperties;
}

interface CRWGeoJSON {
  type: 'FeatureCollection';
  features: CRWFeature[];
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
    const res = await fetchWithRetry(CRW_VS_POLYGONS_URL);
    const data = await res.json() as CRWGeoJSON;

    const features: CRWFeature[] = data.features ?? [];
    const events: RawDisasterEvent[] = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const feature of features) {
      const alertLevel = parseInt(feature.properties.alert, 10);

      if (isNaN(alertLevel) || alertLevel < MIN_ALERT_LEVEL) continue;

      const [lng, lat] = feature.geometry.coordinates;
      if (lng === undefined || lat === undefined || isNaN(lat) || isNaN(lng)) continue;

      const maxDhw = parseFloat(feature.properties.dhw);

      // ID is stable for the day — changes if alert level changes
      const eventId = `coral_${lat.toFixed(2)}_${lng.toFixed(2)}_al${alertLevel}_${today}`;

      events.push({
        id: eventId,
        source: 'coral_reef_watch',
        event_type: 'coral_bleaching',
        coordinates: { lat, lng },
        severity: alertLevel / 4,
        timestamp: new Date().toISOString(),
        raw_data: {
          alert_level: alertLevel,
          alert_label: ALERT_LABELS[alertLevel] ?? `Alert Level ${alertLevel}`,
          max_dhw: isNaN(maxDhw) ? null : maxDhw,
          station_name: feature.properties.name,
          date: feature.properties.date,
          bleaching_watch: alertLevel === 1,
          bleaching_warning: alertLevel === 2,
          bleaching_alert_1: alertLevel === 3,
          bleaching_alert_2: alertLevel === 4,
        },
      });
    }

    return events;
  }
}
