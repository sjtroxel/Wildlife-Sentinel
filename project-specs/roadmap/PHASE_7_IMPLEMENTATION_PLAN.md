# Phase 7 — Refiner / Evaluator Loop: Implementation Plan

**Status:** ✅ Complete (2026-03-29) — all files implemented, 30 refiner tests pass, migration applied
**Depends on:** Phase 5 complete ✅ (Phase 6 ingest in progress — not a blocker)
**Session estimate:** 1–2 sessions
**Spec:** `PHASE_7_REFINER.md`

---

## Context

Phase 5 built the full agent swarm and wired the threat assessment pipeline. It also pre-wired the Refiner's infrastructure: `refiner_queue` is already created and `ThreatAssessmentAgent` already inserts 24h + 48h evaluation rows for every fire and storm alert. The agent_prompts table is seeded with the `refiner` system prompt.

Phase 7 builds the evaluation engine itself: a cron scheduler that polls the queue, five event-type-specific scoring functions that compare predictions to actual data, and a correction note generator that rewrites the Threat Assessment Agent's system prompt when predictions are poor. This is the self-improvement loop — the headline feature for portfolio/demo.

---

## Architectural Decisions

### 1. Migration is `0008_refiner_scores.sql` — `refiner_queue` already exists
The spec refers to `0006_refiner.sql` and includes a `CREATE TABLE refiner_queue`. Both are wrong for this codebase. `0006` is taken by RAG tables, and `refiner_queue` was created in `0005_phase5_tables.sql`. The Phase 7 migration only needs the `refiner_scores` table.

### 2. `refiner_queue` uses `completed_at TIMESTAMPTZ`, not `completed BOOLEAN`
The Phase 7 spec shows `completed BOOLEAN NOT NULL DEFAULT FALSE`. The actual Phase 5 migration created `completed_at TIMESTAMPTZ` (nullable). All RefinerScheduler queries must use `completed_at IS NULL` (pending) and set `completed_at = NOW()` on completion, not flip a boolean.

### 3. `fetchWithRetry` is already implemented — import from BaseScout
`server/src/scouts/BaseScout.ts` exports `fetchWithRetry`. The RefinerAgent imports it directly rather than duplicating the implementation.

### 4. Geo math lives in `server/src/refiner/geoUtils.ts`
`haversineDistance()`, `haversineBearing()`, `parseCSV()`, and the prediction-text extractors (`extractPredictedBearing`, `extractPredictedDistance`, `extractPredictedPercentChange`) do not exist yet. They belong in a dedicated utility file — not embedded in the scoring functions — so they can be unit-tested independently.

### 5. Drought queue entries need `run_at = next Thursday`
Phase 5's ThreatAssessmentAgent inserts +24h and +48h entries for all event types. Drought Monitor data updates weekly (every Thursday), so a 24h/48h lookback is meaningless for scoring drought predictions. **ThreatAssessmentAgent.ts needs a targeted fix**: drought events should insert one queue entry with `run_at = next Thursday` (and `evaluation_time = 'weekly'`). The `evaluation_time` CHECK constraint in the existing table only allows `'24h'` and `'48h'`. The migration must add `'weekly'` to that constraint (or replace it with a broader one).

### 6. Prediction text parsing is intentionally simple regex
`predicted_impact` is free-form Claude output like "Fire will spread NW approximately 35km in 24h". The extractors use simple regex patterns (cardinal/ordinal direction → bearing degrees, numeric distance, numeric percent). The scoring rubrics in the spec are intentionally tolerant of imprecision here — this is why `directionAccuracy` degrades linearly rather than being binary.

### 7. Score threshold actions follow the spec table
| Score | Action |
|---|---|
| < 0.30 | Correction note + `logToWarRoom` warning to #sentinel-ops |
| 0.30 – 0.60 | Correction note + update `agent_prompts`, silent |
| 0.60 – 0.85 | Log score to DB only |
| > 0.85 | Log score + `logToWarRoom` success note to #sentinel-ops |

### 8. Data-unavailable cases: mark completed, do not score
If the actual data API returns empty or unavailable data, mark the queue item `completed_at = NOW()` with a `reason = 'data_unavailable'` note logged to the console. Do NOT score as 0 — that falsely penalizes the agent for satellite/sensor gaps.

---

## Files to Create

```
server/src/db/migrations/0008_refiner_scores.sql
server/src/refiner/geoUtils.ts
server/src/refiner/RefinerAgent.ts
server/src/refiner/RefinerScheduler.ts
server/tests/refiner/geoUtils.test.ts
server/tests/refiner/RefinerAgent.test.ts
server/tests/fixtures/api/firms-fire-response.csv
server/tests/fixtures/api/nhc-storms-response.json
server/tests/fixtures/api/usgs-gauge-response.json
server/tests/fixtures/api/drought-table-response.csv
server/tests/fixtures/api/crw-alert-areas-response.json
```

## Files to Modify

```
server/src/db/migrations/0008_refiner_scores.sql     — also ALTERs refiner_queue CHECK constraint
server/src/agents/ThreatAssessmentAgent.ts            — drought gets run_at=nextThursday, evaluation_time='weekly'
server/src/server.ts                                  — add startRefinerScheduler()
shared/types.d.ts                                     — add RefinerScore interface
```

---

## Step-by-Step Implementation

### Step 1 — Migration: `0008_refiner_scores.sql`

Two operations:
1. Drop and re-create the `evaluation_time` CHECK constraint on `refiner_queue` to allow `'weekly'`
2. Create `refiner_scores` table

```sql
-- Migration: 0008_refiner_scores
-- Purpose: Add refiner_scores table; extend refiner_queue evaluation_time to support 'weekly' drought evaluations

-- Up

-- Extend evaluation_time to allow 'weekly' (drought monitor updates every Thursday)
ALTER TABLE refiner_queue
  DROP CONSTRAINT IF EXISTS refiner_queue_evaluation_time_check;
ALTER TABLE refiner_queue
  ADD CONSTRAINT refiner_queue_evaluation_time_check
    CHECK (evaluation_time IN ('24h', '48h', 'weekly'));

-- Accuracy history per alert per evaluation window
CREATE TABLE IF NOT EXISTS refiner_scores (
  id                   UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id             UUID          NOT NULL REFERENCES alerts(id),
  evaluation_time      TEXT          NOT NULL,
  direction_accuracy   NUMERIC(5,4)  NOT NULL,
  magnitude_accuracy   NUMERIC(5,4)  NOT NULL,
  composite_score      NUMERIC(5,4)  NOT NULL,   -- 0.6 * direction + 0.4 * magnitude
  correction_generated BOOLEAN       NOT NULL DEFAULT FALSE,
  correction_note      TEXT,
  evaluated_at         TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refiner_scores_alert ON refiner_scores (alert_id);
CREATE INDEX IF NOT EXISTS idx_refiner_scores_time  ON refiner_scores (evaluated_at DESC);

-- Down
-- DROP TABLE IF EXISTS refiner_scores;
-- ALTER TABLE refiner_queue DROP CONSTRAINT IF EXISTS refiner_queue_evaluation_time_check;
-- ALTER TABLE refiner_queue ADD CONSTRAINT refiner_queue_evaluation_time_check CHECK (evaluation_time IN ('24h','48h'));
```

### Step 2 — Types: `shared/types.d.ts`

Add `RefinerScore` interface:
```typescript
export interface RefinerScore {
  directionAccuracy: number;   // 0–1
  magnitudeAccuracy: number;   // 0–1
  compositeScore: number;      // 0.6 * direction + 0.4 * magnitude
}
```

### Step 3 — `server/src/refiner/geoUtils.ts`

Pure math utilities — zero imports from project code or AI SDKs. Fully unit-testable.

**Functions to implement:**

`haversineDistance(a: {lat: number; lng: number}, b: {lat: number; lng: number}): number`
— Returns distance in km using the haversine formula.

`haversineBearing(from: {lat: number; lng: number}, to: {lat: number; lng: number}): number`
— Returns bearing in degrees (0–360, clockwise from north).

`parseCSV(text: string): Record<string, string>[]`
— Parses a CSV string (header row + data rows) into an array of objects keyed by header name. Handles quoted fields. Returns `[]` on empty or header-only input.

`extractPredictedBearing(text: string): number`
— Scans prediction text for cardinal/ordinal direction keywords (N, NE, E, SE, S, SW, W, NW and full words). Returns degrees. Defaults to 0 (north) if none found. Map:
`N=0, NNE=22.5, NE=45, ENE=67.5, E=90, ESE=112.5, SE=135, SSE=157.5, S=180, SSW=202.5, SW=225, WSW=247.5, W=270, WNW=292.5, NW=315, NNW=337.5`

`extractPredictedDistance(text: string): number`
— Scans for patterns like "35km", "35 km", "35 kilometers". Returns numeric km. Defaults to 25 if none found.

`extractPredictedPercentChange(text: string): number | null`
— Scans for patterns like "25%", "25 percent", "worsen by 25". Returns number or null.

`getNextThursday(): Date`
— Returns the next Thursday at 18:00 UTC (Drought Monitor data is typically published Thursday evenings).

### Step 4 — `server/src/refiner/RefinerAgent.ts`

Main entry point: `runRefinerEvaluation(alertId: string, evaluationTime: '24h' | '48h' | 'weekly'): Promise<void>`

**Structure:**
1. Fetch alert from DB: `SELECT id, event_type, source, coordinates, prediction_data, raw_data FROM alerts WHERE id = $alertId`
2. Route to scorer by `event_type`:
   - `wildfire` → `scoreFirePrediction()`
   - `tropical_storm` → `scoreStormPrediction()`
   - `flood` → `scoreFloodPrediction()`
   - `drought` → `scoreDroughtPrediction()`
   - `coral_bleaching` → `scoreCoralPrediction()`
3. Insert row into `refiner_scores`
4. Apply threshold actions (see Decision #7)
5. If score < 0.60: call `generateCorrectionNote()` → update `agent_prompts`

**Score functions — exact rubrics from spec, implemented using `geoUtils.ts` helpers:**

`scoreFirePrediction(alert, evaluationHours)` — NASA FIRMS lookback. Parse centroid of actual fire points, compute bearing + distance from origin, compare to predicted bearing/distance via `extractPredictedBearing()` + `extractPredictedDistance()`.

`scoreStormPrediction(alert, evaluationHours)` — NOAA NHC CurrentStorms.json. Match storm by proximity (< 500km). Direction accuracy: normalize distance-off-track over 500km scale. Magnitude accuracy: actual vs. predicted knots ratio.

`scoreFloodPrediction(alert, evaluationHours)` — USGS NWIS IV gauge. Compare current discharge % above flood stage vs original. Direction = predicted worsening matches actual worsening (binary). Magnitude = percent change ratio.

`scoreCoralPrediction(alert)` — CRW alert areas JSON (same endpoint as CoralScout: `coralreefwatch.noaa.gov/vs/gauges/crw_vs_alert_areas.json`). Match feature by centroid proximity < 200km. Direction = still elevated (≥ original level). Magnitude = level ratio.

`scoreDroughtPrediction(alert)` — Drought Monitor county table. Match by FIPS from `raw_data`. Direction = D3+D4 coverage stayed same or worsened (implicit alert assumption). Magnitude = coverage change / 20 (20% shift = max).

**Data unavailability guard** — each scorer returns `null` instead of a score when the actual data is unavailable (empty API response, missing gauge, no storm match). `runRefinerEvaluation` checks for null and marks the queue item completed with a `data_unavailable` log.

**`generateCorrectionNote(alert, score, evaluationTime): Promise<string>`** — calls `modelRouter.complete()` with `MODELS.CLAUDE_SONNET` using the seeded `refiner` system prompt. `maxTokens: 200`, `temperature: 0.3`. Returns the correction note string.

**System prompt update pattern:**
```typescript
const existing = await getAgentPrompt('threat_assessment');
const updated = `${correctionNote}\n\n---\n\n${existing}`;
await sql`
  UPDATE agent_prompts
  SET system_prompt    = ${updated},
      version          = version + 1,
      last_updated_by  = 'refiner',
      updated_at       = NOW()
  WHERE agent_name = 'threat_assessment'
`;
```

### Step 5 — `server/src/refiner/RefinerScheduler.ts`

Hourly cron that polls `refiner_queue`:

```typescript
import cron from 'node-cron';
import sql from '../db/client.js';
import { runRefinerEvaluation } from './RefinerAgent.js';
import { logToWarRoom } from '../discord/warRoom.js';

export function startRefinerScheduler(): void {
  cron.schedule('0 * * * *', async () => {
    const due = await sql<{ id: string; alert_id: string; evaluation_time: string }[]>`
      SELECT id, alert_id, evaluation_time
      FROM refiner_queue
      WHERE run_at <= NOW()
        AND completed_at IS NULL
      ORDER BY run_at ASC
      LIMIT 10
    `;

    for (const item of due) {
      try {
        await runRefinerEvaluation(
          item.alert_id,
          item.evaluation_time as '24h' | '48h' | 'weekly'
        );
        await sql`
          UPDATE refiner_queue SET completed_at = NOW() WHERE id = ${item.id}
        `;
      } catch (err) {
        console.error(`[refiner] Evaluation failed for ${item.alert_id}:`, err);
        await logToWarRoom({
          agent: 'refiner',
          action: 'Evaluation failed',
          detail: item.alert_id,
          level: 'warning',
        });
      }
    }
  });

  console.log('[refiner] Scheduler started — polling hourly');
}
```

### Step 6 — Modify `ThreatAssessmentAgent.ts`

Currently inserts two `refiner_queue` rows (`+24h`, `+48h`) for every alert. Add a special case for drought events:

```typescript
// In ThreatAssessmentAgent.ts — refiner queue insertion block:
if (eventType === 'drought') {
  // Drought Monitor updates weekly — evaluate on next Thursday
  await sql`
    INSERT INTO refiner_queue (alert_id, evaluation_time, run_at)
    VALUES (${alertId}, 'weekly', ${getNextThursday()})
  `;
} else {
  const now = new Date();
  await sql`
    INSERT INTO refiner_queue (alert_id, evaluation_time, run_at)
    VALUES
      (${alertId}, '24h', ${new Date(now.getTime() + 24 * 60 * 60 * 1000)}),
      (${alertId}, '48h', ${new Date(now.getTime() + 48 * 60 * 60 * 1000)})
  `;
}
```

Import `getNextThursday` from `../refiner/geoUtils.js`.

### Step 7 — Modify `server/src/server.ts`

```typescript
import { startRefinerScheduler } from './refiner/RefinerScheduler.js';
// In main() — alongside other void starts:
startRefinerScheduler();
```

### Step 8 — Fixtures

Five API fixture files mirroring real response shapes (abbreviated, 2–3 data rows each):

**`firms-fire-response.csv`** — VIIRS SNPP NRT format: `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight`

**`nhc-storms-response.json`** — `{ "activeStorms": [{ "id": "...", "name": "...", "latitude": "...", "longitude": "...", "intensity": "65", ... }] }`

**`usgs-gauge-response.json`** — NWIS IV JSON format: `{ "value": { "timeSeries": [{ "values": [{ "value": [{ "value": "14500.0" }] }] }] } }`

**`drought-table-response.csv`** — Drought Monitor county format: `FIPS,County,State,D0,D1,D2,D3,D4,...`

**`crw-alert-areas-response.json`** — GeoJSON FeatureCollection: `{ "features": [{ "geometry": { "coordinates": [[...]] }, "properties": { "alert_level": 2 } }] }`

### Step 9 — Tests

**`server/tests/refiner/geoUtils.test.ts`** — pure unit tests, no mocks:
- `haversineDistance`: known lat/lng pairs with expected km (e.g. Paris→London ≈ 341km)
- `haversineBearing`: north = 0°, east = 90°, etc.
- `parseCSV`: header + 2 rows → 2 objects with correct keys
- `extractPredictedBearing`: "will spread NW" → 315, "moving southeast" → 135, no match → 0
- `extractPredictedDistance`: "35km spread" → 35, "40 km" → 40, no match → 25
- `getNextThursday`: returns a Thursday, at or after tomorrow

**`server/tests/refiner/RefinerAgent.test.ts`** — mock `fetch`, `sql`, `modelRouter`, `logToWarRoom`:
- `scoreFirePrediction`: fixture CSV with points NW of origin → direction score > 0.5 for "NW" prediction
- `scoreStormPrediction`: fixture storm within 200km → direction score reflects proximity
- `scoreFloodPrediction`: fixture gauge value above flood stage → direction correct when predicted worsening
- `scoreDroughtPrediction`: fixture county D3 increase → directionAccuracy = 1.0
- `scoreCoralPrediction`: fixture alert_level 2 → directionAccuracy = 1.0
- Data unavailable: empty FIRMS CSV → returns null, queue marked completed with log
- `runRefinerEvaluation`: score < 0.60 → `generateCorrectionNote` called, `agent_prompts` updated
- `runRefinerEvaluation`: score > 0.85 → `logToWarRoom` success called, no correction
- Composite score formula: `0.6 * 0.8 + 0.4 * 0.6 = 0.72` exactly

---

## Existing Utilities to Reuse

| Utility | File | Use in Phase 7 |
|---|---|---|
| `fetchWithRetry()` | `scouts/BaseScout.ts` | All 5 scoring functions |
| `getAgentPrompt()` | `db/agentPrompts.ts` | `generateCorrectionNote()` |
| `logToWarRoom()` | `discord/warRoom.ts` | Score threshold alerts |
| `logPipelineEvent()` | `db/pipelineEvents.ts` | Audit trail for evaluations |
| `modelRouter.complete()` | `router/ModelRouter.ts` | Correction note generation |
| `MODELS.CLAUDE_SONNET` | `shared/models.ts` | Correction note model |
| `sql` | `db/client.ts` | Queue polling + score inserts |

---

## Verification

1. Run migration: `psql $DATABASE_URL -f server/src/db/migrations/0008_refiner_scores.sql`
2. Verify constraint updated: `\d refiner_queue` → `evaluation_time` allows `'weekly'`
3. Verify `refiner_scores` table created: `\d refiner_scores`
4. `npm run typecheck` — zero errors
5. `npm test` — all tests pass (target: previous 72 + ~15 new)
6. Manual smoke test: insert a test row into `refiner_queue` with `run_at = NOW() - interval '1 minute'`, trigger the scheduler, confirm `refiner_scores` row appears and `completed_at` is set
7. Score trend queryable: `SELECT composite_score, evaluated_at FROM refiner_scores ORDER BY evaluated_at;`

---

## Notes / Decisions Log

- `refiner_queue.completed_at TIMESTAMPTZ` (Phase 5 actual schema) vs `completed BOOLEAN` (Phase 7 spec) — use `completed_at IS NULL` throughout. The spec was written before Phase 5 finalized the schema.
- Drought `run_at = next Thursday 18:00 UTC` — Drought Monitor is published Thursday evenings. The scheduler will pick it up on the next hourly poll after that.
- `generateCorrectionNote` uses `MODELS.CLAUDE_SONNET` — correction note quality is worth the cost. Notes are only generated when score < 0.60, which should be infrequent in a well-tuned system.
- Correction notes are **prepended** (not appended) to the system prompt — the agent sees the most recent corrections first, before the original instructions.
- Phase 8 frontend will visualize `refiner_scores` as a trend chart. No additional work needed here beyond ensuring `evaluated_at` has the DESC index (already in migration).
