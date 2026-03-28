import { describe, it, expect } from 'vitest';
import { chunkBySection, chunkByHeadings } from '../../src/rag/chunker.js';

const SPECIES = 'Pongo abelii';
const SOURCE = 'IUCN Red List Assessment — Pongo abelii (2022)';

describe('chunkBySection', () => {
  it('returns empty array for empty string', () => {
    expect(chunkBySection('', 'threats', SPECIES, SOURCE)).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(chunkBySection('   \n\n  ', 'threats', SPECIES, SOURCE)).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    const text = 'The Sumatran Orangutan is threatened by deforestation.';
    const chunks = chunkBySection(text, 'threats', SPECIES, SOURCE);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(text);
    expect(chunks[0]?.metadata['section_type']).toBe('threats');
    expect(chunks[0]?.metadata['species_name']).toBe(SPECIES);
    expect(chunks[0]?.metadata['source_document']).toBe(SOURCE);
  });

  it('returns multiple chunks for text longer than MAX_CHUNK_CHARS', () => {
    // ~2200 chars — exceeds 512 * 4 = 2048
    const paragraph = 'This is a long paragraph about species ecology and threats. '.repeat(37);
    const chunks = chunkBySection(paragraph, 'ecology', SPECIES, SOURCE);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('prefers paragraph boundary over mid-sentence split', () => {
    // Build text with a clear paragraph break near the 2048-char boundary
    const para1 = 'A'.repeat(1500) + '\n\n';
    const para2 = 'B'.repeat(1000);
    const text = para1 + para2;
    const chunks = chunkBySection(text, 'habitat', SPECIES, SOURCE);
    // First chunk should end at paragraph boundary (no 'B' characters)
    expect(chunks[0]?.content).not.toContain('B');
  });

  it('each chunk has chunk_index in metadata when multiple chunks produced', () => {
    const longText = 'Conservation text. '.repeat(200);
    const chunks = chunkBySection(longText, 'population', SPECIES, SOURCE);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.metadata['chunk_index']).toBe(i);
    });
  });
});

describe('chunkByHeadings', () => {
  it('returns empty array for empty string', () => {
    expect(chunkByHeadings('', 'WWF Living Planet Report 2024', 'wwf_living_planet_report_2024.txt')).toEqual([]);
  });

  it('splits on uppercase heading lines', () => {
    const text = [
      'BIODIVERSITY LOSS',
      'Wildlife populations have declined by 73% since 1970.',
      '',
      'CLIMATE DRIVERS',
      'Climate change is the second-largest driver of biodiversity loss globally.',
    ].join('\n');

    const chunks = chunkByHeadings(text, 'WWF Report', 'wwf_report_2024.txt');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to flat chunking when no headings detected', () => {
    const text = 'No headings here. Just a paragraph of text about conservation.';
    const chunks = chunkByHeadings(text, 'Test Document', 'test_2024.txt');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.content).toBeTruthy();
  });

  it('includes document_title in metadata', () => {
    const text = 'THREATS\nHabitat loss affects many species globally.';
    const chunks = chunkByHeadings(text, 'IPBES Assessment', 'ipbes_2019.txt');
    if (chunks.length > 0) {
      expect(chunks[0]?.metadata['document_title']).toBe('IPBES Assessment');
    }
  });
});
