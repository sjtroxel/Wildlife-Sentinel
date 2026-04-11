import { sql } from './client.js';
import type { IUCNStatus } from '../../../shared/types.js';

export interface SpeciesLookupRow {
  species_name: string;
  common_name: string | null;
  iucn_status: IUCNStatus;
  iucn_species_id: string | null;
  slug: string;
}

export interface AutocompleteRow {
  species_name: string;
  common_name: string | null;
}

export async function lookupSpecies(input: string): Promise<SpeciesLookupRow | null> {
  const slug = input.toLowerCase().replace(/ /g, '-');
  const rows = await sql<SpeciesLookupRow[]>`
    SELECT species_name,
           MAX(common_name)      AS common_name,
           MAX(iucn_status)      AS iucn_status,
           MAX(iucn_species_id)  AS iucn_species_id,
           REPLACE(LOWER(species_name), ' ', '-') AS slug
    FROM species_ranges
    WHERE REPLACE(LOWER(species_name), ' ', '-') = ${slug}
       OR LOWER(common_name) = LOWER(${input})
    GROUP BY species_name
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getSpeciesAlertCount(speciesName: string): Promise<number> {
  const rows = await sql<{ alert_count: number }[]>`
    SELECT COUNT(*)::int AS alert_count
    FROM alerts
    WHERE threat_level IS NOT NULL
      AND enrichment_data->'species_at_risk' @> jsonb_build_array(${speciesName}::text)
  `;
  return rows[0]?.alert_count ?? 0;
}

export async function getSpeciesCentroid(speciesName: string): Promise<{ lat: number; lng: number } | null> {
  const rows = await sql<{ centroid_lat: string; centroid_lng: string }[]>`
    SELECT ST_Y(ST_Centroid(ST_Collect(geom)))::text AS centroid_lat,
           ST_X(ST_Centroid(ST_Collect(geom)))::text AS centroid_lng
    FROM species_ranges
    WHERE species_name = ${speciesName}
  `;
  if (!rows[0]) return null;
  return {
    lat: parseFloat(rows[0].centroid_lat),
    lng: parseFloat(rows[0].centroid_lng),
  };
}

export async function autocompleteSpecies(input: string): Promise<AutocompleteRow[]> {
  const pattern = `%${input}%`;
  return sql<AutocompleteRow[]>`
    SELECT DISTINCT ON (COALESCE(common_name, species_name))
      species_name, common_name
    FROM species_ranges
    WHERE common_name ILIKE ${pattern}
       OR species_name ILIKE ${pattern}
    ORDER BY COALESCE(common_name, species_name)
    LIMIT 25
  `;
}
