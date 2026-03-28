/**
 * Ingest species facts from GBIF Species API into the species_facts pgvector table.
 *
 * Primary source: GBIF /v1/species/match + /v1/species/{key}/descriptions
 *   - Free, no auth, no rate limits for reasonable use
 *   - Returns peer-reviewed mammal taxonomy literature (Hominidae, Cheirogaleidae, etc.)
 *   - Covers all 1,372 CR/EN mammals in PostGIS
 * Fallback: Wikipedia MediaWiki API (for any species GBIF returns <2 sections)
 *
 * Usage (from repo root):
 *   npm run ingest:species
 *   (reads DATABASE_URL, GOOGLE_AI_API_KEY from server/.env)
 *
 * Resumable: skips species that already have entries in species_facts.
 * Idempotent: ON CONFLICT DO NOTHING prevents duplicate chunks.
 * Rate-limited: 100ms between embed calls to stay within free tier limits.
 */
import postgres from 'postgres';

// ── Env validation ──────────────────────────────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL'];
const GOOGLE_AI_API_KEY = process.env['GOOGLE_AI_API_KEY'];

if (!DATABASE_URL || !GOOGLE_AI_API_KEY) {
  console.error('Missing required env vars: DATABASE_URL, GOOGLE_AI_API_KEY');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 5 });

// ── Constants ────────────────────────────────────────────────────────────────

const GBIF_API_BASE = 'https://api.gbif.org/v1';
const WIKIPEDIA_API_BASE = 'https://en.wikipedia.org/w/api.php';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const MAX_CHUNK_CHARS = 512 * 4;
const OVERLAP_CHARS = 50 * 4;
const EMBED_DELAY_MS = 650;  // 100 RPM free tier limit = 1 req/600ms; 650ms gives headroom

// Map GBIF description type → our section_type CHECK values
// GBIF types: biology_ecology, conservation, distribution, activity, food_feeding,
//             breeding, description, discussion, materials_examined, vernacular_names
const SECTION_TYPE_MAP: Record<string, string> = {
  // GBIF types
  biology_ecology:          'habitat',   // first occurrence is habitat; subsequent are ecology
  conservation:             'conservation_status',
  distribution:             'geographic_range',
  activity:                 'ecology',
  food_feeding:             'diet',
  breeding:                 'ecology',
  // IUCN v3 types (kept for reference, unused now)
  habitat:                  'habitat',
  habitat_and_ecology:      'habitat',
  ecology:                  'ecology',
  threats:                  'threats',
  population:               'population',
  conservation_measures:    'conservation_measures',
  conservation_actions:     'conservation_measures',
  geographic_range:         'geographic_range',
  geographicrange:          'geographic_range',
  use_and_trade:            'ecology',
};

// ── Types ────────────────────────────────────────────────────────────────────

interface SpeciesRow {
  iucn_species_id: string;
  species_name: string;
}

interface GBIFMatchResponse {
  usageKey?: number;
  matchType?: string;
  confidence?: number;
}

interface GBIFDescription {
  type: string;
  language: string;
  description: string;
  source: string;
}

interface GBIFDescriptionsResponse {
  results: GBIFDescription[];
}

interface WikipediaResponse {
  query?: {
    pages?: Record<string, {
      extract?: string;
      missing?: string;
    }>;
  };
}

// ── Chunking ─────────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHUNK_CHARS) return [trimmed];

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, trimmed.length);

    if (end < trimmed.length) {
      const paragraphEnd = trimmed.lastIndexOf('\n\n', end);
      if (paragraphEnd > start + MAX_CHUNK_CHARS / 2) {
        end = paragraphEnd;
      }
    }

    const content = trimmed.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end >= trimmed.length) break;
    start = end - OVERLAP_CHARS;
  }

  return chunks;
}

// ── Embedding ─────────────────────────────────────────────────────────────────
// Uses raw fetch() against v1beta API — gemini-embedding-001 is on v1beta.

interface EmbedResponse {
  embedding: { values: number[] };
}

async function embedText(text: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_AI_API_KEY}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: 1536,
      }),
    });
    if (res.status === 429) {
      const waitMs = 65_000;
      console.warn(`[ingest:species] Embedding rate limited — waiting 65s (attempt ${attempt + 1}/5)`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as EmbedResponse;
    return data.embedding.values;
  }
  throw new Error('Embedding API: max retries exceeded after rate limiting');
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embedText(text));
    await new Promise(r => setTimeout(r, EMBED_DELAY_MS));
  }
  return results;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const GBIF_USER_AGENT = 'wildlife-sentinel/1.0 (conservation monitoring; contact via GitHub)';
const GBIF_DELAY_MS = 200;  // polite delay between GBIF calls

async function fetchWithRetry(url: string, headers?: Record<string, string>): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': GBIF_USER_AGENT, ...headers } });
    if (res.status === 429) {
      // Back off and retry
      const wait = (attempt + 1) * 2000;
      console.warn(`[ingest:species] 429 rate limit — waiting ${wait}ms before retry`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  throw new Error(`Failed after 3 retries: ${url}`);
}

// ── GBIF + Wikipedia data sources ─────────────────────────────────────────────

// GBIF description types we actually want (skip materials_examined, discussion, etc.)
const GBIF_USEFUL_TYPES = new Set([
  'biology_ecology', 'conservation', 'distribution', 'activity', 'food_feeding', 'breeding',
]);

async function fetchFromGBIF(
  speciesName: string
): Promise<Record<string, string>> {
  // Step 1: resolve scientific name → GBIF usageKey
  const matchUrl = `${GBIF_API_BASE}/species/match?name=${encodeURIComponent(speciesName)}`;
  const matchRes = await fetchWithRetry(matchUrl);
  if (!matchRes.ok) return {};

  const match = await matchRes.json() as GBIFMatchResponse;
  if (!match.usageKey || match.matchType === 'NONE') return {};

  await new Promise(r => setTimeout(r, GBIF_DELAY_MS));

  // Step 2: fetch descriptions for this taxon
  // limit=15 avoids loading too many results; descriptions are capped at MAX_DESC_CHARS
  const descUrl = `${GBIF_API_BASE}/species/${match.usageKey}/descriptions?limit=15`;
  const descRes = await fetchWithRetry(descUrl);
  if (!descRes.ok) return {};

  const descText = await descRes.text();
  if (descText.length > 200_000) {
    console.warn(`[ingest:species] GBIF descriptions too large for ${speciesName} (${Math.round(descText.length / 1024)}KB) — skipping`);
    return {};
  }
  const data = JSON.parse(descText) as GBIFDescriptionsResponse;

  // Aggregate sections — for biology_ecology we deduplicate by appending multiple entries
  const sections: Record<string, string> = {};
  const biologyEcologyParts: string[] = [];
  const MAX_DESC_CHARS = 4000;

  for (const item of data.results) {
    if (!GBIF_USEFUL_TYPES.has(item.type)) continue;
    if (item.language !== 'eng') continue;
    if (item.description.trim().length < 50) continue;

    // Cap individual description length before HTML stripping to bound memory usage
    const raw = item.description.length > MAX_DESC_CHARS
      ? item.description.slice(0, MAX_DESC_CHARS)
      : item.description;
    const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (item.type === 'biology_ecology') {
      // Multiple biology_ecology entries — collect all and split into habitat vs ecology
      biologyEcologyParts.push(clean);
    } else {
      const existing = sections[item.type];
      if (existing) {
        sections[item.type] = `${existing} ${clean}`;
      } else {
        sections[item.type] = clean;
      }
    }
  }

  // First biology_ecology entry is usually "Habitat. ..." — map it to habitat
  // Remaining entries map to ecology
  if (biologyEcologyParts.length > 0) {
    sections['biology_ecology'] = biologyEcologyParts[0]!.slice(0, MAX_DESC_CHARS);
    if (biologyEcologyParts.length > 1) {
      sections['ecology'] = biologyEcologyParts.slice(1).join(' ').slice(0, MAX_DESC_CHARS);
    }
  }

  return sections;
}

async function fetchFromWikipedia(
  speciesName: string
): Promise<Record<string, string>> {
  const url = `${WIKIPEDIA_API_BASE}?action=query&prop=extracts` +
    `&titles=${encodeURIComponent(speciesName)}&format=json&explaintext=1&exchars=8000&redirects=1`;

  const res = await fetchWithRetry(url);
  if (!res.ok) return {};

  const data = await res.json() as WikipediaResponse;
  const pages = data.query?.pages;
  if (!pages) return {};

  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined || !page.extract) return {};

  const extract = page.extract;
  const sections: Record<string, string> = {};

  // Parse Wikipedia headings to extract relevant sections
  const sectionPatterns: Array<[RegExp, string]> = [
    [/\bhabitat\b/i,                    'habitat'],
    [/\bthreats?\b/i,                   'threats'],
    [/\bconservation\b/i,               'conservation'],
    [/\b(ecology|behavior|behaviour)\b/i, 'ecology'],
    [/\b(diet|food|feeding)\b/i,        'diet'],
    [/\b(distribution|range)\b/i,       'distribution'],
    [/\bpopulation\b/i,                 'population'],
  ];

  // Split by == Heading == pattern
  const parts = extract.split(/\n==+\s*([^=]+?)\s*==+\n/);

  for (let i = 1; i < parts.length - 1; i += 2) {
    const heading = parts[i] ?? '';
    const content = (parts[i + 1] ?? '').trim();
    if (!content || content.length < 50) continue;

    for (const [pattern, sectionKey] of sectionPatterns) {
      if (pattern.test(heading)) {
        const existing = sections[sectionKey];
        if (existing) {
          sections[sectionKey] = `${existing} ${content}`;
        } else {
          sections[sectionKey] = content;
        }
        break;
      }
    }
  }

  return sections;
}

async function fetchNarrative(
  speciesName: string
): Promise<{ sections: Record<string, string>; sourceDoc: string }> {
  // Primary: GBIF species descriptions
  const gbifSections = await fetchFromGBIF(speciesName);
  const gbifSectionCount = Object.keys(gbifSections).length;

  if (gbifSectionCount >= 2) {
    return { sections: gbifSections, sourceDoc: `GBIF Species Profile — ${speciesName}` };
  }

  // Fallback: Wikipedia (for species GBIF can't fill with ≥2 sections)
  await new Promise(r => setTimeout(r, GBIF_DELAY_MS));
  const wikiSections = await fetchFromWikipedia(speciesName);

  // Merge: GBIF takes precedence, Wikipedia fills any gaps
  const merged = { ...wikiSections, ...gbifSections };

  if (Object.keys(merged).length === 0) {
    return { sections: {}, sourceDoc: '' };
  }

  const sourceDoc = gbifSectionCount > 0
    ? `GBIF Species Profile + Wikipedia — ${speciesName}`
    : `Wikipedia — ${speciesName}`;

  return { sections: merged, sourceDoc };
}

// ── Main ingest ───────────────────────────────────────────────────────────────

async function ingestSpecies(species: SpeciesRow): Promise<void> {
  const { iucn_species_id: taxonId, species_name: speciesName } = species;

  // Skip if already ingested (resumable)
  const existing = await sql`
    SELECT COUNT(*)::int AS count FROM species_facts WHERE species_name = ${speciesName}
  `;
  if ((existing[0]?.count ?? 0) > 0) {
    console.log(`[ingest:species] ${speciesName}: already ingested — skipping`);
    return;
  }

  const { sections, sourceDoc } = await fetchNarrative(speciesName);

  if (Object.keys(sections).length === 0) {
    console.log(`[ingest:species] ${speciesName}: no narrative available`);
    return;
  }

  let totalChunks = 0;

  for (const [fieldName, sectionText] of Object.entries(sections)) {
    const sectionType = SECTION_TYPE_MAP[fieldName] ?? 'ecology';
    const chunks = chunkText(sectionText);

    const queryTexts = chunks.map(
      c => `${speciesName} ${sectionType}: ${c}`
    );
    const embeddings = await embedBatch(queryTexts);

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      const embedding = embeddings[i];
      if (!content || !embedding) continue;

      await sql`
        INSERT INTO species_facts
          (species_name, iucn_species_id, section_type, content, embedding, source_document)
        VALUES (
          ${speciesName},
          ${taxonId},
          ${sectionType},
          ${content},
          ${JSON.stringify(embedding)}::vector,
          ${sourceDoc}
        )
        ON CONFLICT DO NOTHING
      `;
      totalChunks++;
    }
  }

  console.log(`[ingest:species] ${speciesName}: ${totalChunks} chunks ingested`);
}

async function main(): Promise<void> {
  console.log('[ingest:species] Starting species facts ingest from GBIF + Wikipedia...');

  const allSpecies = await sql<SpeciesRow[]>`
    SELECT DISTINCT iucn_species_id, species_name
    FROM species_ranges
    WHERE iucn_species_id IS NOT NULL
    ORDER BY species_name
  `;

  console.log(`[ingest:species] ${allSpecies.length} species to process`);

  let processed = 0;
  let failed = 0;

  for (const species of allSpecies) {
    try {
      await ingestSpecies(species);
      processed++;
    } catch (err) {
      console.error(`[ingest:species] FAILED ${species.species_name}:`, err);
      failed++;
    }
  }

  console.log(`[ingest:species] Done. Processed: ${processed}, Failed: ${failed}`);
  await sql.end();
}

main().catch(err => {
  console.error('[ingest:species] Fatal error:', err);
  process.exit(1);
});
