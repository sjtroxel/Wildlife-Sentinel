import { Router, type Request, type Response } from 'express';
import { getAlertTrends } from '../db/statsQueries.js';

export const statsRouter = Router();

// GET /stats/trends?days=30  (default 30, capped at 90)
statsRouter.get('/trends', async (req: Request, res: Response) => {
  const raw = parseInt(String(req.query['days'] ?? '30'), 10);
  if (isNaN(raw) || raw < 1) {
    res.status(400).json({ error: 'days must be a positive integer' });
    return;
  }
  const days = Math.min(raw, 90);
  const trends = await getAlertTrends(days);
  res.json(trends);
});
