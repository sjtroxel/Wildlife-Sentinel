/**
 * Refiner / Evaluator Agent
 *
 * Scores the accuracy of Threat Assessment Agent predictions by comparing
 * them against actual observed data from the same government APIs.
 * Scoring is fully deterministic (no LLM judgment).
 * When composite score < 0.60, Claude generates a correction note that is
 * prepended to the Threat Assessment Agent's system prompt.
 */
import { XMLParser } from 'fast-xml-parser';
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
  raw_event_id: string;
  event_type: string;
  source: string;
  created_at: string;
  coordinates: { lat: number; lng: number };
  prediction_data: { predicted_impact: string; reasoning?: string } | null;
  raw_data: Record<string, unknown> | null;
}

// ── GDACS RSS response types ──────────────────────────────────────────────────

interface GdacsRssItem {
  'gdacs:eventid'?:    number | string;
  'gdacs:alertlevel'?: string;
  'gdacs:alertscore'?: number | string;
}

// ── USGS aftershock response type ─────────────────────────────────────────────

interface USGSAftershockResponse {
  features?: Array<{ properties: { mag: number } }>;
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
  geometry: { coordinates: [number, number] }; // [lng, lat] Point
  properties: { alert: string };               // "0"–"4" as string
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
  const { lat, lng } = alert.coordinates ?? {};
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    console.warn(`[refiner] Alert ${alert.id} has invalid coordinates (${lat}, ${lng}) — skipping FIRMS fetch`);
    return null;
  }

  const lookbackDate = new Date(Date.now() - evaluationHours * 3_600_000)
    .toISOString()
    .slice(0, 10);

  // Wider box for 48h evaluations — fire can spread >100km from origin in 2 days
  const halfDeg = evaluationHours >= 48 ? 1.0 : 0.75;
  const bbox = `${lng - halfDeg},${lat - halfDeg},${lng + halfDeg},${lat + halfDeg}`;
  const firmsUrl =
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${config.nasaFirmsKey}` +
    `/VIIRS_SNPP_NRT/${bbox}/2/${lookbackDate}`;

  let csvText: string;
  try {
    const res = await fetchWithRetry(firmsUrl);
    csvText = await res.text();
  } catch (err) {
    console.error(`[refiner] FIRMS fetch failed (${alert.id}):`, err);
    return null;
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

  const predictedText = alert.prediction_data?.predicted_impact ?? '';
  const predictedBearing = extractPredictedBearing(predictedText);
  const predictedDistanceKm = extractPredictedDistance(predictedText);

  // Separate detections by proximity: "proximal" = still at original burn site,
  // "distal" = active spread front (the part we actually want to score direction against).
  const SPREAD_MIN_KM = 5;
  const distalPoints = actualPoints.filter(
    p => haversineDistance(alert.coordinates, p) > SPREAD_MIN_KM
  );

  // Direction: use centroid of spread-front detections only.
  // If no direction keyword in prediction, or fire didn't spread > 5km → neutral score.
  let directionAccuracy: number;
  if (predictedBearing === null || distalPoints.length === 0) {
    directionAccuracy = 0.5;
  } else {
    const spreadLat = distalPoints.reduce((s, p) => s + p.lat, 0) / distalPoints.length;
    const spreadLng = distalPoints.reduce((s, p) => s + p.lng, 0) / distalPoints.length;
    const actualBearing = haversineBearing(alert.coordinates, { lat: spreadLat, lng: spreadLng });
    const angleDiff = Math.abs(actualBearing - predictedBearing);
    const normalizedAngle = Math.min(angleDiff, 360 - angleDiff); // 0–180
    // Gentler decay: 0°→1.0, 45°→0.67, 90°→0.33, 135°→0
    directionAccuracy = Math.max(0, 1 - normalizedAngle / 135);
  }

  // Magnitude: use 90th-percentile distance to capture the fire front extent.
  // The centroid would be pulled back toward the original burn site cluster,
  // systematically underestimating how far the fire actually spread.
  const distances = actualPoints
    .map(p => haversineDistance(alert.coordinates, p))
    .sort((a, b) => a - b);
  const p90idx = Math.floor(distances.length * 0.9);
  const actualSpreadKm = distances[p90idx] ?? distances[distances.length - 1] ?? 0;

  const magnitudeAccuracy =
    predictedDistanceKm !== null && actualSpreadKm > 0
      ? Math.min(actualSpreadKm, predictedDistanceKm) /
        Math.max(actualSpreadKm, predictedDistanceKm)
      : 0.5; // no distance prediction → neutral

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
  } catch (err) {
    console.error(`[refiner] NHC fetch failed (${alert.id}):`, err);
    return null;
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
  } catch (err) {
    console.error(`[refiner] USGS NWIS fetch failed (${alert.id}):`, err);
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
  } catch (err) {
    console.error(`[refiner] Drought Monitor fetch failed (${alert.id}):`, err);
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
      'https://coralreefwatch.noaa.gov/product/vs/vs_polygons.json'
    );
    data = await res.json() as CRWResponse;
  } catch (err) {
    console.error(`[refiner] CRW fetch failed (${alert.id}):`, err);
    return null;
  }

  const features: CRWFeature[] = data.features ?? [];

  // Find the monitoring station closest to original coordinates (within 200 km)
  let currentLevel = 0;
  let closestDist = Infinity;

  for (const feature of features) {
    const [lng, lat] = feature.geometry.coordinates;
    if (lng === undefined || lat === undefined || isNaN(lat) || isNaN(lng)) continue;
    const dist = haversineDistance({ lat, lng }, alert.coordinates);
    if (dist < 200 && dist < closestDist) {
      closestDist = dist;
      currentLevel = parseInt(feature.properties.alert, 10) || 0;
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

// ── GDACS flood / drought scoring (GDACS RSS re-query) ───────────────────────

const GDACS_LEVEL_RANK: Record<string, number> = { green: 1, orange: 2, red: 3 };

const gdacsXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name: string) => name === 'item',
});

async function scoreGdacsPrediction(
  alert: AlertRecord,
  _evaluationHours: number,
): Promise<RefinerScore | null> {
  // raw_event_id format: "gdacs_fl_1103846_ep1" or "gdacs_dr_1018406_ep3"
  const match = alert.raw_event_id.match(/^gdacs_(?:fl|dr)_(\d+)_ep\d+/);
  if (!match) {
    console.warn(`[refiner] Cannot parse GDACS event ID from "${alert.raw_event_id}"`);
    return null;
  }
  const gdacsEventId = match[1]!;

  const originalLevel = (alert.raw_data?.['alert_level'] as string | undefined)?.toLowerCase() ?? 'green';
  const originalScore = parseFloat(String(alert.raw_data?.['alert_score'] ?? '0')) || 0;

  let rssText: string;
  try {
    const res = await fetchWithRetry('https://www.gdacs.org/xml/rss.xml');
    rssText = await res.text();
  } catch (err) {
    console.error(`[refiner] GDACS RSS fetch failed (${alert.raw_event_id}):`, err);
    return null;
  }

  // Quick check: is this event still reported in the active feed?
  if (!rssText.includes(`<gdacs:eventid>${gdacsEventId}</gdacs:eventid>`)) {
    // Event resolved within the evaluation window.
    // Conservative score: direction ambiguous without knowing what was predicted.
    return toComposite(0.5, 0.3);
  }

  // Parse current alert level and score for this specific event.
  let currentLevel = originalLevel;
  let currentScore = originalScore;

  try {
    const parsed = gdacsXmlParser.parse(rssText) as {
      rss?: { channel?: { item?: GdacsRssItem[] } };
    };
    const items: GdacsRssItem[] = parsed?.rss?.channel?.item ?? [];
    const item = items.find(it => String(it['gdacs:eventid'] ?? '') === gdacsEventId);
    if (item) {
      currentLevel = String(item['gdacs:alertlevel'] ?? originalLevel).toLowerCase();
      currentScore = parseFloat(String(item['gdacs:alertscore'] ?? originalScore)) || originalScore;
    }
  } catch {
    // XML parse failure — fall back to original values (conservative scoring)
  }

  const origRank = GDACS_LEVEL_RANK[originalLevel] ?? 1;
  const currRank = GDACS_LEVEL_RANK[currentLevel] ?? 1;

  // Wildlife threat predictions for active GDACS events assume ongoing threat.
  // Severity held or increased → prediction was correct.
  const directionAccuracy = currRank >= origRank ? 1.0 : 0.4;

  const magnitudeAccuracy =
    originalScore > 0 && currentScore > 0
      ? Math.min(currentScore, originalScore) / Math.max(currentScore, originalScore)
      : 0.5;

  return toComposite(directionAccuracy, magnitudeAccuracy);
}

// ── Earthquake scoring (USGS aftershock query) ────────────────────────────────

async function scoreEarthquakePrediction(
  alert: AlertRecord,
  evaluationHours: number,
): Promise<RefinerScore | null> {
  const { lat, lng } = alert.coordinates;

  // Use created_at as the approximate earthquake origin time.
  const originMs  = new Date(alert.created_at).getTime();
  // Start 1 min after origin to exclude the main shock itself.
  const startTime = new Date(originMs + 60_000).toISOString().slice(0, 19);
  const endTime   = new Date(originMs + evaluationHours * 3_600_000).toISOString().slice(0, 19);

  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${lat}&longitude=${lng}&maxradiuskm=150` +
    `&minmagnitude=5.0&starttime=${startTime}&endtime=${endTime}`;

  let data: USGSAftershockResponse;
  try {
    const res = await fetchWithRetry(url);
    data = await res.json() as USGSAftershockResponse;
  } catch (err) {
    console.error(`[refiner] USGS aftershock fetch failed (${alert.raw_event_id}):`, err);
    return null;
  }

  const aftershocks = data.features ?? [];
  const originalMag = parseFloat(String(alert.raw_data?.['magnitude'] ?? '5.5')) || 5.5;

  const predictedText = alert.prediction_data?.predicted_impact ?? '';
  const predictedOngoing = /aftershock|sequence|ongoing|continu|seismic|further|tremor/i.test(predictedText);
  const actuallyOngoing  = aftershocks.length > 0;

  // Direction: did seismic activity continue in line with the prediction?
  const directionAccuracy = predictedOngoing === actuallyOngoing ? 1.0 : 0.3;

  // Magnitude proxy: original earthquake M5.5–M8 normalized to 0.17–1.0.
  // Reflects confidence that the alert was warranted, not aftershock magnitude.
  const magnitudeAccuracy = Math.min(Math.max((originalMag - 5.0) / 3.0, 0.1), 1.0);

  return toComposite(directionAccuracy, magnitudeAccuracy);
}

// ── Illegal fishing scoring (GFW re-query) ────────────────────────────────────

interface GfwVerifyEntry { vessel: { id: string } }
interface GfwVerifyResponse { entries: GfwVerifyEntry[]; total: number }

async function scoreIllegalFishingPrediction(
  alert: AlertRecord,
): Promise<RefinerScore | null> {
  if (!config.fishingWatchApiKey) return null;

  const { lat, lng } = alert.coordinates ?? {};
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

  const radiusKm = (alert.raw_data?.['radius_km'] as number | undefined) ?? 50;
  const latDeg = radiusKm / 111;
  const lngDeg = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  let data: GfwVerifyResponse;
  try {
    const res = await fetchWithRetry(
      'https://gateway.api.globalfishingwatch.org/v3/events?limit=200&offset=0',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.fishingWatchApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          datasets: ['public-global-fishing-events:v4.0'],
          startDate: sevenDaysAgo,
          endDate: today,
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [lng - lngDeg, lat - latDeg],
              [lng + lngDeg, lat - latDeg],
              [lng + lngDeg, lat + latDeg],
              [lng - lngDeg, lat + latDeg],
              [lng - lngDeg, lat - latDeg],
            ]],
          },
        }),
      },
      2, 15_000,
    );
    data = await res.json() as GfwVerifyResponse;
  } catch (err) {
    console.warn(`[refiner] GFW re-query failed for ${alert.id} — skipping score:`, err);
    return null;
  }

  const currentVessels = new Set((data.entries ?? []).map(e => e.vessel.id)).size;
  const originalVessels = (alert.raw_data?.['vessel_count'] as number | undefined) ?? 0;

  // Persistent vessel presence → the alert's wildlife risk prediction was correct
  const directionAccuracy = currentVessels > 0 ? 0.8 : 0.4;
  const magnitudeAccuracy =
    originalVessels > 0 && currentVessels > 0
      ? Math.min(currentVessels, originalVessels) / Math.max(currentVessels, originalVessels)
      : 0.5;

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

  // Cap at 4 prior corrections + 1 new = 5 total. Enough context for the agent to
  // see a pattern without bloating the prompt unboundedly.
  const parts = existing.split('\n\n---\n\n');
  const base = parts[parts.length - 1]!;
  const recentCorrections = parts.slice(0, -1).slice(-4);
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
    SELECT id, raw_event_id, event_type, source, created_at, coordinates, prediction_data, raw_data
    FROM alerts
    WHERE id = ${alertId}
  `;

  const alert = rows[0];
  if (!alert) {
    console.warn(`[refiner] Alert ${alertId} not found — skipping`);
    return;
  }

  const evaluationHours = evaluationTime === '48h' ? 48 : 24;

  // Route to event-type-specific scorer.
  // Flood and drought branch on source: GDACS events lack USGS/FIPS gauge data,
  // so they use the GDACS RSS re-query scorer instead.
  let score: RefinerScore | null;
  switch (alert.event_type) {
    case 'wildfire':
      score = await scoreFirePrediction(alert, evaluationHours);
      break;
    case 'tropical_storm':
      score = await scoreStormPrediction(alert);
      break;
    case 'flood':
      score = alert.source.startsWith('gdacs')
        ? await scoreGdacsPrediction(alert, evaluationHours)
        : await scoreFloodPrediction(alert);
      break;
    case 'drought':
      score = alert.source.startsWith('gdacs')
        ? await scoreGdacsPrediction(alert, evaluationHours)
        : await scoreDroughtPrediction(alert);
      break;
    case 'earthquake':
      score = await scoreEarthquakePrediction(alert, evaluationHours);
      break;
    case 'coral_bleaching':
      score = await scoreCoralPrediction(alert);
      break;
    case 'illegal_fishing':
      score = await scoreIllegalFishingPrediction(alert);
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
