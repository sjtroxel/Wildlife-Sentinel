import { createRequire } from 'module';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
const GLAD_REGIONS = require('./gladRegions.json') as GladRegions;

// GFW Integrated Alerts — daily aggregates by GADM ADM1 region.
// Uses GADM sequential integer IDs — see gladRegions.json for centroid lookup.
const GFW_BASE_URL =
  'https://data-api.globalforestwatch.org/dataset' +
  '/gadm__integrated_alerts__adm1_daily_alerts/latest/query';

// Minimum alert count per ADM1 region per day to generate an event.
// Below this threshold the signal is too weak to warrant a pipeline event.
const MIN_ALERT_COUNT = 50;

// Look back 48h to catch alerts from yesterday that may have published after our last run.
const LOOKBACK_HOURS = 48;

interface GladRegionEntry {
  lat: number;
  lng: number;
  name: string;
}

interface GladRegions {
  [iso: string]: { [adm1: string]: GladRegionEntry };
}

interface GFWAlertRow {
  iso: string;
  adm1: number;
  gfw_integrated_alerts__date: string;       // 'YYYY-MM-DD'
  gfw_integrated_alerts__confidence: string; // 'nominal' | 'high' | 'highest'
  alert__count: number;
  alert_area__ha: number;
}

interface GFWResponse {
  data: GFWAlertRow[];
  status: string;
}

// ADM1 aggregation key
interface RegionKey {
  iso: string;
  adm1: number;
  date: string;
}

interface AggregatedRegion {
  key: RegionKey;
  totalAlerts: number;
  totalAreaHa: number;
  confidence: 'high' | 'highest';
}

function severityFromConfidence(confidence: 'high' | 'highest'): number {
  return confidence === 'highest' ? 0.95 : 0.75;
}

function buildSql(lookbackDate: string): string {
  return [
    'SELECT iso, adm1,',
    'gfw_integrated_alerts__date,',
    'gfw_integrated_alerts__confidence,',
    'alert__count,',
    'alert_area__ha',
    'FROM data',
    `WHERE gfw_integrated_alerts__date >= '${lookbackDate}'`,
    "AND gfw_integrated_alerts__confidence IN ('high', 'highest')",
    'AND is__umd_regional_primary_forest_2001 = true',
    `AND alert__count >= ${MIN_ALERT_COUNT}`,
    'ORDER BY alert__count DESC',
    'LIMIT 500',
  ].join(' ');
}

export class GladDeforestationScout extends BaseScout {
  constructor() {
    super({
      name: 'glad_deforestation',
      dedupTtlSeconds: 7 * 24 * 3_600, // 7 days — keyed by (iso, adm1, date)
      maxConsecutiveFailures: 3,
      circuitOpenMinutes: 60,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const lookbackDate = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000)
      .toISOString()
      .slice(0, 10);

    const sql = buildSql(lookbackDate);
    const url = `${GFW_BASE_URL}?sql=${encodeURIComponent(sql)}`;

    const res = await fetchWithRetry(url, {
      headers: { 'x-api-key': config.gfwApiKey },
    });

    const body = await res.json() as GFWResponse;
    const rows: GFWAlertRow[] = body.data ?? [];

    // Aggregate rows by (iso, adm1, date) — multiple rows can exist per region
    // due to different overlay dimensions (protected areas, indigenous lands, etc.)
    const regionMap = new Map<string, AggregatedRegion>();

    for (const row of rows) {
      if (typeof row.iso !== 'string' || typeof row.adm1 !== 'number') continue;

      const confidence = row.gfw_integrated_alerts__confidence;
      if (confidence !== 'high' && confidence !== 'highest') continue;

      const mapKey = `${row.iso}:${row.adm1}:${row.gfw_integrated_alerts__date}`;
      const existing = regionMap.get(mapKey);

      if (!existing) {
        regionMap.set(mapKey, {
          key: { iso: row.iso, adm1: row.adm1, date: row.gfw_integrated_alerts__date },
          totalAlerts: row.alert__count,
          totalAreaHa: row.alert_area__ha,
          confidence,
        });
      } else {
        existing.totalAlerts += row.alert__count;
        existing.totalAreaHa += row.alert_area__ha;
        // Escalate to 'highest' if any row has it
        if (confidence === 'highest') existing.confidence = 'highest';
      }
    }

    const events: RawDisasterEvent[] = [];

    for (const region of regionMap.values()) {
      const { iso, adm1, date } = region.key;

      // Look up centroid from bundled GADM lookup
      const countryLookup = GLAD_REGIONS[iso];
      if (!countryLookup) {
        // Country not in our tropical forest lookup — skip
        continue;
      }

      const entry = countryLookup[String(adm1)];
      if (!entry) {
        // ADM1 region not mapped — skip
        continue;
      }

      // Date-stamped event ID: safe to reprocess same region on different days
      const compactDate = date.replace(/-/g, '');
      const eventId = `glad_${iso}_${adm1}_${compactDate}`;

      events.push({
        id: eventId,
        source: 'glad_deforestation',
        event_type: 'deforestation',
        coordinates: { lat: entry.lat, lng: entry.lng },
        severity: severityFromConfidence(region.confidence),
        timestamp: new Date(`${date}T12:00:00Z`).toISOString(),
        raw_data: {
          region_name: entry.name,
          iso_code: iso,
          adm1_code: adm1,
          alert_date: date,
          alert_count: region.totalAlerts,
          alert_area_ha: Math.round(region.totalAreaHa * 100) / 100,
          confidence: region.confidence,
          data_source: 'GFW Integrated Alerts (GLAD-L + GLAD-S2 + RADD)',
        },
      });
    }

    return events;
  }
}
