-- Migration: 0002_pipeline_tables
-- Purpose: Audit log + alerts table for Phase 1 pipeline

-- Up

CREATE TABLE IF NOT EXISTS pipeline_events (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id   TEXT        NOT NULL,
  source     TEXT        NOT NULL,
  stage      TEXT        NOT NULL
             CHECK (stage IN ('raw','enrichment','enriched','habitat','species','threat','synthesis','posted','filtered','error')),
  status     TEXT        NOT NULL
             CHECK (status IN ('published','filtered','error','posted')),
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_event_id ON pipeline_events (event_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_created ON pipeline_events (created_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_event_id       TEXT        NOT NULL,
  source             TEXT        NOT NULL,
  event_type         TEXT        NOT NULL,
  coordinates        JSONB       NOT NULL,
  severity           NUMERIC(5,4),
  enrichment_data    JSONB,
  threat_level       TEXT        CHECK (threat_level IN ('low','medium','high','critical')),  -- Phase 5
  confidence_score   NUMERIC(5,4),                                                            -- Phase 5
  prediction_data    JSONB,                                                                   -- Phase 5/7
  discord_message_id TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_source ON alerts (source);
CREATE INDEX IF NOT EXISTS idx_alerts_threat ON alerts (threat_level) WHERE threat_level IS NOT NULL;

-- Down
-- DROP TABLE IF EXISTS alerts;
-- DROP TABLE IF EXISTS pipeline_events;
