-- Migration: 0001_initial
-- Purpose: Extensions + species_ranges table

-- Up

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify extensions loaded
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'PostGIS failed to install';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'pgvector failed to install';
  END IF;
END $$;

-- species_ranges: IUCN habitat polygon table
-- Phase 1: loaded with ~10 manual test species
-- Phase 2: loaded with full IUCN CR+EN shapefile
CREATE TABLE IF NOT EXISTS species_ranges (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  species_name     TEXT        NOT NULL,
  common_name      TEXT,
  iucn_species_id  TEXT,
  iucn_status      VARCHAR(2)  NOT NULL
                   CHECK (iucn_status IN ('EX','EW','CR','EN','VU','NT','LC')),
  geom             GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index: required for ST_DWithin performance at full dataset scale
CREATE INDEX IF NOT EXISTS idx_species_ranges_geom ON species_ranges USING GIST (geom);
-- Name index: for fast lookups by species name
CREATE INDEX IF NOT EXISTS idx_species_ranges_name ON species_ranges (species_name);

-- Down
-- DROP INDEX IF EXISTS idx_species_ranges_name;
-- DROP INDEX IF EXISTS idx_species_ranges_geom;
-- DROP TABLE IF EXISTS species_ranges;
-- DROP EXTENSION IF EXISTS vector;
-- DROP EXTENSION IF EXISTS postgis;
