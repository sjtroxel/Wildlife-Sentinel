import { createRequire } from 'module';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
const MPA_REGIONS = require('./mpaRegions.json') as MpaRegionsFile;

// Global Fishing Watch Events API v3.
// Tracks AIS transponder data for fishing vessels worldwide.
const GFW_EVENTS_BASE = 'https://gateway.api.globalfishingwatch.org/v3/events';

// Any vessel detected inside an MPA is flagged — MPAs prohibit commercial fishing.
const MIN_VESSEL_COUNT = 1;

// 10+ unique vessels in one MPA = maximum severity.
const MAX_VESSELS_FOR_SEVERITY = 10;

interface MpaRegion {
  id: string;
  wdpa_id: string;
  name: string;
  country: string;
  iucn_category: string;
  centroid: { lat: number; lng: number };
  radius_km: number;
  key_species: string[];
}

interface MpaRegionsFile {
  mpas: MpaRegion[];
}

interface GfwVesselEvent {
  id: string;
  type: string;
  position: { lat: number; lon: number };
  start: string;
  end: string;
  vessel: {
    id: string;
    ssvid: string;
    flag: string;
  };
}

interface GfwEventsResponse {
  entries: GfwVesselEvent[];
  total: number;
}

/**
 * Returns the Monday of the ISO week containing `date` as a compact YYYYMMDD string.
 * Events fired during the same week for the same MPA share the same dedup key —
 * prevents daily spam when vessels persistently fish in an area all week.
 */
function weekStartKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export class GfwFishingScout extends BaseScout {
  constructor() {
    super({
      name: 'gfw_fishing',
      dedupTtlSeconds: 7 * 24 * 3_600, // 7 days — weekly dedup per MPA
      maxConsecutiveFailures: 3,
      circuitOpenMinutes: 120,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    if (!config.fishingWatchApiKey) {
      console.warn('[gfw_fishing] FISHING_WATCH_API_KEY not set — skipping run');
      return [];
    }

    const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const weekKey = weekStartKey(new Date());
    const events: RawDisasterEvent[] = [];

    for (const mpa of MPA_REGIONS.mpas) {
      const url =
        `${GFW_EVENTS_BASE}` +
        `?datasets[0]=public-global-fishing-events:latest` +
        `&start-date=${yesterday}` +
        `&end-date=${today}` +
        `&latitude=${mpa.centroid.lat}` +
        `&longitude=${mpa.centroid.lng}` +
        `&radius=${mpa.radius_km}` +
        `&limit=200`;

      let body: GfwEventsResponse;
      try {
        const res = await fetchWithRetry(url, {
          headers: { Authorization: `Bearer ${config.fishingWatchApiKey}` },
        });
        body = await res.json() as GfwEventsResponse;
      } catch (err) {
        console.warn(`[gfw_fishing] Fetch failed for ${mpa.id}:`, err);
        continue;
      }

      const entries = body.entries ?? [];
      const uniqueVessels = new Set(entries.map(e => e.vessel.id));
      const vesselCount = uniqueVessels.size;

      if (vesselCount < MIN_VESSEL_COUNT) continue;

      const eventId = `gfw_fishing_${mpa.id}_${weekKey}`;
      const severity = Math.min(vesselCount / MAX_VESSELS_FOR_SEVERITY, 1.0);

      events.push({
        id: eventId,
        source: 'gfw_fishing',
        event_type: 'illegal_fishing',
        coordinates: { lat: mpa.centroid.lat, lng: mpa.centroid.lng },
        severity,
        timestamp: new Date(`${yesterday}T12:00:00Z`).toISOString(),
        raw_data: {
          mpa_id: mpa.id,
          mpa_name: mpa.name,
          country: mpa.country,
          iucn_category: mpa.iucn_category,
          vessel_count: vesselCount,
          vessel_flags: [...new Set(entries.map(e => e.vessel.flag))],
          key_species: mpa.key_species,
          query_date: yesterday,
          radius_km: mpa.radius_km,
          data_source: 'Global Fishing Watch Events API v3',
        },
      });
    }

    return events;
  }
}
