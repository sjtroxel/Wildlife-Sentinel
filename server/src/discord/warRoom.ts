/**
 * War Room — rate-limited observability logger to #sentinel-ops.
 *
 * Posts one-line status entries for every significant pipeline action.
 * Failures here must NEVER crash the pipeline — all errors are swallowed.
 */
import { getSentinelOpsChannel } from './bot.js';

const MIN_POST_INTERVAL_MS = 500; // max 2 war room messages per second
let lastPostTime = 0;

export interface WarRoomEntry {
  agent: string;
  action: string;
  detail: string;
  level?: 'info' | 'warning' | 'alert';
}

export async function logToWarRoom(entry: WarRoomEntry): Promise<void> {
  try {
    const now = Date.now();
    const waitMs = MIN_POST_INTERVAL_MS - (now - lastPostTime);
    if (waitMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, waitMs));
    }
    lastPostTime = Date.now();

    const emoji = entry.level === 'alert' ? '🔴' : entry.level === 'warning' ? '⚠️' : '⚙️';
    const msg = `${emoji} \`[${entry.agent}]\` ${entry.action}: ${entry.detail}`;

    await getSentinelOpsChannel().send(msg);
  } catch (err) {
    // War room failures must never crash the pipeline
    console.error('[war-room] Failed to post:', err);
  }
}
