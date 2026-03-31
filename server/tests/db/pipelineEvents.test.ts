import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.hoisted(() =>
  Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn() })
);
vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));

import { logPipelineEvent } from '../../src/db/pipelineEvents.js';

describe('logPipelineEvent', () => {
  beforeEach(() => vi.resetAllMocks());

  it('calls sql once for a published event', async () => {
    await logPipelineEvent({
      event_id: 'firms-abc123',
      source: 'nasa_firms',
      stage: 'enrichment',
      status: 'published',
    });

    expect(mockSql).toHaveBeenCalledOnce();
  });

  it('calls sql once for a filtered event with a reason', async () => {
    await logPipelineEvent({
      event_id: 'firms-xyz456',
      source: 'nasa_firms',
      stage: 'enrichment',
      status: 'filtered',
      reason: 'no habitat overlap within 50km',
    });

    expect(mockSql).toHaveBeenCalledOnce();
  });

  it('calls sql once for an error event', async () => {
    await logPipelineEvent({
      event_id: 'nhc-storm001',
      source: 'noaa_nhc',
      stage: 'threat_assessment',
      status: 'error',
      reason: 'LLM call failed after 3 retries',
    });

    expect(mockSql).toHaveBeenCalledOnce();
  });
});
