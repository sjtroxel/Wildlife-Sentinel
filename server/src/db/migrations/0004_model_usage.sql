-- Migration: 0004_model_usage + agent_prompts

-- Up

CREATE TABLE IF NOT EXISTS model_usage (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  model               TEXT          NOT NULL,
  input_tokens        INTEGER       NOT NULL,
  output_tokens       INTEGER       NOT NULL,
  estimated_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
  called_at           TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_usage_model  ON model_usage (model);
CREATE INDEX IF NOT EXISTS idx_model_usage_called ON model_usage (called_at DESC);

-- agent_prompts: system prompts stored in DB so the Refiner can update them.
-- Seeded in Phase 5 with initial Threat Assessment + Synthesis prompts.
CREATE TABLE IF NOT EXISTS agent_prompts (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name       TEXT        NOT NULL UNIQUE,
  system_prompt    TEXT        NOT NULL,
  version          INTEGER     NOT NULL DEFAULT 1,
  last_updated_by  TEXT        NOT NULL DEFAULT 'manual',  -- 'manual' | 'refiner'
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Down
-- DROP TABLE IF EXISTS agent_prompts;
-- DROP TABLE IF EXISTS model_usage;
