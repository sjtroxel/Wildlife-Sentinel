import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPublish = vi.hoisted(() => vi.fn().mockResolvedValue(1));

vi.mock('../../src/discord/bot.js', () => ({
  getSentinelOpsChannel: vi.fn().mockReturnValue({ send: mockSend }),
  startBot: vi.fn(),
}));

vi.mock('../../src/redis/client.js', () => ({
  redis: { publish: mockPublish },
}));

import { logToWarRoom } from '../../src/discord/warRoom.js';

// Use fake timers throughout — we advance 1s in beforeEach so the module-level
// lastPostTime is always stale for "normal" tests.
beforeEach(() => {
  // clearAllMocks (not resetAllMocks) — preserves mockReturnValue on getSentinelOpsChannel.
  // resetAllMocks would wipe it, causing getSentinelOpsChannel() to return undefined and
  // .send() to throw — silently swallowed by the outer try/catch, making tests mislead.
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.advanceTimersByTime(1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('message formatting', () => {
  it('uses ⚙️ emoji by default (no level specified)', async () => {
    const p = logToWarRoom({ agent: 'enrichment', action: 'processed', detail: 'event-1' });
    await vi.runAllTimersAsync();
    await p;

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0]?.[0]).toContain('⚙️');
    expect(mockSend.mock.calls[0]?.[0]).toContain('[enrichment]');
    expect(mockSend.mock.calls[0]?.[0]).toContain('processed');
    expect(mockSend.mock.calls[0]?.[0]).toContain('event-1');
  });

  it('uses ⚠️ emoji for level=warning', async () => {
    const p = logToWarRoom({ agent: 'threat', action: 'low confidence', detail: '0.42', level: 'warning' });
    await vi.runAllTimersAsync();
    await p;

    expect(mockSend.mock.calls[0]?.[0]).toContain('⚠️');
  });

  it('uses 🔴 emoji for level=alert', async () => {
    const p = logToWarRoom({ agent: 'synthesis', action: 'critical alert', detail: 'Pongo abelii', level: 'alert' });
    await vi.runAllTimersAsync();
    await p;

    expect(mockSend.mock.calls[0]?.[0]).toContain('🔴');
  });
});

describe('redis publish', () => {
  it('publishes a JSON payload to agent:activity', async () => {
    const p = logToWarRoom({ agent: 'habitat', action: 'sighting found', detail: 'Pongo abelii' });
    await vi.runAllTimersAsync();
    await p;

    expect(mockPublish).toHaveBeenCalledOnce();
    expect(mockPublish.mock.calls[0]?.[0]).toBe('agent:activity');

    const payload = JSON.parse(mockPublish.mock.calls[0]?.[1] as string) as Record<string, unknown>;
    expect(payload['agent']).toBe('habitat');
    expect(payload['action']).toBe('sighting found');
    expect(payload['detail']).toBe('Pongo abelii');
    expect(typeof payload['timestamp']).toBe('string');
  });
});

describe('error swallowing', () => {
  it('does not throw when Discord send fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('Discord API unavailable'));

    const p = logToWarRoom({ agent: 'scout', action: 'error', detail: 'test' });
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBeUndefined();
  });

  it('does not throw when redis.publish fails', async () => {
    mockPublish.mockRejectedValueOnce(new Error('Redis connection lost'));

    const p = logToWarRoom({ agent: 'scout', action: 'error', detail: 'test' });
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('delays a second call made within 500ms of the first', async () => {
    // First call — lastPostTime is stale (1s advance in beforeEach), no wait
    const first = logToWarRoom({ agent: 'scout', action: 'fetch', detail: 'first' });
    await vi.runAllTimersAsync();
    await first;

    // Don't advance time — second call is "immediate" relative to lastPostTime
    const second = logToWarRoom({ agent: 'scout', action: 'fetch', detail: 'second' });

    // send was called once (first call); second is pending in setTimeout
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Flush the 500ms wait
    await vi.runAllTimersAsync();
    await second;

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
