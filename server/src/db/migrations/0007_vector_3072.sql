-- Migration: 0007_vector_3072
-- Upgrades embedding columns from vector(768) to vector(1536) for gemini-embedding-001
-- Uses outputDimensionality=1536 truncation to stay within pgvector ivfflat limit (max 2000).
-- Safe to run: both tables are empty at time of migration.

-- Up

-- species_facts
DROP INDEX IF EXISTS idx_species_facts_embedding;
ALTER TABLE species_facts DROP COLUMN IF EXISTS embedding;
ALTER TABLE species_facts ADD COLUMN embedding vector(1536);
CREATE INDEX idx_species_facts_embedding
  ON species_facts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- conservation_context
DROP INDEX IF EXISTS idx_conservation_context_embedding;
ALTER TABLE conservation_context DROP COLUMN IF EXISTS embedding;
ALTER TABLE conservation_context ADD COLUMN embedding vector(1536);
CREATE INDEX idx_conservation_context_embedding
  ON conservation_context USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Down (rollback)
-- DROP INDEX IF EXISTS idx_species_facts_embedding;
-- ALTER TABLE species_facts DROP COLUMN IF EXISTS embedding;
-- ALTER TABLE species_facts ADD COLUMN embedding vector(768);
-- CREATE INDEX idx_species_facts_embedding
--   ON species_facts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- DROP INDEX IF EXISTS idx_conservation_context_embedding;
-- ALTER TABLE conservation_context DROP COLUMN IF EXISTS embedding;
-- ALTER TABLE conservation_context ADD COLUMN embedding vector(768);
-- CREATE INDEX idx_conservation_context_embedding
--   ON conservation_context USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
