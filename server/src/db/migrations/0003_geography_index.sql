-- Migration: 0003_geography_index
-- Adds a GIST index on the geography cast of species_ranges.geom.
-- The geometry GIST index (0001) cannot be used when queries cast to ::geography.
-- All ST_DWithin / ST_Distance queries in this system use ::geography for meter-based
-- distance calculations, so this expression index is required for index scan performance.

-- Up
CREATE INDEX IF NOT EXISTS idx_species_ranges_geom_geography
ON species_ranges
USING GIST ((geom::geography));

-- Down
DROP INDEX IF EXISTS idx_species_ranges_geom_geography;
