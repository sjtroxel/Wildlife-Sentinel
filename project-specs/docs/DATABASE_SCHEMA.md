# Database Schema — Wildlife Sentinel

**Database:** Neon (PostgreSQL 16+)
**Extensions:** `postgis` (spatial queries), `vector` (pgvector for RAG embeddings)
**Client:** `postgres.js` — never use `@supabase/supabase-js`
**Connection:** SSL required (`ssl: 'require'` in postgres.js config)

---

## Migration Files

| File | Phase | Purpose |
|---|---|---|
| `0001_initial.sql` | 0 | Extensions + `species_ranges` + `migrations` table |
| `0002_pipeline_tables.sql` | 1 | `pipeline_events` + `alerts` |
| `0003_model_usage.sql` | 3 | `model_usage` + `agent_prompts` |
| `0004_rag_tables.sql` | 6 | `species_facts` + `conservation_context` |
| `0005_refiner.sql` | 7 | `refiner_queue` + `refiner_scores` |

---

## Table Reference

### `migrations`

Internal tracking table — records which migration files have been applied.

```sql
CREATE TABLE migrations (
  id         SERIAL PRIMARY KEY,
  filename   TEXT        NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `species_ranges`

IUCN habitat polygons. Phase 1: ~10 test polygons. Phase 2: full CR + EN species from IUCN shapefile.

```sql
CREATE TABLE species_ranges (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  species_name     TEXT        NOT NULL,                -- Latin binomial, e.g. "Pongo abelii"
  common_name      TEXT,                                -- e.g. "Sumatran Orangutan"
  iucn_species_id  TEXT,                                -- IUCN numeric ID as text
  iucn_status      VARCHAR(2)  NOT NULL
                   CHECK (iucn_status IN ('EX','EW','CR','EN','VU','NT','LC')),
  geom             GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,  -- WGS84, loaded from IUCN shapefile
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Required for ST_DWithin performance — without this, every query is a full table scan
CREATE INDEX idx_species_ranges_geom ON species_ranges USING GIST (geom);
-- Used by Species Context Agent to look up species by name
CREATE INDEX idx_species_ranges_name ON species_ranges (species_name);
```

**Key query pattern:**
```sql
-- ALWAYS use (lng, lat) order with ST_Point — PostGIS uses longitude first
SELECT species_name, iucn_status,
  ST_Distance(geom::geography, ST_Point($lng, $lat)::geography) / 1000 AS distance_km
FROM species_ranges
WHERE ST_DWithin(geom::geography, ST_Point($lng, $lat)::geography, 75000)  -- meters, not km
ORDER BY distance_km ASC;
```

---

### `pipeline_events`

Audit log for every event's journey through the pipeline. Used for filtering stats, debugging, and the weekly digest.

```sql
CREATE TABLE pipeline_events (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id   TEXT        NOT NULL,        -- RawDisasterEvent.id
  source     TEXT        NOT NULL,        -- 'nasa_firms' | 'noaa_nhc' | etc.
  stage      TEXT        NOT NULL
             CHECK (stage IN (
               'raw', 'enrichment', 'enriched', 'habitat', 'species',
               'threat', 'synthesis', 'posted', 'filtered', 'error'
             )),
  status     TEXT        NOT NULL
             CHECK (status IN ('published', 'filtered', 'error', 'posted')),
  reason     TEXT,                        -- why filtered/error; NULL for success paths
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_events_event_id ON pipeline_events (event_id);
CREATE INDEX idx_pipeline_events_created  ON pipeline_events (created_at DESC);
CREATE INDEX idx_pipeline_events_stage    ON pipeline_events (stage, status);
```

---

### `alerts`

Assessed alerts. Includes predictions (used by the Refiner) and Discord message references.

```sql
CREATE TABLE alerts (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_event_id       TEXT        NOT NULL,   -- RawDisasterEvent.id
  source             TEXT        NOT NULL,
  event_type         TEXT        NOT NULL
                     CHECK (event_type IN ('wildfire','tropical_storm','flood','drought','coral_bleaching')),
  coordinates        JSONB       NOT NULL,   -- { lat: number, lng: number }
  severity           NUMERIC(5,4),           -- 0.0000 – 1.0000
  enrichment_data    JSONB,                  -- weather summary, habitat IDs, species list
  threat_level       TEXT
                     CHECK (threat_level IN ('low','medium','high','critical')),  -- NULL until Phase 5
  confidence_score   NUMERIC(5,4),          -- computed, never self-reported
  prediction_data    JSONB,                  -- { predicted_impact, reasoning } — used by Refiner
  discord_message_id TEXT,                   -- populated when posted to Discord
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_created   ON alerts (created_at DESC);
CREATE INDEX idx_alerts_source    ON alerts (source);
CREATE INDEX idx_alerts_threat    ON alerts (threat_level) WHERE threat_level IS NOT NULL;
CREATE INDEX idx_alerts_event_id  ON alerts (raw_event_id);
```

---

### `model_usage`

Log of every AI model call. Used for cost tracking and the `GET /admin/costs` endpoint.

```sql
CREATE TABLE model_usage (
  id                  UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  model               TEXT          NOT NULL,
  input_tokens        INTEGER       NOT NULL,
  output_tokens       INTEGER       NOT NULL,
  estimated_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,  -- 6 decimal places for sub-cent precision
  called_at           TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX idx_model_usage_model  ON model_usage (model);
CREATE INDEX idx_model_usage_called ON model_usage (called_at DESC);
```

---

### `agent_prompts`

System prompts for LLM agents, stored in DB so the Refiner can update them. Version history tracked.

```sql
CREATE TABLE agent_prompts (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name       TEXT        NOT NULL UNIQUE,  -- 'threat_assessment' | 'synthesis' | 'refiner'
  system_prompt    TEXT        NOT NULL,
  version          INTEGER     NOT NULL DEFAULT 1,  -- increments on every Refiner update
  last_updated_by  TEXT        NOT NULL DEFAULT 'manual',  -- 'manual' | 'refiner'
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
```

Seeded in Phase 5 with initial prompts. The Refiner prepends correction notes and increments `version`.

---

### `species_facts`

RAG index for Species Context Agent. One row per document chunk. Embeddings are 768-dimensional vectors from Google `text-embedding-004`.

```sql
CREATE TABLE species_facts (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  species_name     TEXT        NOT NULL,     -- Latin binomial, matches species_ranges.species_name
  iucn_species_id  TEXT,
  section_type     TEXT        NOT NULL
                   CHECK (section_type IN ('habitat','diet','threats','conservation_status','population','ecology','behavior')),
  content          TEXT        NOT NULL,     -- 512-token chunk of source document
  embedding        vector(768),              -- text-embedding-004 embedding
  source_document  TEXT        NOT NULL,     -- e.g. "IUCN Pongo abelii Assessment 2023"
  source_url       TEXT,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat for approximate nearest neighbor — faster than exact for large tables
CREATE INDEX idx_species_facts_embedding ON species_facts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_species_facts_species   ON species_facts (species_name);
```

**Retrieval query:**
```sql
-- Cosine similarity: 1 - distance. Higher = more relevant.
SELECT id, content, section_type, source_document,
       1 - (embedding <=> $query_embedding::vector) AS similarity
FROM species_facts
WHERE species_name = $species_name
  AND 1 - (embedding <=> $query_embedding::vector) > 0.40  -- minimum threshold
ORDER BY embedding <=> $query_embedding::vector
LIMIT 5;
```

---

### `conservation_context`

RAG index for Synthesis Agent. Broader conservation framing — not species-specific.

```sql
CREATE TABLE conservation_context (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  document_title   TEXT        NOT NULL,
  section_heading  TEXT,
  content          TEXT        NOT NULL,
  embedding        vector(768),
  source_document  TEXT        NOT NULL,
  source_url       TEXT,
  publication_year INTEGER,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conservation_context_embedding ON conservation_context USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

### `refiner_queue`

Scheduled evaluations for the Refiner. Populated in Phase 5 when alerts are created. Polled hourly by the Refiner cron job in Phase 7.

```sql
CREATE TABLE refiner_queue (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id         UUID        NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  evaluation_time  TEXT        NOT NULL CHECK (evaluation_time IN ('24h','48h')),
  run_at           TIMESTAMPTZ NOT NULL,  -- when to run the evaluation
  completed        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Partial index — only index incomplete evaluations that are due
CREATE INDEX idx_refiner_queue_due ON refiner_queue (run_at) WHERE completed = FALSE;
```

---

### `refiner_scores`

Accuracy scores per alert per evaluation window. Used for the frontend trend chart and for determining when to generate correction notes.

```sql
CREATE TABLE refiner_scores (
  id                   UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id             UUID         NOT NULL REFERENCES alerts(id),
  evaluation_time      TEXT         NOT NULL,          -- '24h' | '48h'
  direction_accuracy   NUMERIC(5,4) NOT NULL,          -- 0.0000 – 1.0000
  magnitude_accuracy   NUMERIC(5,4) NOT NULL,          -- 0.0000 – 1.0000
  composite_score      NUMERIC(5,4) NOT NULL,          -- 0.6 * direction + 0.4 * magnitude
  correction_generated BOOLEAN      NOT NULL DEFAULT FALSE,
  correction_note      TEXT,                           -- Claude-generated correction text
  evaluated_at         TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_refiner_scores_alert    ON refiner_scores (alert_id);
CREATE INDEX idx_refiner_scores_time     ON refiner_scores (evaluated_at DESC);
```

---

## Schema Conventions

- All PKs: `UUID DEFAULT gen_random_uuid()` — no sequential integers
- All timestamps: `TIMESTAMPTZ DEFAULT NOW()` — UTC always
- `updated_at` on mutable tables: add a trigger or update manually in application code
- Enum-like text fields: use `CHECK` constraints, not PostgreSQL enums (easier to add values)
- AI-populated columns: add SQL comment `-- populated by <agent> in Phase N`
- Nullable fields that start empty and get populated later: leave NULL rather than using sentinel values

## What NOT to Do

- Do NOT `SELECT *` in production queries — always name columns
- Do NOT create separate postgres() instances per file — use `db/client.ts`
- Do NOT pass (lat, lng) to `ST_Point` — it takes (lng, lat) / (longitude, latitude)
- Do NOT pass kilometers to `ST_DWithin` — it takes meters when using `::geography` cast
- Do NOT use Supabase client SDK — this is Neon + postgres.js
