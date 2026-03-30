import { Router, type Request, type Response } from 'express';
import { sql } from '../db/client.js';

export const refinerRouter = Router();

// GET /refiner/scores — last 100 refiner evaluation scores joined with alert metadata
refinerRouter.get('/scores', async (_req: Request, res: Response) => {
  const scores = await sql`
    SELECT r.composite_score, r.direction_accuracy, r.magnitude_accuracy,
           r.evaluation_time, r.evaluated_at,
           a.event_type, a.source
    FROM refiner_scores r
    JOIN alerts a ON r.alert_id = a.id
    ORDER BY r.evaluated_at DESC
    LIMIT 100
  `;
  res.json(scores);
});
