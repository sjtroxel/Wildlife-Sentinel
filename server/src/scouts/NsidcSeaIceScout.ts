import { createRequire } from 'module';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const require = createRequire(import.meta.url);
const CLIMATOLOGY = require('./seaIceClimatology.json') as SeaIceClimatology;

// NSIDC Near-Real-Time Sea Ice Index v3 — daily extent CSV.
// No API key required; data is publicly accessible.
const NSIDC_BASE =
  'https://noaadata.apps.nsidc.org/NOAA/G02135';

// v4.0 filenames — NSIDC updated from v3.0 in early 2026. v3.0 URLs return 404.
const NSIDC_FILE_VERSION = 'v4.0';

// Only alert when extent is this many standard deviations below the 1981–2010 median.
// -0.75σ ≈ bottom 22% historically — catches meaningful anomalies while avoiding noise.
// Recent Antarctic seasons have reached -3 to -4σ; this fires well before those extremes.
const SIGMA_THRESHOLD = -0.75;

// Coordinates representative of key species habitat in each polar region.
// EnrichmentAgent ST_DWithin queries will pick up polar species ranges from here.
const POLAR_COORDS = {
  north: { lat: 80.0, lng: 0.0 },   // Svalbard area — polar bear, Arctic fox, narwhal
  south: { lat: -73.0, lng: 0.0 },  // Weddell Sea area — emperor penguin, leopard seal
} as const;

type Hemisphere = 'north' | 'south';

interface ClimatologyEntry {
  median: number;
  stdDev: number;
}

interface SeaIceClimatology {
  north: Record<string, ClimatologyEntry>;
  south: Record<string, ClimatologyEntry>;
}

interface ParsedExtent {
  year: number;
  month: number;
  day: number;
  extentMkm2: number;  // million km²
}

/**
 * Parse the NSIDC daily extent CSV format:
 *   Year, Month, Day, Extent, Missing, Source Data
 *   1978,10,26,10.231,0.000,SMMR
 * Returns the most recent valid data row.
 */
function parseMostRecentExtent(csvText: string): ParsedExtent | null {
  const lines = csvText.split('\n');
  let latest: ParsedExtent | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(',');
    if (parts.length < 4) continue;

    const year = parseInt(parts[0]!.trim(), 10);
    if (isNaN(year) || year < 1978) continue;  // skip header/comment lines

    const month = parseInt(parts[1]!.trim(), 10);
    const day   = parseInt(parts[2]!.trim(), 10);
    const extent = parseFloat(parts[3]!.trim());

    if (isNaN(month) || isNaN(day) || isNaN(extent)) continue;
    if (extent < 0 || extent > 20) continue;  // sanity bounds (0–20 million km²)

    latest = { year, month, day, extentMkm2: extent };
  }

  return latest;
}

/**
 * ISO week Monday start date as YYYYMMDD string — used for weekly dedup.
 * Events fired during the same week for the same hemisphere share the same ID.
 */
function weekStartKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export class NsidcSeaIceScout extends BaseScout {
  constructor() {
    super({
      name: 'nsidc_sea_ice',
      dedupTtlSeconds: 7 * 24 * 3_600,  // 7 days — weekly dedup prevents daily spam during persistent anomaly
      maxConsecutiveFailures: 3,
      circuitOpenMinutes: 120,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const hemispheres: Hemisphere[] = ['north', 'south'];
    const events: RawDisasterEvent[] = [];

    for (const hemisphere of hemispheres) {
      const prefix = hemisphere === 'north' ? 'N' : 'S';
      const url = `${NSIDC_BASE}/${hemisphere}/daily/data/${prefix}_seaice_extent_daily_${NSIDC_FILE_VERSION}.csv`;

      const res = await fetchWithRetry(url, undefined, 3, 15_000);
      const csvText = await res.text();

      const parsed = parseMostRecentExtent(csvText);
      if (!parsed) {
        console.warn(`[nsidc_sea_ice] Could not parse ${hemisphere} extent CSV`);
        continue;
      }

      const clim = CLIMATOLOGY[hemisphere][String(parsed.month)];
      if (!clim) {
        console.warn(`[nsidc_sea_ice] No climatology for ${hemisphere} month ${parsed.month}`);
        continue;
      }

      const sigma = (parsed.extentMkm2 - clim.median) / clim.stdDev;

      if (sigma > SIGMA_THRESHOLD) {
        // Normal range — not anomalous enough to alert
        console.log(
          `[nsidc_sea_ice] ${hemisphere}: extent=${parsed.extentMkm2.toFixed(2)} Mkm² ` +
          `sigma=${sigma.toFixed(2)} — within normal range, no event`
        );
        continue;
      }

      const timestamp = new Date(
        Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0)
      ).toISOString();

      const weekKey = weekStartKey(new Date(timestamp));
      const eventId = `nsidc_${hemisphere}_${weekKey}`;

      // Severity: how many sigma below median, scaled so 3σ = 1.0
      const severity = Math.min(Math.abs(sigma) / 3.0, 1.0);

      const coords = POLAR_COORDS[hemisphere];

      events.push({
        id: eventId,
        source: 'nsidc_sea_ice',
        event_type: 'sea_ice_loss',
        coordinates: { lat: coords.lat, lng: coords.lng },
        severity,
        timestamp,
        raw_data: {
          hemisphere,
          extent_mkm2: parsed.extentMkm2,
          median_1981_2010: clim.median,
          std_dev_1981_2010: clim.stdDev,
          sigma_deviation: Math.round(sigma * 100) / 100,
          anomaly_mkm2: Math.round((parsed.extentMkm2 - clim.median) * 100) / 100,
          data_date: `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`,
          data_source: 'NSIDC Near-Real-Time Sea Ice Index v3',
        },
      });
    }

    return events;
  }
}
