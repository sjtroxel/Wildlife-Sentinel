import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.hoisted(() =>
  Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn() })
);
vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));

import { logModelUsage, getTotalCostUsd, getCostByModel } from '../../src/db/modelUsage.js';

describe('logModelUsage', () => {
  beforeEach(() => vi.resetAllMocks());

  it('calls sql once with the usage record fields', async () => {
    await logModelUsage({
      model: 'claude-sonnet-4-6',
      inputTokens: 500,
      outputTokens: 200,
      estimatedCostUsd: 0.0045,
    });

    expect(mockSql).toHaveBeenCalledOnce();
  });
});

describe('getTotalCostUsd', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns parsed float when rows are present', async () => {
    mockSql.mockResolvedValueOnce([{ total: '4.20' }]);

    const result = await getTotalCostUsd();

    expect(result).toBe(4.20);
  });

  it('returns 0 when the table is empty (COALESCE returns "0")', async () => {
    mockSql.mockResolvedValueOnce([{ total: '0' }]);

    const result = await getTotalCostUsd();

    expect(result).toBe(0);
  });

  it('returns 0 when result array is empty (defensive fallback)', async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await getTotalCostUsd();

    expect(result).toBe(0);
  });
});

describe('getCostByModel', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the rows from sql directly', async () => {
    const rows = [
      { model: 'claude-sonnet-4-6', total_cost: '3.50', call_count: '12' },
      { model: 'gemini-2.5-flash-lite', total_cost: '0.01', call_count: '240' },
    ];
    mockSql.mockResolvedValueOnce(rows);

    const result = await getCostByModel();

    expect(result).toEqual(rows);
    expect(mockSql).toHaveBeenCalledOnce();
  });

  it('returns empty array when no usage has been logged', async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await getCostByModel();

    expect(result).toEqual([]);
  });
});
