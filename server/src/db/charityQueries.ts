import { sql } from './client.js';
import type { Charity } from '../../../shared/types.js';

const GLOBAL_FALLBACK_SLUGS = ['wwf', 'wcs', 'conservation-international'];

const CHARITY_COLUMNS = sql`
  id, name, slug, url, donation_url, description,
  logo_url, charity_navigator_rating, headquarters_country,
  focus_regions, is_active, created_at
`;

export async function getCharitiesForAlert(
  speciesNames: string[],
  eventType: string,
  limit = 3
): Promise<Charity[]> {
  const found: Charity[] = [];
  const seenIds = new Set<string>();

  // Step 1: Species-specific matches (highest priority)
  if (speciesNames.length > 0) {
    const normalizedNames = speciesNames.map(s => s.toLowerCase());
    const speciesMatches = await sql<Charity[]>`
      SELECT DISTINCT ON (c.id)
        ${CHARITY_COLUMNS}
      FROM charities c
      JOIN charity_species_links csl ON c.id = csl.charity_id
      WHERE LOWER(csl.species_name) = ANY(${normalizedNames})
        AND c.is_active = TRUE
      ORDER BY c.id, csl.priority ASC
      LIMIT ${limit}
    `;
    for (const row of speciesMatches) {
      if (!seenIds.has(row.id) && found.length < limit) {
        found.push(row);
        seenIds.add(row.id);
      }
    }
  }

  // Step 2: Event-type fallback (fill remaining slots)
  if (found.length < limit && eventType) {
    const eventMatches = await sql<Charity[]>`
      SELECT DISTINCT ON (c.id)
        ${CHARITY_COLUMNS}
      FROM charities c
      JOIN charity_event_type_links cel ON c.id = cel.charity_id
      WHERE cel.event_type = ${eventType}
        AND c.is_active = TRUE
      ORDER BY c.id, cel.priority ASC
      LIMIT ${limit}
    `;
    for (const row of eventMatches) {
      if (!seenIds.has(row.id) && found.length < limit) {
        found.push(row);
        seenIds.add(row.id);
      }
    }
  }

  // Step 3: Global fallbacks — WWF, WCS, Conservation International
  if (found.length < limit) {
    const fallbacks = await sql<Charity[]>`
      SELECT ${CHARITY_COLUMNS}
      FROM charities
      WHERE slug = ANY(${GLOBAL_FALLBACK_SLUGS})
        AND is_active = TRUE
      LIMIT ${limit}
    `;
    for (const row of fallbacks) {
      if (!seenIds.has(row.id) && found.length < limit) {
        found.push(row);
        seenIds.add(row.id);
      }
    }
  }

  return found;
}

export async function getAllCharities(): Promise<Charity[]> {
  return sql<Charity[]>`
    SELECT ${CHARITY_COLUMNS}
    FROM charities
    WHERE is_active = TRUE
    ORDER BY name ASC
  `;
}

export async function getCharityBySlug(slug: string): Promise<Charity | null> {
  const rows = await sql<Charity[]>`
    SELECT ${CHARITY_COLUMNS}
    FROM charities
    WHERE slug = ${slug} AND is_active = TRUE
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getCharitiesForSpecies(speciesName: string, limit = 5): Promise<Charity[]> {
  return getCharitiesForAlert([speciesName], '', limit);
}
