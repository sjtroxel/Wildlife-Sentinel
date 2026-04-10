import { Router, type Request, type Response } from 'express';
import { sql } from '../db/client.js';

export const speciesRouter = Router();

const SLUG_RE = /^[a-z0-9-]+$/;

function normalizeAlertRow(row: Record<string, unknown>) {
  return {
    ...row,
    coordinates:
      typeof row['coordinates'] === 'string'
        ? (JSON.parse(row['coordinates']) as { lat: number; lng: number })
        : row['coordinates'],
    severity: row['severity'] !== null ? parseFloat(row['severity'] as string) : null,
    confidence_score:
      row['confidence_score'] !== null
        ? parseFloat(row['confidence_score'] as string)
        : null,
  };
}

// GET /species?limit=50&offset=0
// Returns distinct species from species_ranges, ordered by IUCN status severity then name.
speciesRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query['limit'] ?? '50')), 100);
  const offset = Math.max(parseInt(String(req.query['offset'] ?? '0')), 0);

  const rows = await sql`
    SELECT species_name, common_name, iucn_status, iucn_species_id,
      REPLACE(LOWER(species_name), ' ', '-') AS slug
    FROM (
      SELECT DISTINCT ON (species_name)
        species_name, common_name, iucn_status, iucn_species_id
      FROM species_ranges
      ORDER BY species_name
    ) sub
    ORDER BY
      CASE iucn_status
        WHEN 'EX' THEN 0 WHEN 'EW' THEN 1 WHEN 'CR' THEN 2 WHEN 'EN' THEN 3
        WHEN 'VU' THEN 4 WHEN 'NT' THEN 5 WHEN 'LC' THEN 6 ELSE 7
      END,
      species_name
    LIMIT ${limit} OFFSET ${offset}
  `;

  res.json(rows);
});

// GET /species/:slug
// Returns species detail: metadata + range polygon as GeoJSON + recent alerts for this species.
speciesRouter.get('/:slug', async (req: Request, res: Response) => {
  const slug = req.params['slug'];
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    res.status(400).json({ error: 'Invalid species slug' });
    return;
  }

  const speciesRows = await sql`
    SELECT
      species_name,
      MAX(common_name) AS common_name,
      MAX(iucn_status) AS iucn_status,
      MAX(iucn_species_id) AS iucn_species_id,
      REPLACE(LOWER(species_name), ' ', '-') AS slug,
      ST_X(ST_Centroid(ST_Collect(geom))) AS centroid_lng,
      ST_Y(ST_Centroid(ST_Collect(geom))) AS centroid_lat,
      ST_AsGeoJSON(ST_Collect(geom))::jsonb AS range_geojson
    FROM species_ranges
    WHERE REPLACE(LOWER(species_name), ' ', '-') = ${slug}
    GROUP BY species_name
  `;

  if (speciesRows.length === 0) {
    res.status(404).json({ error: 'Species not found' });
    return;
  }

  const sr = speciesRows[0]!;
  const speciesName = String(sr['species_name']);

  const alertRows = await sql`
    SELECT id, source, event_type, coordinates, severity, threat_level,
           confidence_score, enrichment_data, created_at, discord_message_id
    FROM alerts
    WHERE threat_level IS NOT NULL
      AND enrichment_data->'species_at_risk' @> jsonb_build_array(${speciesName}::text)
    ORDER BY created_at DESC
    LIMIT 10
  `;

  res.json({
    species_name: sr['species_name'],
    common_name: sr['common_name'] ?? null,
    iucn_status: sr['iucn_status'],
    iucn_species_id: sr['iucn_species_id'] ?? null,
    slug: sr['slug'],
    centroid: {
      lat: parseFloat(String(sr['centroid_lat'])),
      lng: parseFloat(String(sr['centroid_lng'])),
    },
    range_geojson:
      typeof sr['range_geojson'] === 'string'
        ? JSON.parse(sr['range_geojson'])
        : (sr['range_geojson'] ?? null),
    recent_alerts: alertRows.map(normalizeAlertRow),
  });
});
