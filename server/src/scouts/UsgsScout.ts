import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface UsgsSite {
  site_code: string;
  site_name: string;
  lat: number;
  lng: number;
  flood_stage_cfs: number;
  habitat_notes: string;
}

const SITES: UsgsSite[] = JSON.parse(
  readFileSync(join(__dirname, 'usgs-sites.json'), 'utf8')
) as UsgsSite[];

const SITE_MAP = new Map<string, UsgsSite>(SITES.map(s => [s.site_code, s]));

// USGS Instantaneous Values service
const USGS_IV_BASE = 'https://waterservices.usgs.gov/nwis/iv/';
// 00060 = streamflow discharge in cfs
const PARAMETER_CD = '00060';

interface USGSValue {
  value: string;
  dateTime: string;
}

interface USGSTimeSeries {
  sourceInfo: {
    siteCode: Array<{ value: string }>;
  };
  values: Array<{ value: USGSValue[] }>;
}

interface USGSResponse {
  value: {
    timeSeries: USGSTimeSeries[];
  };
}

export class UsgsScout extends BaseScout {
  constructor() {
    super({
      name: 'usgs_nwis',
      dedupTtlSeconds: 3_600, // 1h — flood conditions change fast, each reading is timestamped
      maxConsecutiveFailures: 5,
      circuitOpenMinutes: 30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const siteIds = SITES.map(s => s.site_code).join(',');

    const url = new URL(USGS_IV_BASE);
    url.searchParams.set('sites', siteIds);
    url.searchParams.set('parameterCd', PARAMETER_CD);
    url.searchParams.set('format', 'json');

    const res = await fetchWithRetry(url.toString());
    const data = await res.json() as USGSResponse;

    const timeSeries: USGSTimeSeries[] = data.value?.timeSeries ?? [];
    const events: RawDisasterEvent[] = [];

    for (const series of timeSeries) {
      const siteCode = series.sourceInfo.siteCode[0]?.value;
      if (!siteCode) continue;

      const site = SITE_MAP.get(siteCode);
      if (!site) continue;

      const latestValue = series.values[0]?.value[0];
      if (!latestValue) continue;

      const dischargeCfs = parseFloat(latestValue.value);
      if (isNaN(dischargeCfs) || dischargeCfs <= 0) continue;

      // Only publish when above flood stage
      if (dischargeCfs <= site.flood_stage_cfs) continue;

      const excessFraction = (dischargeCfs - site.flood_stage_cfs) / site.flood_stage_cfs;
      const severity = Math.min(excessFraction, 1.0);

      // ID includes date so the same flood-level reading at the same site won't
      // spam the pipeline — one event per gauge per day at flood stage
      const dateStr = latestValue.dateTime.slice(0, 10);
      const eventId = `usgs_${siteCode}_${dateStr}`;

      let timestamp: string;
      try {
        timestamp = new Date(latestValue.dateTime).toISOString();
      } catch {
        timestamp = new Date().toISOString();
      }

      events.push({
        id: eventId,
        source: 'usgs_nwis',
        event_type: 'flood',
        coordinates: { lat: site.lat, lng: site.lng },
        severity,
        timestamp,
        raw_data: {
          site_code: siteCode,
          site_name: site.site_name,
          discharge_cfs: dischargeCfs,
          flood_stage_cfs: site.flood_stage_cfs,
          percent_above_flood_stage: Math.round(excessFraction * 100),
        },
      });
    }

    return events;
  }
}
