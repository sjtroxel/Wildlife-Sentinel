/**
 * Text chunking utilities for RAG ingest.
 *
 * chunkBySection  — used by species_facts (species ecology sections)
 * chunkByHeadings — used by conservation_context (narrative documents)
 *
 * No SDK imports. Fully testable without mocks.
 */

export interface Chunk {
  content: string;
  metadata: Record<string, string | number>;
}

// ~512 tokens × 4 chars/token
const MAX_CHUNK_CHARS = 512 * 4;
// ~50 tokens overlap
const OVERLAP_CHARS = 50 * 4;

/**
 * Chunk a single section of text (e.g. one IUCN narrative field).
 * Splits at paragraph boundaries where possible to preserve semantic coherence.
 */
export function chunkBySection(
  text: string,
  sectionType: string,
  speciesName: string,
  sourceDocument: string
): Chunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.length <= MAX_CHUNK_CHARS) {
    return [{
      content: trimmed,
      metadata: { species_name: speciesName, section_type: sectionType, source_document: sourceDocument },
    }];
  }

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, trimmed.length);

    if (end < trimmed.length) {
      // Prefer to end at a paragraph boundary
      const paragraphEnd = trimmed.lastIndexOf('\n\n', end);
      if (paragraphEnd > start + MAX_CHUNK_CHARS / 2) {
        end = paragraphEnd;
      }
    }

    const content = trimmed.slice(start, end).trim();
    if (content) {
      chunks.push({
        content,
        metadata: {
          species_name: speciesName,
          section_type: sectionType,
          source_document: sourceDocument,
          chunk_index: chunks.length,
        },
      });
    }

    // Break after processing the final segment to prevent infinite loop
    // when end == text.length and start = end - OVERLAP_CHARS would not advance
    if (end >= trimmed.length) break;

    start = end - OVERLAP_CHARS;
  }

  return chunks;
}

/**
 * Chunk a multi-section narrative document (e.g. WWF Living Planet Report).
 * Splits on heading-like lines, then applies chunkBySection to each section body.
 * Falls back to flat chunking if no headings are detected.
 */
export function chunkByHeadings(
  text: string,
  documentTitle: string,
  sourceDocument: string
): Chunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Headings: short lines (≤80 chars) that are followed by a blank line or are all-caps/title-cased
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
        stripped === stripped.toUpperCase() ||          // ALL CAPS
        /^#{1,4}\s/.test(stripped) ||                  // Markdown heading
        /^[A-Z][A-Za-z\s\-:]{3,79}$/.test(stripped)  // Title-like (no numbers, starts with cap)
      );

    if (isHeading && bodyLines.join(' ').trim().length > 0) {
      sections.push({ heading: currentHeading, body: bodyLines.join('\n') });
      currentHeading = stripped.replace(/^#{1,4}\s/, '');
      bodyLines = [];
    } else {
      bodyLines.push(line);
    }
  }
  // Push the final section
  if (bodyLines.join(' ').trim().length > 0) {
    sections.push({ heading: currentHeading, body: bodyLines.join('\n') });
  }

  // If no section structure was detected, fall back to flat chunking.
  // Still inject document_title into metadata for conservation_context queries.
  if (sections.length <= 1) {
    return chunkBySection(trimmed, 'content', documentTitle, sourceDocument).map(c => ({
      ...c,
      metadata: { ...c.metadata, document_title: documentTitle, section_heading: documentTitle },
    }));
  }

  const result: Chunk[] = [];
  for (const section of sections) {
    const sectionChunks = chunkBySection(section.body, 'section', documentTitle, sourceDocument);
    for (const chunk of sectionChunks) {
      result.push({
        content: chunk.content,
        metadata: {
          ...chunk.metadata,
          document_title: documentTitle,
          section_heading: section.heading,
        },
      });
    }
  }

  return result;
}
