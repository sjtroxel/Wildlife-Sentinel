import { Router, type Request, type Response } from 'express';
import { sql } from '../db/client.js';

export const alertsRouter = Router();

// GET /alerts/recent?limit=20  (cap at 50)
alertsRouter.get('/recent', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query['limit'] ?? '20')), 50);
  const rows = await sql`
    SELECT id, source, event_type, coordinates, severity, threat_level,
           confidence_score, enrichment_data, created_at, discord_message_id
    FROM alerts
    WHERE threat_level IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  // postgres.js returns JSON columns as strings if stored as JSON (not JSONB).
  // Normalize before sending so the client receives properly typed values.
  const alerts = rows.map((row) => ({
    ...row,
    coordinates:
      typeof row['coordinates'] === 'string'
        ? (JSON.parse(row['coordinates']) as { lat: number; lng: number })
        : row['coordinates'],
    severity: row['severity'] !== null ? parseFloat(row['severity']) : null,
    confidence_score:
      row['confidence_score'] !== null ? parseFloat(row['confidence_score']) : null,
  }));

  res.json(alerts);
});
