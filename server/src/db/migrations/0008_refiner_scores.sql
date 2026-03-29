-- Migration: 0008_refiner_scores
-- Purpose: Add raw_data column to alerts; extend refiner_queue evaluation_time for drought
--          (weekly cadence); create refiner_scores table for accuracy trend tracking.

-- Up

-- Store original scout raw_data on alerts so the Refiner can re-query the same data sources
-- (FIPS for drought, site_code for flood, alert_level for coral, wind knots for storm)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- Allow 'weekly' evaluation_time for drought events (Drought Monitor updates every Thursday)
ALTER TABLE refiner_queue
  DROP CONSTRAINT IF EXISTS refiner_queue_evaluation_time_check;
ALTER TABLE refiner_queue
  ADD CONSTRAINT refiner_queue_evaluation_time_check
    CHECK (evaluation_time IN ('24h', '48h', 'weekly'));

-- Accuracy history: one row per alert per evaluation window
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
-- ALTER TABLE alerts DROP COLUMN IF EXISTS raw_data;
