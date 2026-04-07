/**
 * Refiner / Evaluator Agent
 *
 * Scores the accuracy of Threat Assessment Agent predictions by comparing
 * them against actual observed data from the same government APIs.
 * Scoring is fully deterministic (no LLM judgment).
 * When composite score < 0.60, Claude generates a correction note that is
 * prepended to the Threat Assessment Agent's system prompt.
 */
import { MODELS } from '@wildlife-sentinel/shared/models';
import type { RefinerScore } from '@wildlife-sentinel/shared/types';
import { sql } from '../db/client.js';
import { modelRouter } from '../router/ModelRouter.js';
import { getAgentPrompt } from '../db/agentPrompts.js';
import { logToWarRoom } from '../discord/warRoom.js';
import { fetchWithRetry } from '../scouts/BaseScout.js';
import { config } from '../config.js';
import {
  haversineDistance,
  haversineBearing,
  computePolygonCentroid,
  parseCSV,
  parseNHCLatLng,
  extractPredictedBearing,
  extractPredictedDistance,
  extractPredictedPercentChange,
  getMostRecentThursdayDateStr,
} from './geoUtils.js';

// ── DB record type ────────────────────────────────────────────────────────────

interface AlertRecord {
  id: string;
  event_type: string;
  source: string;
  coordinates: { lat: number; lng: number };
  prediction_data: { predicted_impact: string; reasoning?: string } | null;
  raw_data: Record<string, unknown> | null;
}

// ── NHC response types ────────────────────────────────────────────────────────

interface NHCStorm {
  id: string;
  name: string;
  intensity: string;     // max sustained wind knots
  latitude: string;      // e.g. "18.5N"
  longitude: string;     // e.g. "72.3W"
}

interface NHCResponse {
  activeStorms: NHCStorm[];
}

// ── USGS IV response types ────────────────────────────────────────────────────

interface USGSTimeSeries {
  values: Array<{ value: Array<{ value: string }> }>;
}

interface USGSResponse {
  value: { timeSeries: USGSTimeSeries[] };
}

// ── CRW response types ────────────────────────────────────────────────────────

interface CRWFeature {
  geometry: { coordinates: number[][][] };
  properties: { alert_level: number };
}

interface CRWResponse {
  features: CRWFeature[];
}

// ── Composite score helper ────────────────────────────────────────────────────

function toComposite(d: number, m: number): RefinerScore {
  return {
    directionAccuracy: d,
    magnitudeAccuracy: m,
    compositeScore: parseFloat((0.6 * d + 0.4 * m).toFixed(4)),
  };
}

// ── Fire scoring (NASA FIRMS) ─────────────────────────────────────────────────

async function scoreFirePrediction(
  alert: AlertRecord,
  evaluationHours: number
): Promise<RefinerScore | null> {
  const { lat, lng } = alert.coordinates;
  const lookbackDate = new Date(Date.now() - evaluationHours * 3_600_000)
    .toISOString()
    .slice(0, 10);

  // 1° × 1° bounding box — roughly 100×100 km at equator
  const bbox = `${lng - 0.5},${lat - 0.5},${lng + 0.5},${lat + 0.5}`;
  const firmsUrl =
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${config.nasaFirmsKey}` +
    `/VIIRS_SNPP_NRT/${bbox}/2/${lookbackDate}`;

  let csvText: string;
  try {
    const res = await fetchWithRetry(firmsUrl);
    csvText = await res.text();
  } catch {
    return null; // API unavailable
  }

  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    // Fire extinguished or no spread — partial score per spec
    return toComposite(0.5, 0.2);
  }

  const actualPoints = rows
    .map(r => ({
      lat: parseFloat(r['latitude'] ?? ''),
      lng: parseFloat(r['longitude'] ?? ''),
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng));

  if (actualPoints.length === 0) return toComposite(0.5, 0.2);

  // Centroid of actual fire detections
  const sumLat = actualPoints.reduce((s, p) => s + p.lat, 0);
  const sumLng = actualPoints.reduce((s, p) => s + p.lng, 0);
  const centroid = { lat: sumLat / actualPoints.length, lng: sumLng / actualPoints.length };

  const predictedText = alert.prediction_data?.predicted_impact ?? '';

  // Direction accuracy: how close is actual bearing to predicted bearing?
  const actualBearing = haversineBearing(alert.coordinates, centroid);
  const predictedBearing = extractPredictedBearing(predictedText);
  const angleDiff = Math.abs(actualBearing - predictedBearing);
  const normalizedAngle = Math.min(angleDiff, 360 - angleDiff); // 0–180
  const directionAccuracy = Math.max(0, 1 - normalizedAngle / 90);

  // Magnitude accuracy: actual spread distance vs predicted
  const actualDistanceKm = haversineDistance(alert.coordinates, centroid);
  const predictedDistanceKm = extractPredictedDistance(predictedText);
  const magnitudeAccuracy =
    predictedDistanceKm > 0 && actualDistanceKm > 0
      ? Math.min(actualDistanceKm, predictedDistanceKm) /
        Math.max(actualDistanceKm, predictedDistanceKm)
      : 0.5;

  return toComposite(directionAccuracy, magnitudeAccuracy);
}

// ── Storm scoring (NOAA NHC) ──────────────────────────────────────────────────

async function scoreStormPrediction(alert: AlertRecord): Promise<RefinerScore | null> {
  const stormName = alert.raw_data?.['storm_name'] as string | undefined;
  const originalWindKnots = alert.raw_data?.['max_wind_knots'] as number | undefined;

  let data: NHCResponse;
  try {
    const res = await fetchWithRetry('https://www.nhc.noaa.gov/CurrentStorms.json');
    data = await res.json() as NHCResponse;
  } catch {
    return null; // API unavailable
  }

  const storms: NHCStorm[] = data.activeStorms ?? [];

  // Match by name first (reliable), fall back to proximity
  let match = stormName
    ? storms.find(s => s.name.toLowerCase() === stormName.toLowerCase())
    : undefined;

  if (!match) {
    match = storms.find(s => {
      const pos = parseNHCLatLng(s.latitude, s.longitude);
      return !isNaN(pos.lat) && !isNaN(pos.lng) &&
        haversineDistance(pos, alert.coordinates) < 500;
    });
  }

  if (!match) {
    // Storm dissipated or moved beyond tracking range — conservative score
    return toComposite(0.4, 0.3);
  }

  // Direction: is the storm still near its original position? (0 km = 1.0, 500 km = 0)
  const actualPos = parseNHCLatLng(match.latitude, match.longitude);
  const distanceFromOrigin = haversineDistance(actualPos, alert.coordinates);
  const directionAccuracy = Math.max(0, 1 - distanceFromOrigin / 500);

  // Magnitude: actual vs original wind intensity ratio
  const actualKnots = parseInt(match.intensity, 10);
  const predictedKnots = originalWindKnots ?? actualKnots;
  const magnitudeAccuracy =
    !isNaN(actualKnots) && predictedKnots > 0 && actualKnots > 0
      ? Math.min(actualKnots, predictedKnots) / Math.max(actualKnots, predictedKnots)
      : 0.5;

  return toComposite(directionAccuracy, magnitudeAccuracy);
}

// ── Flood scoring (USGS NWIS IV) ─────────────────────────────────────────────

async function scoreFloodPrediction(alert: AlertRecord): Promise<RefinerScore | null> {
  const siteCode = alert.raw_data?.['site_code'] as string | undefined;
  const floodStageCfs = alert.raw_data?.['flood_stage_cfs'] as number | undefined;
  const originalPctAbove = alert.raw_data?.['percent_above_flood_stage'] as number | undefined;

  if (!siteCode || floodStageCfs == null || originalPctAbove == null) return null;

  const url =
    `https://waterservices.usgs.gov/nwis/iv/?sites=${siteCode}&parameterCd=00060&format=json`;

  let data: USGSResponse;
  try {
    const res = await fetchWithRetry(url);
    data = await res.json() as USGSResponse;
  } catch {
    return null;
  }

  const series = data.value?.timeSeries[0];
  const rawValue = series?.values[0]?.value[0]?.value;
  const currentDischargeCfs = rawValue != null ? parseFloat(rawValue) : NaN;
  if (isNaN(currentDischargeCfs)) return null;

  const currentPctAbove = ((currentDischargeCfs - floodStageCfs) / floodStageCfs) * 100;
  const predictedText = alert.prediction_data?.predicted_impact ?? '';

  // Direction: did flood go the right way?
  const predictedWorsening =
    /worsen|rise|increas|higher|upstream/i.test(predictedText);
  const actuallyWorsened = currentPctAbove > originalPctAbove;
  const directionAccuracy = predictedWorsening === actuallyWorsened ? 1.0 : 0.0;

  // Magnitude: actual change vs predicted percent change
  const predictedChangePct = extractPredictedPercentChange(predictedText) ?? 25;
  const actualChangePct = Math.abs(currentPctAbove - originalPctAbove);
  const magnitudeAccuracy =
    predictedChangePct > 0 && actualChangePct > 0
      ? Math.min(predictedChangePct, actualChangePct) /
        Math.max(predictedChangePct, actualChangePct)
      : 0.5;

  return toComposite(directionAccuracy, magnitudeAccuracy);
}

// ── Drought scoring (US Drought Monitor) ─────────────────────────────────────

async function scoreDroughtPrediction(alert: AlertRecord): Promise<RefinerScore | null> {
  const fips = alert.raw_data?.['fips'] as string | undefined;
  const originalD3 = alert.raw_data?.['d3_percent'] as number | undefined;
  const originalD4 = alert.raw_data?.['d4_percent'] as number | undefined;

  if (!fips || originalD3 == null || originalD4 == null) return null;

  const date = getMostRecentThursdayDateStr();
  const url =
    `https://droughtmonitor.unl.edu/DmData/GISData.aspx` +
    `?mode=table&aoi=county&statistic=0&date=${date}`;

  let csvText: string;
  try {
    const res = await fetchWithRetry(url);
    csvText = await res.text();
  } catch {
    return null;
  }

  const rows = parseCSV(csvText);
  // FIPS may be stored without leading zero in the CSV — pad both sides for comparison
  const county = rows.find(r => (r['FIPS'] ?? '').padStart(5, '0') === fips);
  if (!county) return null; // county not in dataset — data gap

  const newD3 = parseFloat(county['D3'] ?? '0');
  const newD4 = parseFloat(county['D4'] ?? '0');
  if (isNaN(newD3) || isNaN(newD4)) return null;

  // Direction: drought persisting/worsening is the expected outcome (we only alert on D3/D4)
  const actuallyWorsened = (newD3 + newD4) >= (originalD3 + originalD4);
  const directionAccuracy = actuallyWorsened ? 1.0 : 0.3; // partial credit if unchanged

  // Magnitude: how much did drought severity change?
  const severityChange = Math.abs((newD3 + newD4) - (originalD3 + originalD4));
  const magnitudeAccuracy = Math.min(severityChange / 20, 1.0); // 20% change = max score

  return toComposite(directionAccuracy, magnitudeAccuracy);
}

// ── Coral bleaching scoring (NOAA CRW) ───────────────────────────────────────

async function scoreCoralPrediction(alert: AlertRecord): Promise<RefinerScore | null> {
  const originalLevel = alert.raw_data?.['alert_level'] as number | undefined;
  if (originalLevel == null) return null;

  let data: CRWResponse;
  try {
    const res = await fetchWithRetry(
      'https://coralreefwatch.noaa.gov/vs/gauges/crw_vs_alert_areas.json'
    );
    data = await res.json() as CRWResponse;
  } catch {
    return null;
  }

  const features: CRWFeature[] = data.features ?? [];

  // Find the alert area closest to original coordinates (within 200 km)
  let currentLevel = 0;
  let closestDist = Infinity;

  for (const feature of features) {
    const ring = feature.geometry.coordinates[0];
    if (!ring || ring.length === 0) continue;
    const centroid = computePolygonCentroid(ring);
    const dist = haversineDistance(centroid, alert.coordinates);
    if (dist < 200 && dist < closestDist) {
      closestDist = dist;
      currentLevel = feature.properties.alert_level;
    }
  }

  // Still elevated = prediction correct that area was at risk
  const directionAccuracy = currentLevel >= originalLevel ? 1.0 : 0.5;
  // Level ratio — 0 if fully resolved (partial credit already in direction)
  const magnitudeAccuracy =
    currentLevel > 0
      ? Math.min(currentLevel, originalLevel) / Math.max(currentLevel, originalLevel)
      : 0.3;

  return toComposite(directionAccuracy, magnitudeAccuracy);
}

// ── Correction note generation ────────────────────────────────────────────────

async function generateCorrectionNote(
  alert: AlertRecord,
  score: RefinerScore,
  evaluationTime: string
): Promise<string> {
  const refinerPrompt = await getAgentPrompt('refiner');

  const response = await modelRouter.complete({
    model: MODELS.CLAUDE_HAIKU,
    systemPrompt: refinerPrompt,
    userMessage: [
      `Original prediction: "${alert.prediction_data?.predicted_impact ?? 'unknown'}"`,
      `Event type: ${alert.event_type} | Source: ${alert.source}`,
      `Evaluation window: ${evaluationTime}`,
      `Direction accuracy: ${score.directionAccuracy.toFixed(3)} (0=completely wrong, 1=perfect)`,
      `Magnitude accuracy: ${score.magnitudeAccuracy.toFixed(3)}`,
      `Composite score: ${score.compositeScore.toFixed(3)} (threshold: 0.60)`,
      ``,
      `Write a correction note to prepend to the Threat Assessment Agent's system prompt.`,
    ].join('\n'),
    maxTokens: 200,
    temperature: 0.3,
  });

  return response.content;
}

async function applySystemPromptCorrection(
  alert: AlertRecord,
  score: RefinerScore,
  evaluationTime: string
): Promise<string> {
  const correctionNote = await generateCorrectionNote(alert, score, evaluationTime);
  const existing = await getAgentPrompt('threat_assessment');

  // Cap at 2 prior corrections + 1 new = 3 total. Prevents unbounded input token growth.
  const parts = existing.split('\n\n---\n\n');
  const base = parts[parts.length - 1]!;
  const recentCorrections = parts.slice(0, -1).slice(-2);
  const updated = [correctionNote, ...recentCorrections, base].join('\n\n---\n\n');

  await sql`
    UPDATE agent_prompts
    SET system_prompt   = ${updated},
        version         = version + 1,
        last_updated_by = 'refiner',
        updated_at      = NOW()
    WHERE agent_name = 'threat_assessment'
  `;

  return correctionNote;
}

// ── Main evaluation entry point ───────────────────────────────────────────────

export async function runRefinerEvaluation(
  alertId: string,
  evaluationTime: '24h' | '48h' | 'weekly'
): Promise<void> {
  const rows = await sql<AlertRecord[]>`
    SELECT id, event_type, source, coordinates, prediction_data, raw_data
    FROM alerts
    WHERE id = ${alertId}
  `;

  const alert = rows[0];
  if (!alert) {
    console.warn(`[refiner] Alert ${alertId} not found — skipping`);
    return;
  }

  const evaluationHours = evaluationTime === '48h' ? 48 : 24;

  // Route to event-type-specific scorer
  let score: RefinerScore | null;
  switch (alert.event_type) {
    case 'wildfire':
      score = await scoreFirePrediction(alert, evaluationHours);
      break;
    case 'tropical_storm':
      score = await scoreStormPrediction(alert);
      break;
    case 'flood':
      score = await scoreFloodPrediction(alert);
      break;
    case 'drought':
      score = await scoreDroughtPrediction(alert);
      break;
    case 'coral_bleaching':
      score = await scoreCoralPrediction(alert);
      break;
    default:
      console.warn(`[refiner] Unknown event_type '${alert.event_type}' for alert ${alertId}`);
      return;
  }

  // Data unavailable — mark completed without scoring
  if (score === null) {
    console.warn(
      `[refiner] Data unavailable for ${alertId} (${alert.event_type}, ${evaluationTime}) — skipping`
    );
    return;
  }

  // Determine whether a correction note will be generated
  const needsCorrection = score.compositeScore < 0.60;
  let correctionNote: string | null = null;

  if (needsCorrection) {
    correctionNote = await applySystemPromptCorrection(alert, score, evaluationTime);
  }

  // Persist the score
  await sql`
    INSERT INTO refiner_scores
      (alert_id, evaluation_time, direction_accuracy, magnitude_accuracy,
       composite_score, correction_generated, correction_note)
    VALUES
      (${alertId}, ${evaluationTime}, ${score.directionAccuracy}, ${score.magnitudeAccuracy},
       ${score.compositeScore}, ${needsCorrection}, ${correctionNote})
  `;

  // Threshold-based Discord observability
  if (score.compositeScore < 0.30) {
    await logToWarRoom({
      agent: 'refiner',
      action: `Poor prediction score: ${score.compositeScore.toFixed(2)}`,
      detail: `${alert.event_type} alert ${alertId} @ ${evaluationTime} — correction applied`,
      level: 'warning',
    });
  } else if (score.compositeScore > 0.85) {
    await logToWarRoom({
      agent: 'refiner',
      action: `Strong prediction score: ${score.compositeScore.toFixed(2)}`,
      detail: `${alert.event_type} alert ${alertId} @ ${evaluationTime}`,
      level: 'info',
    });
  }

  console.log(
    `[refiner] ${alertId} | ${alert.event_type} | ${evaluationTime} ` +
    `| score: ${score.compositeScore.toFixed(3)} | correction: ${needsCorrection}`
  );
}
