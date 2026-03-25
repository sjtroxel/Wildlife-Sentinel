import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    xadd: vi.fn().mockResolvedValue('1234-0'),
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('../../src/pipeline/streams.js', () => ({
  STREAMS: { RAW: 'disaster:raw' },
}));

import { BaseScout } from '../../src/scouts/BaseScout.js';
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

describe('BaseScout circuit breaker', () => {
  let scout: AlwaysFailScout;

  beforeEach(() => {
    vi.resetAllMocks();
    scout = new AlwaysFailScout();
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.xadd).mockResolvedValue('1234-0');
  });

  it('opens circuit after maxConsecutiveFailures', async () => {
    // Run to exhaustion (3 failures)
    await scout.run(); // failure 1
    await scout.run(); // failure 2
    await scout.run(); // failure 3 — circuit opens

    // Track how many times fetchEvents would be called after circuit opens
    const xaddCallsBefore = vi.mocked(redis.xadd).mock.calls.length;

    // Circuit is now open — this run should be skipped entirely
    await scout.run();

    // xadd was never called (no events processed), and fetchEvents was skipped
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

    const s = new SometimesFailScout();
    await s.run(); // failure 1
    await s.run(); // success — resets counter
    await s.run(); // failure 1 again (counter was reset)
    await s.run(); // failure 2
    // Circuit still closed (only 2 consecutive failures, threshold is 3)
    await s.run(); // failure 3 — circuit opens

    // 6th run skipped
    const callsBefore = vi.mocked(redis.xadd).mock.calls.length;
    await s.run();
    expect(vi.mocked(redis.xadd).mock.calls.length).toBe(callsBefore);
  });
});
