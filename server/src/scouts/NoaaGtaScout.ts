import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

// NOAA NCEI Climate at a Glance — global land+ocean 12-month rolling temperature anomaly.
// No API key required. Baseline: 1901–2000 average.
// New URL format (2025+): /access/monitoring/climate-at-a-glance/global/time-series/{area}/tavg/{variable}/{timescale}/{month}/{begin}-{end}.json
// timescale=12, month=0 → 12-month rolling average; December entry (key ending in '12') = annual average.
// Always request the prior year — annual data is only published after the year completes.
const NCEI_CAG_URL = (endYear: number) =>
  `https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series/globe/tavg/land_ocean/12/0/1880-${endYear}.json`;

// Thresholds in °C above the 1901–2000 baseline.
// The Paris Agreement target is +1.5°C. We're currently above it.
const TIERS = [
  { tier: 'critical',  threshold: 1.5, severity: 0.90 },
  { tier: 'warning',   threshold: 1.2, severity: 0.70 },
  { tier: 'advisory',  threshold: 0.9, severity: 0.50 },
  { tier: 'watch',     threshold: 0.6, severity: 0.30 },
] as const;

type GtaTier = typeof TIERS[number]['tier'];

// Ecosystems most acutely threatened by persistent global thermal anomaly.
// Coordinates point to the core range of the indicator species.
const THERMAL_IMPACT_ZONES = [
  {
    id: 'arctic_tundra',
    lat: 79.0, lng: -15.0,
    ecosystem: 'Arctic tundra',
    key_species: ['Ursus maritimus', 'Monodon monoceros', 'Rangifer tarandus'],
  },
  {
    id: 'antarctic_pack_ice',
    lat: -72.0, lng: -60.0,
    ecosystem: 'Antarctic pack ice',
    key_species: ['Aptenodytes forsteri', 'Hydrurga leptonyx', 'Lobodon carcinophaga'],
  },
  {
    id: 'indo_pacific_coral',
    lat: -5.0, lng: 145.0,
    ecosystem: 'Indo-Pacific coral triangle',
    key_species: ['Chelonia mydas', 'Eretmochelys imbricata', 'Rhincodon typus'],
  },
  {
    id: 'himalayan_alpine',
    lat: 28.5, lng: 84.0,
    ecosystem: 'Himalayan alpine zone',
    key_species: ['Panthera uncia', 'Ochotona princeps', 'Ailurus fulgens'],
  },
  {
    id: 'amazon_basin',
    lat: -5.0, lng: -60.0,
    ecosystem: 'Amazon basin',
    key_species: ['Panthera onca', 'Tapirus terrestris', 'Pteronura brasiliensis'],
  },
  {
    id: 'boreal_forest_belt',
    lat: 60.0, lng: -100.0,
    ecosystem: 'North American boreal forest',
    key_species: ['Rangifer tarandus caribou', 'Gulo gulo', 'Lynx canadensis'],
  },
] as const;

interface NceiResponse {
  description: { title: string; units: string; base_period: string };
  // Keys are YYYYMM strings; values are objects { anomaly: number } in the access/ API.
  data: Record<string, string | number | { anomaly: number }>;
}

/**
 * Parse the most recent annual anomaly from the NCEI 12-month rolling JSON.
 * Keys are YYYYMM — filter to December (MM=12) to get the annual average per year.
 */
function parseMostRecentAnomaly(body: NceiResponse): { year: number; anomaly: number } | null {
  const entries = Object.entries(body.data ?? {})
    .filter(([k]) => k.length === 6 && k.endsWith('12'))
    .map(([k, v]) => ({
      year: parseInt(k.substring(0, 4), 10),
      // New access/ API returns { anomaly: number }; old /cag/ API returned plain strings.
      anomaly: typeof v === 'object' && v !== null && 'anomaly' in v
        ? (v as { anomaly: number }).anomaly
        : parseFloat(String(v)),
    }))
    .filter(e => !isNaN(e.year) && !isNaN(e.anomaly) && e.year >= 1970 && Math.abs(e.anomaly) < 5)
    .sort((a, b) => b.year - a.year);

  return entries[0] ?? null;
}

function classifyAnomaly(anomaly: number): { tier: GtaTier; severity: number } | null {
  for (const t of TIERS) {
    if (anomaly >= t.threshold) return { tier: t.tier, severity: t.severity };
  }
  return null;
}

/** YYYYMM string for monthly dedup key. */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class NoaaGtaScout extends BaseScout {
  constructor() {
    super({
      name: 'noaa_gta',
      dedupTtlSeconds: 28 * 24 * 3_600, // 28 days — monthly signal, fire once per month per zone
      maxConsecutiveFailures: 3,
      circuitOpenMinutes: 120,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    // Use prior year — NCEI only publishes annual data after the year completes.
    const priorYear = new Date().getUTCFullYear() - 1;
    const url = NCEI_CAG_URL(priorYear);

    const res = await fetchWithRetry(url, undefined, 3, 15_000);
    const body = await res.json() as NceiResponse;

    const latest = parseMostRecentAnomaly(body);
    if (!latest) {
      console.warn('[noaa_gta] Could not parse anomaly from NCEI response');
      return [];
    }

    const classification = classifyAnomaly(latest.anomaly);
    if (!classification) {
      console.log(`[noaa_gta] Global anomaly ${latest.anomaly.toFixed(2)}°C (${latest.year}) — below watch threshold, no events`);
      return [];
    }

    const { tier, severity } = classification;
    const month = monthKey(new Date());
    const timestamp = new Date().toISOString();
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    console.log(`[noaa_gta] ${latest.year} anomaly: +${latest.anomaly.toFixed(2)}°C — ${tierLabel} tier → generating ${THERMAL_IMPACT_ZONES.length} zone events`);

    return THERMAL_IMPACT_ZONES.map(zone => ({
      id: `gta_${tier}_${zone.id}_${month}`,
      source: 'noaa_gta' as const,
      event_type: 'climate_anomaly' as const,
      coordinates: { lat: zone.lat, lng: zone.lng },
      severity,
      timestamp,
      raw_data: {
        anomaly_celsius: latest.anomaly,
        anomaly_year: latest.year,
        baseline: '1901–2000',
        tier,
        tier_label: tierLabel,
        ecosystem: zone.ecosystem,
        key_species: [...zone.key_species],
        paris_target_exceedance: latest.anomaly >= 1.5,
        data_source: 'NOAA NCEI Climate at a Glance — Global Land+Ocean',
      },
    }));
  }
}
