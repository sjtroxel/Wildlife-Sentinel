import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xadd: vi.fn().mockResolvedValue('1234-0'),
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: { RAW: 'disaster:raw' },
}));

import { BaseScout, fetchWithRetry } from '../../src/scouts/BaseScout.js';
import { redis } from '../../src/redis/client.js';

class AlwaysFailScout extends BaseScout {
  constructor() {
    super({
      name: 'test_scout',
      dedupTtlSeconds: 60,
      maxConsecutiveFailures: 3,
      circuitOpenMinutes: 60,
    });
  }

  protected fetchEvents(): Promise<RawDisasterEvent[]> {
    return Promise.reject(new Error('Simulated fetch failure'));
  }
}

// A fetch mock that respects AbortController — required to test timeout behaviour.
// Uses real timers with a tiny timeout (5ms) to keep test runtime short.
function makePendingFetch(onAbort?: () => void) {
  return vi.fn((_url: string, opts?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => {
        if (onAbort) onAbort();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })
  );
}

describe('fetchWithRetry — timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws after timeout when server never responds (single attempt)', async () => {
    vi.stubGlobal('fetch', makePendingFetch());
    // 5ms timeout, 1 attempt — resolves immediately once AbortController fires
    await expect(fetchWithRetry('https://example.com', undefined, 1, 5))
      .rejects.toThrow('Timeout after 5ms');
  });

  it('retries on timeout and throws after all attempts exhausted', async () => {
    let abortCount = 0;
    vi.stubGlobal('fetch', makePendingFetch(() => abortCount++));
    // 5ms timeout, 2 attempts — total ~1005ms (5ms + 1000ms backoff + 5ms)
    await expect(fetchWithRetry('https://example.com', undefined, 2, 5))
      .rejects.toThrow('Timeout after 5ms');
    expect(abortCount).toBe(2);
  }, 5000);

  it('succeeds on retry after a transient timeout', async () => {
    const okResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, opts?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return new Promise<Response>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      return Promise.resolve(okResponse);
    }));
    // 5ms timeout, 2 attempts — first times out, second succeeds (~1005ms total)
    const result = await fetchWithRetry('https://example.com', undefined, 2, 5);
    expect(result.status).toBe(200);
  }, 5000);
});

describe('BaseScout circuit breaker', () => {
  let scout: AlwaysFailScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new AlwaysFailScout();
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
    vi.mocked(redis.del).mockResolvedValue(1);
    vi.mocked(redis.expire).mockResolvedValue(1);
    vi.mocked(redis.setex).mockResolvedValue('OK');
  });

  it('opens circuit after maxConsecutiveFailures', async () => {
    // incr returns 1, 2, 3 across the three failure runs
    vi.mocked(redis.incr)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    // Capture the open_until value written by setex so we can return it from get
    let circuitOpenUntilVal: string | null = null;
    vi.mocked(redis.setex).mockImplementation(async (key: string, _ttl: number, value: string) => {
      if (key.startsWith('circuit:open_until:')) circuitOpenUntilVal = value;
      return 'OK';
    });
    vi.mocked(redis.get).mockImplementation(async (key: string) => {
      if (key.startsWith('circuit:open_until:')) return circuitOpenUntilVal;
      return null; // pipeline:paused = null
    });

    await scout.run(); // failure 1 — incr→1
    await scout.run(); // failure 2 — incr→2
    await scout.run(); // failure 3 — incr→3, circuit opens

    const xaddCallsBefore = vi.mocked(redis.xadd).mock.calls.length;

    // Circuit is now open — this run should be skipped entirely
    await scout.run();

    expect(vi.mocked(redis.xadd).mock.calls.length).toBe(xaddCallsBefore);
  });

  it('resets failure count on a successful run', async () => {
    class SometimesFailScout extends BaseScout {
      private callCount = 0;
      constructor() {
        super({
          name: 'test_scout_2',
          dedupTtlSeconds: 60,
          maxConsecutiveFailures: 3,
          circuitOpenMinutes: 60,
        });
      }
      protected fetchEvents(): Promise<RawDisasterEvent[]> {
        this.callCount++;
        if (this.callCount === 2) return Promise.resolve([]); // success on 2nd call
        return Promise.reject(new Error('Simulated failure'));
      }
    }

    // incr returns 1 (run1), 1 (run3 — fresh after del), 2 (run4), 3 (run5)
    vi.mocked(redis.incr)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    let circuitOpenUntilVal: string | null = null;
    vi.mocked(redis.setex).mockImplementation(async (key: string, _ttl: number, value: string) => {
      if (key.startsWith('circuit:open_until:')) circuitOpenUntilVal = value;
      return 'OK';
    });
    vi.mocked(redis.get).mockImplementation(async (key: string) => {
      if (key.startsWith('circuit:open_until:')) return circuitOpenUntilVal;
      return null;
    });

    const s = new SometimesFailScout();
    await s.run(); // failure 1 — incr→1
    await s.run(); // success — del resets counter
    await s.run(); // failure 1 again — incr→1
    await s.run(); // failure 2 — incr→2
    await s.run(); // failure 3 — incr→3, circuit opens

    // 6th run skipped
    const callsBefore = vi.mocked(redis.xadd).mock.calls.length;
    await s.run();
    expect(vi.mocked(redis.xadd).mock.calls.length).toBe(callsBefore);
  });
});
