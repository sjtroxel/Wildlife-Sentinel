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
 * Builds a GeoJSON Polygon bounding box for a circular MPA region.
 * GFW Events API supports `geometry` (GeoJSON) but not `public-mpa-all` as a region dataset.
 */
function buildBbox(lat: number, lng: number, radiusKm: number): { type: 'Polygon'; coordinates: number[][][] } {
  const latDeg = radiusKm / 111;
  const lngDeg = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - lngDeg, lat - latDeg],
      [lng + lngDeg, lat - latDeg],
      [lng + lngDeg, lat + latDeg],
      [lng - lngDeg, lat + latDeg],
      [lng - lngDeg, lat - latDeg],
    ]],
  };
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

    // Query the last 7 days — GFW fishing events have a 1–3 day processing lag from
    // AIS satellite relay. A 24h window consistently returns empty. The dedup key is
    // already weekly (weekStartKey), so each MPA fires at most once per week regardless
    // of how many days of data contain a match.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const weekKey = weekStartKey(new Date());
    const events: RawDisasterEvent[] = [];
    // Abort if >40% of MPAs fail — GFW is selectively flaky, so consecutive-failure
    // tracking resets on any success and never fires. Total rate is more reliable.
    let totalFailures = 0;
    const FAILURE_ABORT_THRESHOLD = Math.ceil(MPA_REGIONS.mpas.length * 0.4);

    for (const mpa of MPA_REGIONS.mpas) {
      // GFW Events API v3:
      // - limit/offset must be query params (body params → 422)
      // - dataset must be a specific version, not :latest (→ 422 "unsupported schema")
      // - public-mpa-all is a context-layer type, unsupported as a region filter (→ 422)
      //   Use geometry (GeoJSON bbox from centroid + radius) instead.
      const url = `${GFW_EVENTS_BASE}?limit=200&offset=0`;

      const postBody = JSON.stringify({
        datasets: ['public-global-fishing-events:v4.0'],
        startDate: sevenDaysAgo,
        endDate: today,
        geometry: buildBbox(mpa.centroid.lat, mpa.centroid.lng, mpa.radius_km),
      });

      let body: GfwEventsResponse;
      try {
        // GFW POST requests with GeoJSON bodies need more time — 20s timeout, 2 attempts.
        const res = await fetchWithRetry(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.fishingWatchApiKey}`,
            'Content-Type': 'application/json',
          },
          body: postBody,
        }, 2, 20_000);
        body = await res.json() as GfwEventsResponse;
      } catch (err) {
        totalFailures++;
        console.error(`[gfw_fishing] Fetch failed for ${mpa.id} (wdpa:${mpa.wdpa_id}):`, err);
        if (totalFailures >= FAILURE_ABORT_THRESHOLD) {
          throw new Error(`GFW API degraded — ${totalFailures}/${MPA_REGIONS.mpas.length} MPAs failed this run`);
        }
        continue;
      }

      // Warn if the API reports events exist but entries is empty — indicates a response
      // format mismatch (wrong key name). Log the raw body so we can inspect the shape.
      if (body.entries === undefined || body.entries === null) {
        console.warn(
          `[gfw_fishing] ${mpa.id}: entries field missing from response (total=${body.total}) — raw keys: ${Object.keys(body as unknown as Record<string, unknown>).join(', ')}`
        );
      }

      const entries = body.entries ?? [];
      const uniqueVessels = new Set(entries.map(e => e.vessel.id));
      const vesselCount = uniqueVessels.size;

      if (vesselCount === 0 && typeof body.total === 'number' && body.total > 0) {
        console.warn(`[gfw_fishing] ${mpa.id}: API reports total=${body.total} events but entries parsed as empty — possible response schema mismatch`);
      }

      if (vesselCount < MIN_VESSEL_COUNT) continue;

      const eventId = `gfw_fishing_${mpa.id}_${weekKey}`;
      const severity = Math.min(vesselCount / MAX_VESSELS_FOR_SEVERITY, 1.0);

      events.push({
        id: eventId,
        source: 'gfw_fishing',
        event_type: 'illegal_fishing',
        coordinates: { lat: mpa.centroid.lat, lng: mpa.centroid.lng },
        severity,
        timestamp: new Date().toISOString(),
        raw_data: {
          mpa_id: mpa.id,
          mpa_name: mpa.name,
          country: mpa.country,
          iucn_category: mpa.iucn_category,
          vessel_count: vesselCount,
          vessel_flags: [...new Set(entries.map(e => e.vessel.flag))],
          key_species: mpa.key_species,
          query_window: `${sevenDaysAgo} to ${today}`,
          radius_km: mpa.radius_km,
          data_source: 'Global Fishing Watch Events API v3',
        },
      });
    }

    console.log(
      `[gfw_fishing] Run complete: ${MPA_REGIONS.mpas.length} MPAs checked, ` +
      `${totalFailures} fetch failures, ` +
      `${events.length} fishing event(s) found`
    );
    return events;
  }
}
