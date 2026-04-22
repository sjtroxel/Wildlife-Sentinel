/**
 * Refiner Scheduler
 *
 * Hourly cron that polls refiner_queue for due evaluations and dispatches them
 * to RunRefinerEvaluation. Uses completed_at IS NULL (not a boolean) — see migration 0005.
 */
import cron from 'node-cron';
import { sql } from '../db/client.js';
import { logToWarRoom } from '../discord/warRoom.js';
import { runRefinerEvaluation } from './RefinerAgent.js';

interface QueueItem {
  id: string;
  alert_id: string;
  evaluation_time: string;
}

export function startRefinerScheduler(): void {
  cron.schedule('0 * * * *', async () => {
    // Retire any queue items for alerts with null/invalid coordinates.
    // These are stale records from before the pipeline stored coordinates correctly.
    // They can never be scored — retiring them prevents them from consuming queue slots.
    const retiredRows = await sql<{ retired: string }[]>`
      UPDATE refiner_queue rq
      SET completed_at = NOW()
      FROM alerts a
      WHERE a.id = rq.alert_id
        AND rq.completed_at IS NULL
        AND (
          a.coordinates IS NULL
          OR (a.coordinates->>'lat') IS NULL
          OR (a.coordinates->>'lng') IS NULL
        )
      RETURNING rq.id
    `.catch((err: unknown) => {
      console.warn('[refiner] Stale-item cleanup failed (non-fatal):', err);
      return [] as { retired: string }[];
    });
    if (retiredRows.length > 0) {
      console.warn(`[refiner] Retired ${retiredRows.length} queue item(s) with null coordinates — check alerts table for missing coordinate data`);
    }

    // Log queue depth every tick so the scheduler is always visible in Railway logs.
    const statsRows = await sql<{ pending: string; due_now: string }[]>`
      SELECT
        COUNT(*) FILTER (WHERE completed_at IS NULL)::text              AS pending,
        COUNT(*) FILTER (WHERE completed_at IS NULL AND run_at <= NOW())::text AS due_now
      FROM refiner_queue
    `.catch(() => [{ pending: '?', due_now: '?' }]);

    const stats = statsRows[0] ?? { pending: '?', due_now: '?' };
    console.log(`[refiner] Hourly tick — ${stats.pending} pending, ${stats.due_now} due now`);

    let due: QueueItem[];

    try {
      due = await sql<QueueItem[]>`
        SELECT rq.id, rq.alert_id, rq.evaluation_time
        FROM refiner_queue rq
        JOIN alerts a ON a.id = rq.alert_id
        WHERE rq.run_at <= NOW()
          AND rq.completed_at IS NULL
          AND a.coordinates IS NOT NULL
          AND (a.coordinates->>'lat') IS NOT NULL
          AND (a.coordinates->>'lng') IS NOT NULL
        ORDER BY rq.run_at ASC
        LIMIT 10
      `;
    } catch (err) {
      console.error('[refiner] Failed to poll refiner_queue:', err);
      return;
    }

    if (due.length === 0) return;

    console.log(`[refiner] Processing ${due.length} due evaluation(s)`);

    for (const item of due) {
      const evalTime = item.evaluation_time as '24h' | '48h' | 'weekly';

      try {
        await runRefinerEvaluation(item.alert_id, evalTime);

        await sql`
          UPDATE refiner_queue
          SET completed_at = NOW()
          WHERE id = ${item.id}
        `;
      } catch (err) {
        console.error(
          `[refiner] Evaluation failed for alert ${item.alert_id} (${evalTime}):`, err
        );
        await logToWarRoom({
          agent: 'refiner',
          action: 'Evaluation error',
          detail: `alert ${item.alert_id} @ ${evalTime}`,
          level: 'warning',
        }).catch(() => undefined); // war room failure must never crash the scheduler
      }
    }
  });

  console.log('[refiner] Scheduler started — polling hourly');
}
