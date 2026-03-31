import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.hoisted(() =>
  Object.assign(vi.fn().mockResolvedValue([]), { end: vi.fn() })
);
vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));

import { getAgentPrompt } from '../../src/db/agentPrompts.js';

describe('getAgentPrompt', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the system_prompt string when agent exists', async () => {
    mockSql.mockResolvedValueOnce([{ system_prompt: 'You are a threat assessment agent.' }]);

    const result = await getAgentPrompt('threat-assessment');

    expect(result).toBe('You are a threat assessment agent.');
    expect(mockSql).toHaveBeenCalledOnce();
  });

  it('throws when no row is found for the agent name', async () => {
    mockSql.mockResolvedValueOnce([]);

    await expect(getAgentPrompt('missing-agent')).rejects.toThrow(
      'No prompt found for agent: missing-agent'
    );
  });
});
