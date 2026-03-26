/**
 * Loads IUCN Red List species range polygons from the official Terrestrial Mammals shapefile.
 * Filters to Critically Endangered (CR) and Endangered (EN) species only.
 * Truncates Phase 1 test data before loading.
 *
 * Usage: npm run ingest:habitats -- /path/to/MAMMALS.shp
 * Runtime: 10–30 minutes depending on shapefile size.
 */
import { open } from 'shapefile';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('[iucn-loader] DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require' });

// Filter to CR + EN only — VU adds ~30% more records with marginal benefit for alerting
const TARGET_STATUSES = new Set(['CR', 'EN']);

interface IUCNProperties {
  sci_name: string;   // Latin species name (e.g. "Pongo abelii") — actual field name in shapefile
  id_no: number;      // IUCN species ID
  category: string;   // CR, EN, VU, NT, LC, EX, EW, DD
  marine: string;     // 'true' | 'false'
}

interface IUCNGeometry {
  type: string;
  coordinates: unknown;
}

interface IUCNFeature {
  type: 'Feature';
  geometry: IUCNGeometry;
  properties: IUCNProperties;
}

async function load(shapefilePath: string): Promise<void> {
  console.log(`[iucn-loader] Opening shapefile: ${shapefilePath}`);

  // Clear Phase 1 test data before loading the real dataset
  await sql`TRUNCATE TABLE species_ranges`;
  console.log('[iucn-loader] Cleared existing species_ranges data');

  const source = await open(shapefilePath);
  let loaded = 0;
  let skipped = 0;
  let errors = 0;

  let result = await source.read();

  while (!result.done) {
    const feature = result.value as unknown as IUCNFeature;

    if (
      feature.properties &&
      feature.geometry &&
      feature.properties.sci_name &&
      TARGET_STATUSES.has(feature.properties.category)
    ) {
      try {
        await sql`
          INSERT INTO species_ranges (species_name, iucn_species_id, iucn_status, geom)
          VALUES (
            ${feature.properties.sci_name},
            ${String(feature.properties.id_no)},
            ${feature.properties.category},
            ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}))
          )
          ON CONFLICT DO NOTHING
        `;
        loaded++;
        if (loaded % 100 === 0) {
          console.log(`[iucn-loader] Loaded ${loaded} species...`);
        }
      } catch (err) {
        errors++;
        console.warn(
          `[iucn-loader] Failed to load ${feature.properties.sci_name}:`,
          err instanceof Error ? err.message : err
        );
      }
    } else {
      skipped++;
    }

    result = await source.read();
  }

  console.log(
    `[iucn-loader] Complete. Loaded: ${loaded} | Skipped (non-CR/EN): ${skipped} | Errors: ${errors}`
  );

  const count = await sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM species_ranges`;
  console.log(`[iucn-loader] species_ranges now contains ${count[0]?.count ?? 0} rows`);

  await sql.end();
}

const shapefilePath = process.argv[2];
if (!shapefilePath) {
  console.error('[iucn-loader] Usage: npm run ingest:habitats -- /path/to/MAMMALS.shp');
  process.exit(1);
}

load(shapefilePath).catch(err => {
  console.error('[iucn-loader] Fatal error:', err);
  process.exit(1);
});
