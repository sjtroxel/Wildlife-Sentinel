import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const NHC_CURRENT_STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';

// Category 5 hurricane = 137+ knots — used for severity normalization
const CATEGORY_5_KNOTS = 137;

interface NHCStorm {
  id: string;
  name: string;
  classification: string;  // "TD", "TS", "HU", "EX"
  intensity: string;        // max sustained wind in knots
  pressure: string;         // central pressure in mb
  latitude: string;         // e.g. "18.5N"
  longitude: string;        // e.g. "72.3W"
  movementDir: string;      // degrees storm is moving TOWARD
  movementSpeed: string;    // knots
  lastUpdate: string;
  publicAdvisory: { advNum: string };
}

interface NHCResponse {
  activeStorms: NHCStorm[];
}

function parseLatLng(lat: string, lng: string): { lat: number; lng: number } {
  const parsedLat = lat.endsWith('S')
    ? -parseFloat(lat.replace('S', ''))
    : parseFloat(lat.replace('N', ''));
  const parsedLng = lng.endsWith('W')
    ? -parseFloat(lng.replace('W', ''))
    : parseFloat(lng.replace('E', ''));
  return { lat: parsedLat, lng: parsedLng };
}

export class NhcScout extends BaseScout {
  constructor() {
    super({
      name: 'noaa_nhc',
      dedupTtlSeconds: 12 * 3_600, // 12h — NHC issues advisories every 6h
      maxConsecutiveFailures: 5,
      circuitOpenMinutes: 30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const res = await fetchWithRetry(NHC_CURRENT_STORMS_URL);
    const data = await res.json() as NHCResponse;

    const storms: NHCStorm[] = data.activeStorms ?? [];
    const events: RawDisasterEvent[] = [];

    for (const storm of storms) {
      const windKnots = parseInt(storm.intensity, 10);
      if (isNaN(windKnots) || windKnots <= 0) continue;

      const { lat, lng } = parseLatLng(storm.latitude, storm.longitude);
      if (isNaN(lat) || isNaN(lng)) continue;

      const advNum = storm.publicAdvisory.advNum;

      // Include advisory number so each new advisory creates a distinct event,
      // allowing the pipeline to track storm track changes
      const eventId = `nhc_${storm.id}_adv${advNum}`;

      let timestamp: string;
      try {
        timestamp = new Date(storm.lastUpdate).toISOString();
      } catch {
        timestamp = new Date().toISOString();
      }

      events.push({
        id: eventId,
        source: 'noaa_nhc',
        event_type: 'tropical_storm',
        coordinates: { lat, lng },
        severity: Math.min(windKnots / CATEGORY_5_KNOTS, 1.0),
        timestamp,
        raw_data: {
          storm_name: storm.name,
          classification: storm.classification,
          max_wind_knots: windKnots,
          central_pressure_mb: parseInt(storm.pressure, 10),
          movement_dir_deg: parseInt(storm.movementDir, 10),
          movement_speed_knots: parseInt(storm.movementSpeed, 10),
          advisory_number: advNum,
        },
      });
    }

    return events;
  }
}
