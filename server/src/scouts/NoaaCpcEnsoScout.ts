import { createRequire } from 'module';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';
import { redis } from '../redis/client.js';

const require = createRequire(import.meta.url);
const IMPACT_ZONES = require('./ensoImpactZones.json') as EnsoImpactZones;

// NOAA Climate Prediction Center — Oceanic Niño Index (ONI)
// Updated monthly. No auth required.
const ONI_URL = 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt';

// Redis modifier key TTL: 35 days covers monthly update cadence with buffer.
const MODIFIER_TTL_SECONDS = 35 * 24 * 3_600;

// Dedup TTL: 28 days. Each zone fires at most once per calendar month per phase+tier.
const DEDUP_TTL_SECONDS = 28 * 24 * 3_600;

// ONI thresholds (°C). Same thresholds NOAA CPC uses for official declarations.
const TIER_THRESHOLDS = [
  { tier: 'extreme',  threshold: 2.0, severity: 0.95 },
  { tier: 'warning',  threshold: 1.5, severity: 0.75 },
  { tier: 'advisory', threshold: 1.0, severity: 0.55 },
  { tier: 'watch',    threshold: 0.5, severity: 0.35 },
] as const;

type Tier = typeof TIER_THRESHOLDS[number]['tier'];
type Phase = 'el_nino' | 'la_nina' | 'neutral';

interface ImpactZone {
  id: string;
  lat: number;
  lng: number;
  ecosystem: string;
  key_species: string[];
}

interface EnsoImpactZones {
  el_nino: ImpactZone[];
  la_nina: ImpactZone[];
}

interface PhaseResult {
  phase: Phase;
  tier: Tier | null;
  severity: number;
  oni: number;
}

/**
 * Parse NOAA CPC ONI ASCII file. Returns the most recent seasonal anomaly value.
 *
 * File format (space-delimited, variable whitespace):
 *   SEAS YR   TOTAL  CLIM  ANOM
 *   DJF  1950 24.83  26.14 -1.31
 *   JFM  1950 25.11  26.10 -0.99
 *   ...
 *
 * ANOM is the Niño 3.4 SST anomaly in °C — the ONI value.
 */
function parseMostRecentOni(text: string): number | null {
  const lines = text.split('\n');
  let latestAnom: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Split on whitespace
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    // First token is a seasonal code (3 letters, e.g. DJF, JFM), second is year (4 digits)
    const seasonCode = parts[0]!;
    const year = parseInt(parts[1]!, 10);
    if (!/^[A-Z]{3}$/.test(seasonCode) || isNaN(year) || year < 1950) continue;

    const anom = parseFloat(parts[4]!);
    if (isNaN(anom)) continue;
    if (Math.abs(anom) > 5.0) continue;  // sanity bound

    latestAnom = anom;
  }

  return latestAnom;
}

function classifyPhase(oni: number): PhaseResult {
  const absOni = Math.abs(oni);

  for (const { tier, threshold, severity } of TIER_THRESHOLDS) {
    if (absOni >= threshold) {
      const phase: Phase = oni > 0 ? 'el_nino' : 'la_nina';
      return { phase, tier, severity, oni };
    }
  }

  return { phase: 'neutral', tier: null, severity: 0, oni };
}

/** ISO calendar month string YYYYMM — used for monthly dedup key suffix. */
function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

export class NoaaCpcEnsoScout extends BaseScout {
  constructor() {
    super({
      name: 'noaa_cpc',
      dedupTtlSeconds: DEDUP_TTL_SECONDS,
      maxConsecutiveFailures: 3,
      circuitOpenMinutes: 120,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const res = await fetchWithRetry(ONI_URL, undefined, 3, 15_000);
    const text = await res.text();

    const oni = parseMostRecentOni(text);
    if (oni === null) {
      console.warn('[noaa_cpc] Could not parse ONI value from CPC data');
      return [];
    }

    const { phase, tier, severity, oni: oniValue } = classifyPhase(oni);

    // Always update the Redis modifier keys so EnrichmentAgent has fresh context.
    if (phase === 'neutral') {
      await redis.del('enso:current_phase');
      await redis.del('enso:oni_anomaly');
      console.log(`[noaa_cpc] ONI=${oniValue.toFixed(2)} — neutral, no fan-out events`);
      return [];
    }

    await redis.setex('enso:current_phase', MODIFIER_TTL_SECONDS, phase);
    await redis.setex('enso:oni_anomaly', MODIFIER_TTL_SECONDS, oniValue.toFixed(2));

    const zones: ImpactZone[] = phase === 'el_nino' ? IMPACT_ZONES.el_nino : IMPACT_ZONES.la_nina;
    const month = monthKey(new Date());
    const timestamp = new Date().toISOString();
    const phaseName = phase === 'el_nino' ? 'El Niño' : 'La Niña';

    console.log(`[noaa_cpc] ONI=${oniValue.toFixed(2)} — ${phaseName} ${tier} (severity=${severity}) — generating ${zones.length} zone events`);

    const events: RawDisasterEvent[] = zones.map(zone => ({
      id: `enso_${phase}_${tier}_${zone.id}_${month}`,
      source: 'noaa_cpc',
      event_type: 'climate_anomaly',
      coordinates: { lat: zone.lat, lng: zone.lng },
      severity,
      timestamp,
      raw_data: {
        phase,
        tier,
        oni_anomaly: oniValue,
        phase_label: phaseName,
        zone_id: zone.id,
        ecosystem: zone.ecosystem,
        key_species: zone.key_species,
        data_source: 'NOAA Climate Prediction Center — Oceanic Niño Index (ONI)',
      },
    }));

    return events;
  }
}
