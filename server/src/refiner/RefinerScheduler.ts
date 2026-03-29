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
    let due: QueueItem[];

    try {
      due = await sql<QueueItem[]>`
        SELECT id, alert_id, evaluation_time
        FROM refiner_queue
        WHERE run_at <= NOW()
          AND completed_at IS NULL
        ORDER BY run_at ASC
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
