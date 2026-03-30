import { Router, type Request, type Response } from 'express';
import { sql } from '../db/client.js';
import { ValidationError } from '../errors.js';

export const habitatsRouter = Router();

// GET /habitats?minLng=&minLat=&maxLng=&maxLat=
// Returns species_ranges polygons as a GeoJSON FeatureCollection for the given bounding box.
habitatsRouter.get('/', async (req: Request, res: Response) => {
  const { minLng, minLat, maxLng, maxLat } = req.query;

  // All four params required
  if (minLng === undefined || minLat === undefined || maxLng === undefined || maxLat === undefined) {
    throw new ValidationError('Missing required query params: minLng, minLat, maxLng, maxLat');
  }

  const parsedMinLng = parseFloat(String(minLng));
  const parsedMinLat = parseFloat(String(minLat));
  const parsedMaxLng = parseFloat(String(maxLng));
  const parsedMaxLat = parseFloat(String(maxLat));

  if (
    !isFinite(parsedMinLng) || !isFinite(parsedMinLat) ||
    !isFinite(parsedMaxLng) || !isFinite(parsedMaxLat)
  ) {
    throw new ValidationError('Bounding box values must be valid numbers');
  }
  if (parsedMinLng < -180 || parsedMaxLng > 180 || parsedMinLng > parsedMaxLng) {
    throw new ValidationError('Longitude values must be in [-180, 180] with minLng <= maxLng');
  }
  if (parsedMinLat < -90 || parsedMaxLat > 90 || parsedMinLat > parsedMaxLat) {
    throw new ValidationError('Latitude values must be in [-90, 90] with minLat <= maxLat');
  }

  const rows = await sql`
    SELECT id, species_name, iucn_status,
           ST_AsGeoJSON(geom)::jsonb AS geojson
    FROM species_ranges
    WHERE ST_Intersects(
      geom,
      ST_MakeEnvelope(${parsedMinLng}, ${parsedMinLat}, ${parsedMaxLng}, ${parsedMaxLat}, 4326)
    )
    LIMIT 100
  `;

  res.json({ type: 'FeatureCollection', features: rows });
});
