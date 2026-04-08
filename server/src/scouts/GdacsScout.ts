import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const GDACS_TC_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/TC';

// Saffir-Simpson Category 5 thresholds — same scale as NhcScout
const CAT5_KNOTS = 137;
const CAT5_KMH = 254; // ≈ CAT5_KNOTS * 1.852

interface GDACSSeverity {
  value: number;
  unit: string; // "Knots" | "Km/h"
}

interface GDACSProperties {
  eventtype: string;
  eventid: number;
  episodeid: number;
  eventname: string;
  alertlevel: string;   // "Green" | "Orange" | "Red"
  severity: GDACSSeverity;
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

function normalizeWindSeverity(severity: GDACSSeverity): number {
  const { value, unit } = severity;
  if (!value || value <= 0) return 0;
  const normalizer = unit.toLowerCase().includes('km') ? CAT5_KMH : CAT5_KNOTS;
  return Math.min(value / normalizer, 1.0);
}

export class GdacsScout extends BaseScout {
  constructor() {
    super({
      name: 'gdacs',
      dedupTtlSeconds: 12 * 3_600, // 12h — GDACS publishes multiple updates per day
      maxConsecutiveFailures: 5,
      circuitOpenMinutes: 30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const res = await fetchWithRetry(GDACS_TC_URL);
    const data = await res.json() as GDACSResponse;

    const features: GDACSFeature[] = data.features ?? [];
    const events: RawDisasterEvent[] = [];

    for (const feature of features) {
      const props = feature.properties;

      // API should only return TC, but guard defensively
      if (props.eventtype !== 'TC') continue;

      // Skip events with no valid wind data
      if (!props.severity?.value || props.severity.value <= 0) continue;

      // GeoJSON coordinates are [lng, lat]
      const [lng, lat] = feature.geometry.coordinates;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      if (isNaN(lat) || isNaN(lng)) continue;

      // episodeid increments with each advisory update — tracks storm track changes
      const eventId = `gdacs_${props.eventid}_ep${props.episodeid}`;

      let timestamp: string;
      try {
        const dateStr = props.datemodified ?? props.todate ?? props.fromdate;
        timestamp = new Date(dateStr).toISOString();
      } catch {
        timestamp = new Date().toISOString();
      }

      events.push({
        id: eventId,
        source: 'gdacs',
        event_type: 'tropical_storm',
        coordinates: { lat, lng },
        severity: normalizeWindSeverity(props.severity),
        timestamp,
        raw_data: {
          storm_name: props.eventname,
          alert_level: props.alertlevel,
          max_wind_value: props.severity.value,
          max_wind_unit: props.severity.unit,
          episode_id: props.episodeid,
        },
      });
    }

    return events;
  }
}
