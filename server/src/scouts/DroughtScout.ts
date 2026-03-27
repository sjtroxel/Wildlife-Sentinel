import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FipsEntry {
  fips: string;
  name: string;
  lat: number;
  lng: number;
  habitat_notes: string;
}

const FIPS_LIST: FipsEntry[] = JSON.parse(
  readFileSync(join(__dirname, 'drought-fips.json'), 'utf8')
) as FipsEntry[];

const FIPS_MAP = new Map<string, FipsEntry>(FIPS_LIST.map(f => [f.fips, f]));

interface DroughtRow {
  FIPS: string;
  State: string;
  County: string;
  None: string;
  D0: string;
  D1: string;
  D2: string;
  D3: string;
  D4: string;
  ValidStart: string;
  ValidEnd: string;
}

// Returns the date of the most recent Thursday in YYYY-MM-DD format.
// Drought Monitor publishes every Thursday ~10 AM CT.
function getMostRecentThursdayDate(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun ... 4=Thu ... 6=Sat
  const daysToSubtract = (day + 7 - 4) % 7;
  const thursday = new Date(now.getTime() - daysToSubtract * 86_400_000);
  return thursday.toISOString().slice(0, 10);
}

export class DroughtScout extends BaseScout {
  constructor() {
    super({
      name: 'drought_monitor',
      dedupTtlSeconds: 7 * 86_400, // 7 days — weekly cadence, dedup within the week
      maxConsecutiveFailures: 3,
      circuitOpenMinutes: 60,      // longer reset — data only changes weekly
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const date = getMostRecentThursdayDate();
    const url =
      `https://droughtmonitor.unl.edu/DmData/GISData.aspx` +
      `?mode=table&aoi=county&statistic=0&date=${date}`;

    const res = await fetchWithRetry(url);
    const csvText = await res.text();

    if (!csvText.trim()) return [];

    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as DroughtRow[];

    const events: RawDisasterEvent[] = [];

    for (const row of rows) {
      // Pad FIPS to 5 digits (some states have leading zeros stripped)
      const fips = row.FIPS.padStart(5, '0');

      // Only process counties we know have IUCN habitat nearby
      const county = FIPS_MAP.get(fips);
      if (!county) continue;

      const d3 = parseFloat(row.D3);
      const d4 = parseFloat(row.D4);

      // Only publish D3 (Extreme) or D4 (Exceptional) drought
      if ((isNaN(d3) || d3 <= 0) && (isNaN(d4) || d4 <= 0)) continue;

      const d3Safe = isNaN(d3) ? 0 : d3;
      const d4Safe = isNaN(d4) ? 0 : d4;
      const severity = Math.min((d3Safe + d4Safe) / 100, 1.0);

      // ID includes ValidStart so the same drought reading won't re-publish after dedup expires
      const eventId = `drought_${fips}_${row.ValidStart}`;

      events.push({
        id: eventId,
        source: 'drought_monitor',
        event_type: 'drought',
        coordinates: { lat: county.lat, lng: county.lng },
        severity,
        timestamp: new Date().toISOString(),
        raw_data: {
          fips,
          state: row.State,
          county: row.County,
          d3_percent: d3Safe,
          d4_percent: d4Safe,
          valid_start: row.ValidStart,
          valid_end: row.ValidEnd,
        },
      });
    }

    return events;
  }
}
