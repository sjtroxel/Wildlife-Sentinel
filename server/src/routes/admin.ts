import { Router, type Request, type Response } from 'express';
import { getTotalCostUsd, getCostByModel } from '../db/modelUsage.js';
import { modelRouter } from '../router/ModelRouter.js';

export const adminRouter = Router();

// GET /admin/costs — running cost summary
adminRouter.get('/costs', async (_req: Request, res: Response) => {
  const [total, byModel] = await Promise.all([getTotalCostUsd(), getCostByModel()]);
  res.json({
    total_usd: total,
    breakdown: byModel,
    in_memory_total_usd: modelRouter.getRunningCostUsd(),
  });
});
