# Phase 7 — Refiner / Evaluator Loop

**Goal:** The system improves its own threat assessment predictions over time. The Refiner is a first-class feature — it demonstrates autonomous self-improvement through prompt engineering. Prediction accuracy is tracked as a trend and displayed on the frontend.

**Status:** Not started
**Depends on:** Phase 5 complete (Phase 6 recommended but not required)
**Estimated sessions:** 2

---

## Overview

The Refiner/Evaluator Agent runs twice per fire/storm alert — at 24h and 48h after the original prediction. It:
1. Pulls the original prediction from the DB
2. Queries actual real-world data for those coordinates
3. Scores accuracy using deterministic math (no LLM judgment)
4. If score < 0.60: generates a Correction Note via Claude and prepends it to the Threat Assessment Agent's system prompt
5. Logs every score to `refiner_scores` for trend visualization

---

## 1. Database Tables

### `server/src/db/migrations/0005_refiner.sql`

```sql
-- Migration: 0005_refiner

-- Up

-- refiner_queue: scheduled evaluations (populated in Phase 5 for every fire/storm alert)
CREATE TABLE IF NOT EXISTS refiner_queue (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id         UUID        NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  evaluation_time  TEXT        NOT NULL CHECK (evaluation_time IN ('24h','48h')),
  run_at           TIMESTAMPTZ NOT NULL,
  completed        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refiner_queue_due
  ON refiner_queue (run_at) WHERE completed = FALSE;

-- refiner_scores: accuracy history per alert per evaluation window
CREATE TABLE IF NOT EXISTS refiner_scores (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id             UUID        NOT NULL REFERENCES alerts(id),
  evaluation_time      TEXT        NOT NULL,
  direction_accuracy   NUMERIC(5,4) NOT NULL,
  magnitude_accuracy   NUMERIC(5,4) NOT NULL,
  composite_score      NUMERIC(5,4) NOT NULL,   -- 0.6 * direction + 0.4 * magnitude
  correction_generated BOOLEAN     NOT NULL DEFAULT FALSE,
  correction_note      TEXT,
  evaluated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refiner_scores_alert ON refiner_scores (alert_id);
CREATE INDEX IF NOT EXISTS idx_refiner_scores_time ON refiner_scores (evaluated_at DESC);

-- Down
-- DROP TABLE IF EXISTS refiner_scores;
-- DROP TABLE IF EXISTS refiner_queue;
```

---

## 2. Refiner Cron Job

### `server/src/refiner/RefinerScheduler.ts`

Runs hourly and polls the `refiner_queue` table for due evaluations.

```typescript
import cron from 'node-cron';
import { sql } from '../db/client.js';
import { runRefinerEvaluation } from './RefinerAgent.js';
import { logToWarRoom } from '../discord/warRoom.js';

export function startRefinerScheduler(): void {
  // Poll for due evaluations every hour
  cron.schedule('0 * * * *', async () => {
    const due = await sql<{ id: string; alert_id: string; evaluation_time: string }[]>`
      SELECT id, alert_id, evaluation_time
      FROM refiner_queue
      WHERE run_at <= NOW()
        AND completed = FALSE
      ORDER BY run_at ASC
      LIMIT 10
    `;

    for (const item of due) {
      try {
        await runRefinerEvaluation(item.alert_id, item.evaluation_time as '24h' | '48h');
        await sql`UPDATE refiner_queue SET completed = TRUE WHERE id = ${item.id}`;
        console.log(`[refiner] Completed ${item.evaluation_time} evaluation for alert ${item.alert_id}`);
      } catch (err) {
        console.error(`[refiner] Evaluation failed for ${item.alert_id}:`, err);
        await logToWarRoom({ agent: 'refiner', action: 'Evaluation failed', detail: item.alert_id, level: 'warning' });
      }
    }
  });

  console.log('[refiner] Scheduler started (hourly poll)');
}
```

Add to `server.ts`: `import { startRefinerScheduler } from './refiner/RefinerScheduler.js'; startRefinerScheduler();`

---

## 3. Scoring Rubrics

### Fire Events (NASA FIRMS lookback)

The original prediction includes `predicted_impact` text like "Fire will spread NW 35km in next 24h". Parse bearing + distance from prediction text, then compare against actual FIRMS data.

```typescript
async function scoreFirePrediction(
  prediction: { predicted_impact: string; coordinates: { lat: number; lng: number } },
  evaluationHours: number
): Promise<RefinerScore> {
  const lookbackDate = new Date(Date.now() - evaluationHours * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { lat, lng } = prediction.coordinates;

  // Query actual FIRMS data for a 50km radius around original coordinates
  const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${config.nasaFirmsKey}/VIIRS_SNPP_NRT/${lng - 0.5},${lat - 0.5},${lng + 0.5},${lat + 0.5}/2/${lookbackDate}`;
  const res = await fetchWithRetry(firmsUrl);
  const csvText = await res.text();

  if (!csvText.trim() || csvText.split('\n').length <= 2) {
    // No fire data = fire extinguished or not spread = score based on predicted severity
    // If prediction was "will spread significantly" and fire is gone, that was wrong
    return { directionAccuracy: 0.5, magnitudeAccuracy: 0.2, compositeScore: 0.38 };
  }

  // Parse actual fire perimeter extent
  const rows = parseCSV(csvText);
  const actualPoints = rows.map(r => ({ lat: parseFloat(r.latitude), lng: parseFloat(r.longitude) }));

  // Find the centroid of actual fire extent
  const actualCentroid = {
    lat: actualPoints.reduce((s, p) => s + p.lat, 0) / actualPoints.length,
    lng: actualPoints.reduce((s, p) => s + p.lng, 0) / actualPoints.length,
  };

  // Direction accuracy: bearing from original to actual centroid vs predicted bearing
  const actualBearing = haversineBearing(prediction.coordinates, actualCentroid);
  const predictedBearing = extractPredictedBearing(prediction.predicted_impact);
  const angleDiff = Math.abs(actualBearing - predictedBearing);
  const normalizedAngle = Math.min(angleDiff, 360 - angleDiff); // 0-180
  const directionAccuracy = Math.max(0, 1 - normalizedAngle / 90); // 1 = within 10°, 0 = 90°+ off

  // Magnitude accuracy: actual spread distance vs predicted
  const actualDistanceKm = haversineDistance(prediction.coordinates, actualCentroid);
  const predictedDistanceKm = extractPredictedDistance(prediction.predicted_impact);
  const ratio = predictedDistanceKm > 0
    ? Math.min(actualDistanceKm, predictedDistanceKm) / Math.max(actualDistanceKm, predictedDistanceKm)
    : 0.5;
  const magnitudeAccuracy = ratio;

  const compositeScore = 0.6 * directionAccuracy + 0.4 * magnitudeAccuracy;
  return { directionAccuracy, magnitudeAccuracy, compositeScore };
}
```

### Storm Events (NOAA NHC lookback)

```typescript
// Original prediction: "Storm will make landfall near [city] within 36h"
// Actual: query NHC CurrentStorms.json 24h/48h later, check if storm tracked as predicted

async function scoreStormPrediction(prediction: AlertPrediction, evaluationHours: number): Promise<RefinerScore> {
  // Fetch current NHC data
  const res = await fetchWithRetry('https://www.nhc.noaa.gov/CurrentStorms.json');
  const data = await res.json() as { activeStorms: NHCStorm[] };

  // Find the original storm by matching rough coordinates
  const matchingStorm = data.activeStorms.find(s => {
    const { lat, lng } = parseLatLng(s.latitude, s.longitude);
    return haversineDistance({ lat, lng }, prediction.coordinates) < 500; // within 500km
  });

  if (!matchingStorm) {
    // Storm dissipated or moved far from predicted area
    // Compare against predicted timeline — was it expected to still exist?
    return { directionAccuracy: 0.4, magnitudeAccuracy: 0.3, compositeScore: 0.36 };
  }

  // Direction: how close is actual track to predicted track?
  const actualPos = parseLatLng(matchingStorm.latitude, matchingStorm.longitude);
  const distanceOffTrack = haversineDistance(actualPos, prediction.coordinates);

  // Normalize: 0km off = 1.0, 500km off = 0
  const directionAccuracy = Math.max(0, 1 - distanceOffTrack / 500);

  // Magnitude: did intensity match predicted category?
  const actualKnots = parseInt(matchingStorm.intensity);
  const predictedKnots = prediction.raw_data['max_wind_knots'] as number ?? actualKnots;
  const intensityRatio = Math.min(actualKnots, predictedKnots) / Math.max(actualKnots, predictedKnots);
  const magnitudeAccuracy = intensityRatio;

  const compositeScore = 0.6 * directionAccuracy + 0.4 * magnitudeAccuracy;
  return { directionAccuracy, magnitudeAccuracy, compositeScore };
}
```

### Flood Events (USGS gauge lookback)

```typescript
// Score: did flood stage actually worsen downstream as predicted?
// Query the same USGS gauge 24h later and compare stage levels
async function scoreFloodPrediction(prediction: AlertPrediction, evaluationHours: number): Promise<RefinerScore> {
  const siteCode = prediction.raw_data['site_code'] as string;
  const originalFloodPercent = prediction.raw_data['percent_above_flood_stage'] as number;

  const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${siteCode}&parameterCd=00060&format=json`;
  const res = await fetchWithRetry(url);
  const data = await res.json() as USGSResponse;
  const currentDischarge = parseCurrentDischarge(data);
  const floodStage = prediction.raw_data['flood_stage_cfs'] as number;
  const currentPercent = ((currentDischarge - floodStage) / floodStage) * 100;

  // Direction: did the flood go up or down? Compare prediction text sentiment.
  const predictedWorsening = prediction.predicted_impact.toLowerCase().includes('worsen') ||
                              prediction.predicted_impact.toLowerCase().includes('rise') ||
                              prediction.predicted_impact.toLowerCase().includes('increas');
  const actuallyWorsened = currentPercent > originalFloodPercent;
  const directionAccuracy = predictedWorsening === actuallyWorsened ? 1.0 : 0.0;

  // Magnitude: actual change vs predicted
  const predictedChangePercent = extractPredictedPercentChange(prediction.predicted_impact) ?? 25;
  const actualChangePercent = Math.abs(currentPercent - originalFloodPercent);
  const magnitudeAccuracy = actualChangePercent > 0
    ? Math.min(predictedChangePercent, actualChangePercent) / Math.max(predictedChangePercent, actualChangePercent)
    : 0.5;

  const compositeScore = 0.6 * directionAccuracy + 0.4 * magnitudeAccuracy;
  return { directionAccuracy, magnitudeAccuracy, compositeScore };
}
```

### Drought Events (Drought Monitor lookback)

```typescript
// Drought changes weekly — only evaluate 48h (next Thursday's data)
async function scoreDroughtPrediction(prediction: AlertPrediction): Promise<RefinerScore> {
  const nextThursday = getNextThursdayDate();
  const fips = prediction.raw_data['fips'] as string;

  const url = `https://droughtmonitor.unl.edu/DmData/GISData.aspx?mode=table&aoi=county&statistic=0&date=${nextThursday}`;
  const res = await fetchWithRetry(url);
  const csvText = await res.text();
  const rows = parseCSV(csvText);
  const county = rows.find(r => r.FIPS === fips);

  if (!county) return { directionAccuracy: 0.5, magnitudeAccuracy: 0.5, compositeScore: 0.5 };

  const newD3 = parseFloat(county.D3);
  const newD4 = parseFloat(county.D4);
  const originalD3 = prediction.raw_data['d3_percent'] as number;
  const originalD4 = prediction.raw_data['d4_percent'] as number;

  // Direction: did drought worsen (as implied by our alert)?
  const predictedWorsening = true; // We only alert on D3/D4 onset — implicit prediction of continued drought
  const actuallyWorsened = (newD3 + newD4) >= (originalD3 + originalD4);
  const directionAccuracy = actuallyWorsened ? 1.0 : 0.3; // Partial credit if unchanged (no improvement = still valid concern)

  // Magnitude: how much did it change?
  const severityChange = Math.abs((newD3 + newD4) - (originalD3 + originalD4));
  const magnitudeAccuracy = Math.min(severityChange / 20, 1.0); // 20% change = max score

  const compositeScore = 0.6 * directionAccuracy + 0.4 * magnitudeAccuracy;
  return { directionAccuracy, magnitudeAccuracy, compositeScore };
}
```

### Coral Bleaching Events

```typescript
// Score: did bleaching alert level escalate or persist?
// Query CRW alert areas at evaluation time and compare to original alert level
async function scoreCoralPrediction(prediction: AlertPrediction): Promise<RefinerScore> {
  const res = await fetchWithRetry('https://coralreefwatch.noaa.gov/vs/gauges/crw_vs_alert_areas.json');
  const data = await res.json() as { features: CRWAlertArea[] };

  // Find feature near original coordinates
  const matchingFeature = data.features.find(f => {
    const centroid = computeCentroid(f.geometry.coordinates[0]!);
    return haversineDistance(centroid, prediction.coordinates) < 200;
  });

  const originalLevel = prediction.raw_data['alert_level'] as number;
  const currentLevel = matchingFeature?.properties.alert_level ?? 0;

  const directionAccuracy = currentLevel >= originalLevel ? 1.0 : 0.5; // still elevated = correct
  const magnitudeAccuracy = currentLevel > 0 ? Math.min(currentLevel, originalLevel) / Math.max(currentLevel, originalLevel) : 0.3;
  const compositeScore = 0.6 * directionAccuracy + 0.4 * magnitudeAccuracy;

  return { directionAccuracy, magnitudeAccuracy, compositeScore };
}
```

---

## 4. Correction Note Generation

Only generated when `compositeScore < 0.60`:

```typescript
async function generateCorrectionNote(
  alert: AlertRecord,
  score: RefinerScore,
  evaluationTime: string
): Promise<string> {
  const refinerPrompt = await getAgentPrompt('refiner');

  const result = await modelRouter.complete({
    model: MODELS.CLAUDE_SONNET,
    systemPrompt: refinerPrompt,
    userMessage: `
Original prediction: "${alert.prediction_data?.predicted_impact}"
Event type: ${alert.event_type} | Source: ${alert.source}
Evaluation window: ${evaluationTime}
Direction accuracy: ${score.directionAccuracy.toFixed(3)} (0=completely wrong, 1=perfect)
Magnitude accuracy: ${score.magnitudeAccuracy.toFixed(3)}
Composite score: ${score.compositeScore.toFixed(3)} (threshold: 0.60)

Write a correction note to prepend to the Threat Assessment Agent's system prompt.
`,
    maxTokens: 200,
    temperature: 0.3,
  });

  return result.content;
}
```

### System Prompt Update

```typescript
const existing = await getAgentPrompt('threat_assessment');
const newPrompt = `${correctionNote}\n\n${existing}`;

await sql`
  UPDATE agent_prompts
  SET system_prompt = ${newPrompt},
      version = version + 1,
      last_updated_by = 'refiner',
      updated_at = NOW()
  WHERE agent_name = 'threat_assessment'
`;
```

### Score Threshold Actions

| Score Range | Action |
|---|---|
| < 0.30 | Generate correction note + post to #sentinel-ops as alert |
| 0.30 – 0.60 | Generate correction note, update system prompt |
| 0.60 – 0.85 | Log score only — prediction was acceptable |
| > 0.85 | Log success, post positive note to #sentinel-ops |

---

## 5. Unavailable Data Handling

When the evaluation API returns no data (scout was down, data gap, storm dissipated):

```typescript
// If actual data unavailable, skip scoring for this evaluation
// Do NOT score as 0 — that would unfairly penalize the agent for data gaps
if (!actualDataAvailable) {
  console.warn(`[refiner] No actual data available for ${alertId} at ${evaluationTime} — skipping evaluation`);
  await sql`UPDATE refiner_queue SET completed = TRUE, reason = 'data_unavailable' WHERE id = ${queueItemId}`;
  return;
}
```

---

## Acceptance Criteria

1. `refiner_queue` has 24h + 48h entries for every fire and tropical storm alert created in Phase 5
2. Hourly cron job polls queue and runs due evaluations
3. Scoring formulas produce 0–1 results for all 5 event types
4. `refiner_scores` table populated after each evaluation with all 4 fields
5. Correction notes generated for scores < 0.60 and stored in `refiner_scores.correction_note`
6. `agent_prompts.system_prompt` updated with correction prepended; `version` increments
7. `refiner_scores` queryable by `evaluated_at` showing score trend over time
8. Data-unavailable scenario handled gracefully (no false low scores)
9. Score trend visible in DB: `SELECT composite_score, evaluated_at FROM refiner_scores ORDER BY evaluated_at`

---

## Notes / Decisions Log

- Hourly polling of `refiner_queue` (not per-minute) — evaluation happens 24–48h after the event; the exact minute doesn't matter. Hourly granularity is fine.
- Scoring is fully deterministic (no LLM judgment) — this is intentional. The score must be reproducible and auditable. Only the correction note generation uses Claude.
- Correction notes are prepended to the system prompt, not appended — this ensures the agent sees the most recent corrections first, before the original instructions
- Drought evaluation uses next Thursday's data (not 24h/48h) — drought changes are weekly. The refiner_queue `run_at` for drought events should be set to the following Thursday rather than +24/+48h.
- No correction is generated for data-unavailable cases — a gap in satellite data is not a prediction failure and should not penalize the agent
