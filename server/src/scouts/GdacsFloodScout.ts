import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const GDACS_FL_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/FL';

// GDACS alertscore ranges 0–3 (composite severity score)
const GDACS_MAX_ALERT_SCORE = 3;

// Fallback severity when alertscore is absent — mapped from alert level
const ALERT_LEVEL_SEVERITY: Record<string, number> = {
  green:  0.25,
  orange: 0.60,
  red:    0.90,
};

interface GDACSSeverity {
  value: number;
  unit: string;
}

interface GDACSProperties {
  eventtype: string;
  eventid: number;
  episodeid: number;
  eventname: string;
  alertlevel: string;   // "Green" | "Orange" | "Red"
  alertscore?: number;  // 0–3 composite score
  severity?: GDACSSeverity;
  country?: string;
  fromdate: string;
  todate?: string;
  datemodified?: string;
}

interface GDACSFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number]; // GeoJSON order: [lng, lat]
  };
  properties: GDACSProperties;
}

interface GDACSResponse {
  features: GDACSFeature[];
}

function normalizeSeverity(props: GDACSProperties): number {
  if (typeof props.alertscore === 'number' && props.alertscore > 0) {
    return Math.min(props.alertscore / GDACS_MAX_ALERT_SCORE, 1.0);
  }
  return ALERT_LEVEL_SEVERITY[props.alertlevel.toLowerCase()] ?? 0.25;
}

export class GdacsFloodScout extends BaseScout {
  constructor() {
    super({
      name: 'gdacs_flood',
      dedupTtlSeconds: 12 * 3_600, // 12h — GDACS updates active floods multiple times per day
      maxConsecutiveFailures: 5,
      circuitOpenMinutes: 30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const res = await fetchWithRetry(GDACS_FL_URL);
    const data = await res.json() as GDACSResponse;

    const features: GDACSFeature[] = data.features ?? [];
    const events: RawDisasterEvent[] = [];

    for (const feature of features) {
      const props = feature.properties;

      // API should only return FL, but guard defensively
      if (props.eventtype !== 'FL') continue;

      // Skip events with no usable severity
      const severity = normalizeSeverity(props);
      if (severity <= 0) continue;

      // GeoJSON coordinates are [lng, lat]
      const [lng, lat] = feature.geometry.coordinates;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      if (isNaN(lat) || isNaN(lng)) continue;

      // episodeid increments with each advisory update
      const eventId = `gdacs_fl_${props.eventid}_ep${props.episodeid}`;

      let timestamp: string;
      try {
        const dateStr = props.datemodified ?? props.todate ?? props.fromdate;
        timestamp = new Date(dateStr).toISOString();
      } catch {
        timestamp = new Date().toISOString();
      }

      events.push({
        id: eventId,
        source: 'gdacs_flood',
        event_type: 'flood',
        coordinates: { lat, lng },
        severity,
        timestamp,
        raw_data: {
          event_name: props.eventname,
          alert_level: props.alertlevel,
          alert_score: props.alertscore ?? null,
          country: props.country ?? null,
          episode_id: props.episodeid,
          severity_value: props.severity?.value ?? null,
          severity_unit: props.severity?.unit ?? null,
        },
      });
    }

    return events;
  }
}
