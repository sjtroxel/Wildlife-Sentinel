-- Migration: 0006_rag_tables
-- Phase 6: pgvector indices for species facts (IUCN) and conservation context (WWF/IPBES/CBD)

-- Up

CREATE TABLE IF NOT EXISTS species_facts (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  species_name     TEXT        NOT NULL,
  iucn_species_id  TEXT,
  section_type     TEXT        NOT NULL
                   CHECK (section_type IN (
                     'habitat', 'diet', 'threats', 'conservation_status',
                     'population', 'ecology', 'behavior',
                     'conservation_measures', 'geographic_range'
                   )),
  content          TEXT        NOT NULL,
  embedding        vector(768),              -- Google text-embedding-004
  source_document  TEXT        NOT NULL,
  source_url       TEXT,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ivfflat for approximate nearest-neighbour search; lists=100 is a safe starting point
CREATE INDEX IF NOT EXISTS idx_species_facts_embedding
  ON species_facts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_species_facts_species
  ON species_facts (species_name);

CREATE TABLE IF NOT EXISTS conservation_context (
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

CREATE INDEX IF NOT EXISTS idx_conservation_context_embedding
  ON conservation_context USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Down
-- DROP INDEX IF EXISTS idx_conservation_context_embedding;
-- DROP TABLE IF EXISTS conservation_context;
-- DROP INDEX IF EXISTS idx_species_facts_embedding;
-- DROP INDEX IF EXISTS idx_species_facts_species;
-- DROP TABLE IF EXISTS species_facts;
