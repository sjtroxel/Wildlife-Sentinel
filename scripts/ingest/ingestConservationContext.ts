/**
 * Ingest conservation context documents into the conservation_context pgvector table.
 *
 * Reads plain .txt files from scripts/ingest/sources/conservation/.
 * Files must be manually extracted from PDFs before running this script.
 *
 * Filename convention: {descriptive_name}_{year}.txt
 * Examples:
 *   ipbes_global_assessment_spm_2019.txt
 *   wwf_living_planet_report_2024.txt
 *   cbd_global_biodiversity_outlook_5_2020.txt
 *
 * Usage:
 *   export DATABASE_URL="..."
 *   export GOOGLE_AI_API_KEY="..."
 *   npm run ingest:conservation   (from scripts/ directory)
 *
 * Idempotent: ON CONFLICT DO NOTHING prevents duplicate chunks.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = join(__dirname, 'sources', 'conservation');
const EMBEDDING_MODEL = 'gemini-embedding-001';
const MAX_CHUNK_CHARS = 512 * 4;
const OVERLAP_CHARS = 50 * 4;
const EMBED_DELAY_MS = 100;

// ── Chunking ─────────────────────────────────────────────────────────────────

interface DocumentChunk {
  content: string;
  sectionHeading: string;
}

function chunkDocument(text: string, documentTitle: string): DocumentChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading = documentTitle;
  let bodyLines: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    const isHeading =
      stripped.length > 0 &&
      stripped.length <= 80 &&
      (
        stripped === stripped.toUpperCase() ||
        /^#{1,4}\s/.test(stripped) ||
        /^[A-Z][A-Za-z\s\-:]{3,79}$/.test(stripped)
      );

    if (isHeading && bodyLines.join(' ').trim().length > 0) {
      sections.push({ heading: currentHeading, body: bodyLines.join('\n') });
      currentHeading = stripped.replace(/^#{1,4}\s/, '');
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }
  if (bodyLines.join(' ').trim().length > 0) {
    sections.push({ heading: currentHeading, body: bodyLines.join('\n') });
  }

  // Fall back to flat chunking if no headings found
  const effectiveSections = sections.length <= 1
    ? [{ heading: documentTitle, body: trimmed }]
    : sections;

  const result: DocumentChunk[] = [];

  for (const section of effectiveSections) {
    const bodyTrimmed = section.body.trim();
    if (!bodyTrimmed) continue;

    // Chunk the section body
    let start = 0;
    while (start < bodyTrimmed.length) {
      let end = Math.min(start + MAX_CHUNK_CHARS, bodyTrimmed.length);

      if (end < bodyTrimmed.length) {
        const paragraphEnd = bodyTrimmed.lastIndexOf('\n\n', end);
        if (paragraphEnd > start + MAX_CHUNK_CHARS / 2) {
          end = paragraphEnd;
        }
      }

      const content = bodyTrimmed.slice(start, end).trim();
      if (content.length > 50) {
        result.push({ content, sectionHeading: section.heading });
      }
      if (end >= bodyTrimmed.length) break;
      start = end - OVERLAP_CHARS;
    }
  }

  return result;
}

// ── Filename parsing ──────────────────────────────────────────────────────────

function parseFilename(filename: string): { documentTitle: string; publicationYear: number | null } {
  const withoutExt = filename.replace(/\.txt$/, '');
  // Extract trailing 4-digit year: e.g. "ipbes_global_assessment_spm_2019" → year 2019
  const yearMatch = withoutExt.match(/_(\d{4})$/);
  const year = yearMatch ? parseInt(yearMatch[1]!, 10) : null;
  const titlePart = yearMatch ? withoutExt.slice(0, -5) : withoutExt;
  // Convert underscores to spaces and title-case
  const documentTitle = titlePart
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return { documentTitle, publicationYear: year };
}

// ── Embedding ─────────────────────────────────────────────────────────────────

interface EmbedResponse {
  embedding: { values: number[] };
}

async function embedText(text: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_AI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: 1536,
    }),
  });
  if (!res.ok) {
    throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
  }
  const data = await res.json() as EmbedResponse;
  return data.embedding.values;
}

// ── Main ingest ───────────────────────────────────────────────────────────────

async function ingestDocument(filePath: string, filename: string): Promise<void> {
  const { documentTitle, publicationYear } = parseFilename(filename);
  const text = readFileSync(filePath, 'utf8');
  const chunks = chunkDocument(text, documentTitle);

  if (chunks.length === 0) {
    console.log(`[ingest:conservation] ${filename}: no usable content — skipping`);
    return;
  }

  let ingested = 0;
  for (const chunk of chunks) {
    await new Promise(r => setTimeout(r, EMBED_DELAY_MS));
    const embedding = await embedText(
      `${documentTitle} ${chunk.sectionHeading}: ${chunk.content}`
    );

    await sql`
      INSERT INTO conservation_context
        (document_title, section_heading, content, embedding, source_document, publication_year)
      VALUES (
        ${documentTitle},
        ${chunk.sectionHeading},
        ${chunk.content},
        ${JSON.stringify(embedding)}::vector,
        ${filename},
        ${publicationYear}
      )
      ON CONFLICT DO NOTHING
    `;
    ingested++;
  }

  console.log(`[ingest:conservation] ${filename}: ${ingested} chunks ingested`);
}

async function main(): Promise<void> {
  console.log('[ingest:conservation] Starting conservation context ingest...');

  if (!existsSync(SOURCES_DIR)) {
    console.error(`[ingest:conservation] Sources directory not found: ${SOURCES_DIR}`);
    console.error('Create scripts/ingest/sources/conservation/ and add .txt files.');
    process.exit(1);
  }

  const files = readdirSync(SOURCES_DIR).filter(f => f.endsWith('.txt'));

  if (files.length === 0) {
    console.error('[ingest:conservation] No .txt files found in sources/conservation/');
    console.error('Extract PDFs to .txt and place them in that directory first.');
    process.exit(1);
  }

  console.log(`[ingest:conservation] Found ${files.length} document(s): ${files.join(', ')}`);

  for (const filename of files) {
    const filePath = join(SOURCES_DIR, filename);
    try {
      await ingestDocument(filePath, filename);
    } catch (err) {
      console.error(`[ingest:conservation] FAILED ${filename}:`, err);
    }
  }

  console.log('[ingest:conservation] Done.');
  await sql.end();
}

main().catch(err => {
  console.error('[ingest:conservation] Fatal error:', err);
  process.exit(1);
});
