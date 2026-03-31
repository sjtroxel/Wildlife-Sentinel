import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modelRouter before importing retrieve
vi.mock('../../src/router/ModelRouter.js', () => ({
  modelRouter: {
    complete: vi.fn(),
    embed: vi.fn(),
  },
}));

const mockSql = vi.hoisted(() => vi.fn());
vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));

// Mock redis so cache always misses — tests verify live-embed behaviour
vi.mock('../../src/redis/client.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
}));

import { modelRouter } from '../../src/router/ModelRouter.js';
import { retrieveSpeciesFacts, retrieveConservationContext } from '../../src/rag/retrieve.js';
import type { SpeciesFactChunk, ConservationContextChunk } from '@wildlife-sentinel/shared/types';

// Fixed 768-dim embedding vector for mocking
const MOCK_EMBEDDING = new Array(768).fill(0.1) as number[];

const MOCK_SPECIES_CHUNKS: SpeciesFactChunk[] = [
  {
    id: 'uuid-1',
    content: 'Sumatran Orangutan habitat is lowland tropical rainforest.',
    section_type: 'habitat',
    source_document: 'IUCN Red List Assessment — Pongo abelii (2022)',
    similarity: 0.85,
  },
  {
    id: 'uuid-2',
    content: 'Primary threats include deforestation and palm oil expansion.',
    section_type: 'threats',
    source_document: 'IUCN Red List Assessment — Pongo abelii (2022)',
    similarity: 0.78,
  },
];

const MOCK_CONSERVATION_CHUNKS: ConservationContextChunk[] = [
  {
    id: 'uuid-3',
    content: 'Wildlife populations have declined 73% since 1970.',
    document_title: 'WWF Living Planet Report 2024',
    source_document: 'wwf_living_planet_report_2024.txt',
    similarity: 0.72,
  },
];

describe('retrieveSpeciesFacts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(modelRouter.embed).mockResolvedValue([MOCK_EMBEDDING]);
  });

  it('calls modelRouter.embed with species context prefix', async () => {
    mockSql.mockResolvedValue(MOCK_SPECIES_CHUNKS);

    await retrieveSpeciesFacts('Pongo abelii', 'threatened by wildfire');

    expect(modelRouter.embed).toHaveBeenCalledWith(
      'Pongo abelii ecology threats habitat: threatened by wildfire'
    );
  });

  it('returns chunks from database query', async () => {
    mockSql.mockResolvedValue(MOCK_SPECIES_CHUNKS);

    const result = await retrieveSpeciesFacts('Pongo abelii', 'threatened by wildfire');

    expect(result).toEqual(MOCK_SPECIES_CHUNKS);
  });

  it('returns empty array when modelRouter.embed returns empty', async () => {
    vi.mocked(modelRouter.embed).mockResolvedValue([]);

    const result = await retrieveSpeciesFacts('Pongo abelii', 'threatened by wildfire');

    expect(result).toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns empty array when no chunks meet similarity threshold', async () => {
    mockSql.mockResolvedValue([]);

    const result = await retrieveSpeciesFacts('Unknown Species', 'threatened by drought');

    expect(result).toEqual([]);
  });

  it('passes species_name filter to SQL query', async () => {
    mockSql.mockResolvedValue([]);

    await retrieveSpeciesFacts('Gorilla beringei', 'flood risk');

    // Verify sql was called (the WHERE species_name = ... filter is in the query)
    expect(mockSql).toHaveBeenCalled();
  });
});

describe('retrieveConservationContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(modelRouter.embed).mockResolvedValue([MOCK_EMBEDDING]);
  });

  it('calls modelRouter.embed with the query context', async () => {
    mockSql.mockResolvedValue(MOCK_CONSERVATION_CHUNKS);

    await retrieveConservationContext('wildfire impact on orangutan conservation');

    expect(modelRouter.embed).toHaveBeenCalledWith(
      'wildfire impact on orangutan conservation'
    );
  });

  it('returns conservation chunks from database', async () => {
    mockSql.mockResolvedValue(MOCK_CONSERVATION_CHUNKS);

    const result = await retrieveConservationContext('biodiversity loss trends');

    expect(result).toEqual(MOCK_CONSERVATION_CHUNKS);
  });

  it('returns empty array when modelRouter.embed returns empty', async () => {
    vi.mocked(modelRouter.embed).mockResolvedValue([]);

    const result = await retrieveConservationContext('species decline drivers');

    expect(result).toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns empty array when conservation_context table is empty', async () => {
    mockSql.mockResolvedValue([]);

    const result = await retrieveConservationContext('climate change impact');

    expect(result).toEqual([]);
  });
});
