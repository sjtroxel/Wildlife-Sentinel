/**
 * Ingest species facts from IUCN Red List API v3 into the species_facts pgvector table.
 *
 * Uses the stable v3 API (apiv3.iucnredlist.org) — well-documented, auth via ?token= param.
 * Pulls authoritative narrative assessments for all species in species_ranges.
 * Source documents are citable: "IUCN Red List Assessment — {species_name} ({year})"
 *
 * Usage (from repo root):
 *   npm run ingest:species
 *   (reads DATABASE_URL, IUCN_API_TOKEN, GOOGLE_AI_API_KEY from server/.env)
 *
 * Resumable: skips species that already have entries in species_facts.
 * Idempotent: ON CONFLICT DO NOTHING prevents duplicate chunks.
 * Rate-limited: 100ms between embed calls to stay within free tier limits.
 */
import postgres from 'postgres';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Env validation ──────────────────────────────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL'];
const IUCN_API_TOKEN = process.env['IUCN_API_TOKEN'];
const GOOGLE_AI_API_KEY = process.env['GOOGLE_AI_API_KEY'];

if (!DATABASE_URL || !IUCN_API_TOKEN || !GOOGLE_AI_API_KEY) {
  console.error('Missing required env vars: DATABASE_URL, IUCN_API_TOKEN, GOOGLE_AI_API_KEY');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 5 });
const genai = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);

// ── Constants ────────────────────────────────────────────────────────────────

const IUCN_API_BASE = 'https://apiv3.iucnredlist.org/api/v3';
const EMBEDDING_MODEL = 'text-embedding-004';
const MAX_CHUNK_CHARS = 512 * 4;
const OVERLAP_CHARS = 50 * 4;
const EMBED_DELAY_MS = 100;

// Map IUCN API narrative field names → our section_type CHECK values
const SECTION_TYPE_MAP: Record<string, string> = {
  habitat:                  'habitat',
  habitat_and_ecology:      'habitat',
  ecology:                  'ecology',
  ecology_and_habitats:     'ecology',
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

// v3 narrative response: { "name": "...", "result": [{ "habitat": "...", "threats": "...", ... }] }
interface IUCNNarrativeResponse {
  name?: string;
  result?: Array<Record<string, string | null>>;
}

// v3 species-by-id response (used to get assessment year)
interface IUCNSpeciesResponse {
  result?: Array<{ assessment_date?: string; published_year?: number }>;
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
    start = end - OVERLAP_CHARS;
  }

  return chunks;
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[]> {
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embedText(text));
    await new Promise(r => setTimeout(r, EMBED_DELAY_MS));
  }
  return results;
}

// ── IUCN API ──────────────────────────────────────────────────────────────────

async function fetchNarrative(
  taxonId: string
): Promise<{ sections: Record<string, string>; year: number | null }> {
  // v3 narrative endpoint — auth via query param
  const url = `${IUCN_API_BASE}/species/narrative/id/${taxonId}?token=${IUCN_API_TOKEN}`;
  const res = await fetch(url);

  if (res.status === 404) return { sections: {}, year: null };
  if (!res.ok) {
    throw new Error(`IUCN API ${res.status} for taxon ${taxonId}: ${await res.text()}`);
  }

  const body = await res.json() as IUCNNarrativeResponse;
  const narrative = body.result?.[0];
  if (!narrative) return { sections: {}, year: null };

  // Extract non-null string sections, stripping HTML tags
  const sections: Record<string, string> = {};
  for (const [key, value] of Object.entries(narrative)) {
    if (value && typeof value === 'string' && value.trim().length > 50) {
      const clean = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean.length > 50) {
        sections[key.toLowerCase()] = clean;
      }
    }
  }

  // Fetch assessment year from species endpoint
  let year: number | null = null;
  try {
    const speciesRes = await fetch(
      `${IUCN_API_BASE}/species/id/${taxonId}?token=${IUCN_API_TOKEN}`
    );
    if (speciesRes.ok) {
      const speciesBody = await speciesRes.json() as IUCNSpeciesResponse;
      const published = speciesBody.result?.[0]?.published_year;
      if (published) year = published;
    }
  } catch {
    // Year is optional — continue without it
  }

  return { sections, year };
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

  const { sections, year } = await fetchNarrative(taxonId);

  if (Object.keys(sections).length === 0) {
    console.log(`[ingest:species] ${speciesName}: no narrative available`);
    return;
  }

  const sourceDoc = year
    ? `IUCN Red List Assessment — ${speciesName} (${year})`
    : `IUCN Red List Assessment — ${speciesName}`;

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
  console.log('[ingest:species] Starting species facts ingest from IUCN Red List API v4...');

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
