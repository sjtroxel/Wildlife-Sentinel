import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { redis } from '../redis/client.js';
import { STREAMS } from '../pipeline/streams.js';

export interface ScoutConfig {
  name: string;
  dedupTtlSeconds: number;
  maxConsecutiveFailures: number;
  circuitOpenMinutes: number;
}

export abstract class BaseScout {
  private consecutiveFailures = 0;
  private circuitOpenUntil: Date | null = null;

  constructor(protected readonly config: ScoutConfig) {}

  protected abstract fetchEvents(): Promise<RawDisasterEvent[]>;

  async run(): Promise<void> {
    if (this.circuitOpenUntil && new Date() < this.circuitOpenUntil) {
      console.log(`[${this.config.name}] Circuit open until ${this.circuitOpenUntil.toISOString()} — skipping`);
      return;
    }

    try {
      const events = await this.fetchEvents();
      this.consecutiveFailures = 0;

      let published = 0;
      let deduped = 0;

      for (const event of events) {
        const isDupe = await this.isDuplicate(event.id);
        if (isDupe) { deduped++; continue; }

        await redis.xadd(STREAMS.RAW, '*', 'data', JSON.stringify(event));
        await this.markSeen(event.id);
        published++;
      }

      if (published > 0 || deduped > 0) {
        console.log(`[${this.config.name}] Published: ${published}, Deduped: ${deduped}`);
      }
    } catch (err) {
      this.consecutiveFailures++;
      console.error(`[${this.config.name}] Fetch error (${this.consecutiveFailures}/${this.config.maxConsecutiveFailures}):`, err);

      if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        this.circuitOpenUntil = new Date(Date.now() + this.config.circuitOpenMinutes * 60_000);
        console.error(`[${this.config.name}] Circuit OPEN until ${this.circuitOpenUntil.toISOString()}`);
      }
    }
  }

  private async isDuplicate(eventId: string): Promise<boolean> {
    const key = `dedup:${this.config.name}:${eventId}`;
    const result = await redis.get(key);
    return result !== null;
  }

  private async markSeen(eventId: string): Promise<void> {
    const key = `dedup:${this.config.name}:${eventId}`;
    await redis.setex(key, this.config.dedupTtlSeconds, '1');
  }
}

/**
 * Retry a fetch with exponential backoff.
 * Only retries on transient errors (429/5xx). Does NOT retry 4xx (permanent).
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxAttempts = 3
): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, options);

    if (res.ok) return res;

    if ([400, 401, 403, 404].includes(res.status)) {
      throw new Error(`HTTP ${res.status} from ${url} — permanent failure`);
    }

    if (attempt < maxAttempts) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000);
      console.warn(`[fetchWithRetry] HTTP ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
      await new Promise(r => setTimeout(r, delay));
    } else {
      throw new Error(`HTTP ${res.status} from ${url} after ${maxAttempts} attempts`);
    }
  }
  throw new Error('fetchWithRetry: unreachable');
}
