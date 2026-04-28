/**
 * Pure geo math and text-extraction utilities for the Refiner/Evaluator.
 * No imports from project code or AI SDKs — fully unit-testable without mocks.
 */

// ── Haversine math ────────────────────────────────────────────────────────────

/** Returns the great-circle distance between two points in kilometres. */
export function haversineDistance(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

/**
 * Returns the destination point reached by travelling `distanceKm` along
 * `bearingDeg` (0–360°, clockwise from north) from `origin`.
 * Uses the spherical earth (Haversine) formula.
 */
export function computeDestination(
  origin: { lat: number; lng: number },
  bearingDeg: number,
  distanceKm: number
): { lat: number; lng: number } {
  const R = 6371;
  const δ = distanceKm / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (origin.lat * Math.PI) / 180;
  const λ1 = (origin.lng * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return {
    lat: (φ2 * 180) / Math.PI,
    lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/** Returns the initial bearing (0–360°, clockwise from north) from `from` to `to`. */
export function haversineBearing(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/**
 * Computes the centroid of a GeoJSON polygon ring.
 * Ring vertices are in [lng, lat] order (GeoJSON convention).
 * Returns { lat, lng }.
 */
export function computePolygonCentroid(ring: number[][]): { lat: number; lng: number } {
  if (ring.length === 0) return { lat: 0, lng: 0 };
  let sumLng = 0;
  let sumLat = 0;
  for (const point of ring) {
    sumLng += point[0] ?? 0;
    sumLat += point[1] ?? 0;
  }
  return { lng: sumLng / ring.length, lat: sumLat / ring.length };
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Parses a simple CSV string (header row + data rows) into an array of objects.
 * Handles basic fields only — no embedded newlines or quoted commas in values.
 * Returns [] on empty input or header-only input.
 */
export function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  const headerLine = lines[0];
  if (!headerLine || lines.length < 2) return [];

  const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const result: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (header) {
        row[header] = values[j] ?? '';
      }
    }
    result.push(row);
  }

  return result;
}

// ── NHC coordinate parsing ────────────────────────────────────────────────────

/**
 * Parses NHC storm coordinates like "18.5N" / "72.3W" into decimal degrees.
 * Returns NaN fields if the format is unrecognised.
 */
export function parseNHCLatLng(lat: string, lng: string): { lat: number; lng: number } {
  const parsedLat = lat.endsWith('S')
    ? -parseFloat(lat.replace('S', ''))
    : parseFloat(lat.replace('N', ''));
  const parsedLng = lng.endsWith('W')
    ? -parseFloat(lng.replace('W', ''))
    : parseFloat(lng.replace('E', ''));
  return { lat: parsedLat, lng: parsedLng };
}

// ── Prediction text extractors ────────────────────────────────────────────────

// Sorted longest-first so "NNW" matches before "N" or "W"
const DIRECTION_BEARINGS: [string, number][] = [
  ['north-northeast', 22.5],
  ['east-northeast', 67.5],
  ['east-southeast', 112.5],
  ['south-southeast', 157.5],
  ['south-southwest', 202.5],
  ['west-southwest', 247.5],
  ['west-northwest', 292.5],
  ['north-northwest', 337.5],
  ['northeast', 45],
  ['southeast', 135],
  ['southwest', 225],
  ['northwest', 315],
  ['north', 0],
  ['south', 180],
  ['east', 90],
  ['west', 270],
  ['nne', 22.5],
  ['ene', 67.5],
  ['ese', 112.5],
  ['sse', 157.5],
  ['ssw', 202.5],
  ['wsw', 247.5],
  ['wnw', 292.5],
  ['nnw', 337.5],
  ['ne', 45],
  ['se', 135],
  ['sw', 225],
  ['nw', 315],
];

/**
 * Extracts a bearing (0–360°) from free-form prediction text.
 * Matches cardinal and ordinal direction keywords.
 * Returns null if no direction keyword is found — callers must handle null
 * rather than assuming 0° (north), which would corrupt direction scoring.
 */
export function extractPredictedBearing(text: string): number | null {
  const lower = text.toLowerCase();
  for (const [keyword, bearing] of DIRECTION_BEARINGS) {
    if (lower.includes(keyword)) return bearing;
  }
  return null;
}

/**
 * Extracts a predicted spread distance (km) from free-form prediction text.
 * Matches patterns like "35km", "35 km", "40 kilometers".
 * Returns null if no numeric distance is found — callers must handle null
 * rather than assuming 25km, which would corrupt magnitude scoring.
 */
export function extractPredictedDistance(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometers?)/i);
  if (match) {
    const val = parseFloat(match[1] ?? '');
    if (!isNaN(val)) return val;
  }
  return null;
}

/**
 * Extracts a predicted percentage change from free-form text.
 * Matches patterns like "25%", "25 percent", "worsen by 25".
 * Returns null if no numeric value found.
 */
export function extractPredictedPercentChange(text: string): number | null {
  const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i);
  if (pctMatch) {
    const val = parseFloat(pctMatch[1] ?? '');
    if (!isNaN(val)) return val;
  }
  const byMatch = text.match(/(?:worsen|increase|rise|expand)\s+by\s+(\d+(?:\.\d+)?)/i);
  if (byMatch) {
    const val = parseFloat(byMatch[1] ?? '');
    if (!isNaN(val)) return val;
  }
  return null;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the next Thursday at 18:00 UTC.
 * If today is Thursday, returns NEXT Thursday (not today).
 * Used to schedule drought evaluations — Drought Monitor publishes on Thursdays.
 */
export function getNextThursday(): Date {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 4=Thu
  const daysUntil = ((4 - dayOfWeek + 7) % 7) || 7;
  const next = new Date(now.getTime() + daysUntil * 86_400_000);
  next.setUTCHours(18, 0, 0, 0);
  return next;
}

/**
 * Returns the most recent Thursday's date as a YYYY-MM-DD string.
 * If today is Thursday, returns today's date.
 * Used by the drought scorer to look up the latest published Drought Monitor data.
 */
export function getMostRecentThursdayDateStr(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 4=Thu
  const daysToSubtract = (dayOfWeek + 7 - 4) % 7;
  const thursday = new Date(now.getTime() - daysToSubtract * 86_400_000);
  return thursday.toISOString().slice(0, 10);
}
