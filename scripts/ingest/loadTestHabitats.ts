/**
 * Loads 10 manually-curated species habitat polygons into PostGIS for Phase 1 testing.
 * These are scientifically grounded approximate ranges — Phase 2 replaces them with
 * the full IUCN shapefile.
 *
 * Usage: npm run ingest:test-habitats
 */
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require' });

interface TestSpecies {
  species_name: string;
  common_name: string;
  iucn_species_id: string;
  iucn_status: string;
  geojson: object;
}

const TEST_SPECIES: TestSpecies[] = [
  {
    species_name: 'Pongo abelii',
    common_name: 'Sumatran Orangutan',
    iucn_species_id: '39780',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[95.0, 2.0], [98.5, 2.0], [98.5, 5.5], [95.0, 5.5], [95.0, 2.0]]]],
    },
  },
  {
    species_name: 'Pongo pygmaeus',
    common_name: 'Bornean Orangutan',
    iucn_species_id: '17975',
    iucn_status: 'EN',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[108.0, -4.0], [116.5, -4.0], [116.5, 3.0], [108.0, 3.0], [108.0, -4.0]]]],
    },
  },
  {
    species_name: 'Gymnogyps californianus',
    common_name: 'California Condor',
    iucn_species_id: '22697636',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[-122.0, 34.0], [-114.0, 34.0], [-114.0, 38.0], [-122.0, 38.0], [-122.0, 34.0]]]],
    },
  },
  {
    species_name: 'Puma concolor coryi',
    common_name: 'Florida Panther',
    iucn_species_id: '18868',
    iucn_status: 'EN',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[-82.0, 25.0], [-80.0, 25.0], [-80.0, 27.5], [-82.0, 27.5], [-82.0, 25.0]]]],
    },
  },
  {
    species_name: 'Panthera tigris sumatrae',
    common_name: 'Sumatran Tiger',
    iucn_species_id: '41584',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[101.0, -5.0], [106.0, -5.0], [106.0, 0.0], [101.0, 0.0], [101.0, -5.0]]]],
    },
  },
  {
    species_name: 'Gorilla beringei',
    common_name: 'Mountain Gorilla',
    iucn_species_id: '39999',
    iucn_status: 'EN',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[29.0, -2.0], [30.5, -2.0], [30.5, -0.5], [29.0, -0.5], [29.0, -2.0]]]],
    },
  },
  {
    species_name: 'Loxodonta cyclotis',
    common_name: 'African Forest Elephant',
    iucn_species_id: '181007989',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[8.0, -5.0], [28.0, -5.0], [28.0, 5.0], [8.0, 5.0], [8.0, -5.0]]]],
    },
  },
  {
    species_name: 'Ailuropoda melanoleuca',
    common_name: 'Giant Panda',
    iucn_species_id: '712',
    iucn_status: 'VU',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[102.0, 28.0], [108.0, 28.0], [108.0, 34.0], [102.0, 34.0], [102.0, 28.0]]]],
    },
  },
  {
    species_name: 'Panthera pardus orientalis',
    common_name: 'Amur Leopard',
    iucn_species_id: '15954',
    iucn_status: 'CR',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[130.0, 42.0], [134.0, 42.0], [134.0, 46.0], [130.0, 46.0], [130.0, 42.0]]]],
    },
  },
  {
    species_name: 'Phascolarctos cinereus',
    common_name: 'Koala',
    iucn_species_id: '16892',
    iucn_status: 'EN',
    geojson: {
      type: 'MultiPolygon',
      coordinates: [[[[138.0, -38.0], [153.0, -38.0], [153.0, -22.0], [138.0, -22.0], [138.0, -38.0]]]],
    },
  },
];

async function load(): Promise<void> {
  console.log('[load-test-habitats] Loading test species polygons...');

  for (const species of TEST_SPECIES) {
    await sql`
      INSERT INTO species_ranges (species_name, common_name, iucn_species_id, iucn_status, geom)
      VALUES (
        ${species.species_name},
        ${species.common_name},
        ${species.iucn_species_id},
        ${species.iucn_status},
        ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(species.geojson)}))
      )
      ON CONFLICT DO NOTHING
    `;
    console.log(`[load-test-habitats] Loaded: ${species.common_name}`);
  }

  console.log('[load-test-habitats] Done. Verifying count...');
  const count = await sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM species_ranges`;
  console.log(`[load-test-habitats] species_ranges now has ${count[0]?.count ?? 0} rows`);
  await sql.end();
}

load().catch(err => {
  console.error('[load-test-habitats] Fatal:', err);
  process.exit(1);
});
