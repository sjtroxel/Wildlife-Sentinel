# Phase 7 — Refiner / Evaluator Loop

**Goal:** The system improves its own predictions over time. The Refiner is a first-class feature that demonstrates machine-learning-adjacent behavior through prompt engineering.

**Status:** 🔲 Not started
**Depends on:** Phase 5 complete (Phase 6 recommended but not strictly required)

---

## Overview

The Refiner/Evaluator Agent runs 24h and 48h after every fire and storm alert. It:
1. Pulls the original prediction from the DB
2. Fetches actual real-world data for those coordinates at that time
3. Scores the prediction quality using deterministic math (no LLM for scoring)
4. If score < 0.60: generates a Correction Note (Claude Sonnet) and updates the Threat Assessment Agent's system prompt in the `agent_prompts` table
5. If score > 0.85: logs success + increments confidence baseline
6. Always logs the score to `refiner_scores` for trend visualization

The system prompt grows with evidence: "You previously underestimated wind-driven fire spread when offshore winds exceeded 40km/h. Weight wind velocity more heavily in future fire spread assessments."

---

## 1. Database Tables

```sql
-- Migration: 0005_refiner.sql

CREATE TABLE refiner_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES alerts(id),
  evaluation_time TEXT NOT NULL,  -- '24h' or '48h'
  direction_accuracy NUMERIC NOT NULL,  -- 0-1
  magnitude_accuracy NUMERIC NOT NULL,  -- 0-1
  composite_score NUMERIC NOT NULL,     -- 0.6 * direction + 0.4 * magnitude
  correction_generated BOOLEAN DEFAULT FALSE,
  correction_note TEXT,
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refiner_scores_alert ON refiner_scores (alert_id);
CREATE INDEX idx_refiner_scores_time ON refiner_scores (evaluated_at);
```

---

## 2. Scheduling Refiner Runs

When an alert is stored in the DB (Phase 5), schedule two deferred evaluations:

```typescript
// After storing alert to DB:
await scheduleRefinerEvaluation(alertId, '24h', addHours(new Date(), 24));
await scheduleRefinerEvaluation(alertId, '48h', addHours(new Date(), 48));
```

Implementation options:
- **Simple:** Store scheduled evaluations in a `refiner_queue` table; a cron job polls every hour for due evaluations
- **Redis-based:** Use Redis sorted set with score = Unix timestamp; cron job pulls due items

Recommended: The `refiner_queue` table approach (simpler, no extra Redis complexity):

```sql
CREATE TABLE refiner_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES alerts(id),
  evaluation_time TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_refiner_queue_run_at ON refiner_queue (run_at) WHERE completed = FALSE;
```

---

## 3. Scoring Rubrics Per Disaster Type

### Fire Events (NASA FIRMS lookback)
```typescript
// 24h prediction: "Fire will spread NW 40km in next 24h"
// Actual: query NASA FIRMS for fire perimeters at original coordinates 24h later

function scoreFirePrediction(predicted: FirePrediction, actual: FIRMSData): RefinerScore {
  // Direction accuracy: angular difference between predicted and actual spread bearing
  const angleDiff = Math.abs(predicted.spreadBearing - actual.spreadBearing);
  const normalizedAngle = Math.min(angleDiff, 360 - angleDiff); // 0-180
  const directionAccuracy = Math.max(0, 1 - (normalizedAngle / 90)); // 1 = within 15°

  // Magnitude accuracy: actual spread area vs predicted
  const ratio = Math.min(actual.spreadAreaKm2, predicted.spreadAreaKm2) /
                Math.max(actual.spreadAreaKm2, predicted.spreadAreaKm2);
  const magnitudeAccuracy = ratio; // 1 = exact match

  const compositeScore = 0.6 * directionAccuracy + 0.4 * magnitudeAccuracy;
  return { directionAccuracy, magnitudeAccuracy, compositeScore };
}
```

### Storm Events (NOAA NHC track lookback)
- Predicted landfall: lat/lng + time
- Actual: NHC track update 12h and 24h later
- Distance accuracy: haversine(predicted_center, actual_center) → normalized (0 = 500km off, 1 = exactly right)

### Flood Events (USGS gauge lookback)
- Predicted downstream impact radius
- Actual: gauge readings 6h later at downstream stations
- Score: predicted flood stage vs actual flood stage for 3 downstream gauges

### Drought Events (Drought Monitor lookback)
- Predicted severity escalation
- Actual: next Thursday's Drought Monitor update
- Binary: did the predicted county actually escalate? (1 = correct, 0.5 = no change, 0 = wrong)

---

## 4. Correction Note Generation (Claude Sonnet)

Only runs when `compositeScore < 0.60`:

```typescript
const correctionNote = await modelRouter.complete({
  model: MODELS.CLAUDE_SONNET,
  systemPrompt: await getAgentPrompt('refiner'),
  userMessage: `
    Original prediction: ${JSON.stringify(prediction)}
    Actual outcome: ${JSON.stringify(actual)}
    Composite score: ${score.compositeScore.toFixed(3)}
    Direction accuracy: ${score.directionAccuracy.toFixed(3)}
    Magnitude accuracy: ${score.magnitudeAccuracy.toFixed(3)}

    Analyze what was wrong with this prediction and write a specific correction note
    to be prepended to the Threat Assessment Agent's system prompt for future similar events.
    The note should be 2-3 sentences, specific to the failure mode, and actionable.
    Format: "CORRECTION (${event_type}): [note]"
  `,
});
```

System prompt update:
```typescript
await sql`
  UPDATE agent_prompts
  SET system_prompt = ${correctionNote + '\n\n' + existingPrompt},
      version = version + 1,
      last_updated_by = 'refiner',
      updated_at = NOW()
  WHERE agent_name = 'threat_assessment'
`;
```

### Score Threshold Actions

| Score Range | Action |
|---|---|
| < 0.30 | Generate correction note + flag for human review (log to #sentinel-ops) |
| 0.30 – 0.60 | Generate correction note + update system prompt |
| 0.60 – 0.85 | Log score only — no correction needed |
| > 0.85 | Log success + increment confidence baseline in agent_prompts metadata |

---

## 5. Refiner System Prompt (Initial)

```
You are the Refiner agent for Wildlife Sentinel. Your job is to analyze prediction failures
and write actionable correction notes to improve future threat assessments.

You receive: the original prediction made by the Threat Assessment Agent, the actual outcome
from real-world data, and the scoring breakdown.

Write correction notes that are:
- Specific to the failure mode (e.g., "underestimated offshore wind influence")
- Actionable (tells the agent what to do differently)
- Concise (2-3 sentences maximum)
- Written in second person: "Weight X more heavily when Y..."

Do NOT write vague notes like "be more careful" or "consider all factors."
```

---

## Acceptance Criteria

1. `refiner_queue` table populated with 24h + 48h entries for every fire/storm alert
2. Cron job polls queue hourly and runs due evaluations
3. Scoring formulas produce 0-1 results for fire, storm, flood, and drought events
4. `refiner_scores` table populated after each evaluation
5. Correction notes generated and stored for scores < 0.60
6. `agent_prompts` table updated when corrections are generated
7. Score trend is queryable: `SELECT * FROM refiner_scores ORDER BY evaluated_at`
8. System prompt version history visible in `agent_prompts.version`

---

## Notes / Decisions Log

*(Add notes here as Phase 7 progresses)*
