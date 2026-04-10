import { Router, type Request, type Response } from 'express';
import { sql } from '../db/client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_EVENT_TYPES = new Set([
  'wildfire', 'tropical_storm', 'flood', 'drought', 'coral_bleaching',
]);
const VALID_THREAT_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

export const alertsRouter = Router();

// Normalize numeric columns that postgres.js may return as strings (JSON vs JSONB)
function normalizeAlertRow(row: Record<string, unknown>) {
  return {
    ...row,
    coordinates:
      typeof row['coordinates'] === 'string'
        ? (JSON.parse(row['coordinates']) as { lat: number; lng: number })
        : row['coordinates'],
    severity: row['severity'] !== null ? parseFloat(row['severity'] as string) : null,
    confidence_score:
      row['confidence_score'] !== null
        ? parseFloat(row['confidence_score'] as string)
        : null,
  };
}

// GET /alerts?event_type=wildfire&threat_level=high&limit=50&offset=0
alertsRouter.get('/', async (req: Request, res: Response) => {
  const eventType = req.query['event_type'];
  const threatLevel = req.query['threat_level'];
  const limit = Math.min(parseInt(String(req.query['limit'] ?? '50')), 100);
  const offset = Math.max(parseInt(String(req.query['offset'] ?? '0')), 0);

  if (eventType !== undefined && !VALID_EVENT_TYPES.has(String(eventType))) {
    res.status(400).json({ error: `Invalid event_type: ${String(eventType)}` });
    return;
  }
  if (threatLevel !== undefined && !VALID_THREAT_LEVELS.has(String(threatLevel))) {
    res.status(400).json({ error: `Invalid threat_level: ${String(threatLevel)}` });
    return;
  }

  // Explicit branches avoid nested sql`` fragment calls (which confuse test mocks).
  // All user-supplied values are passed as parameterized values — no string interpolation.
  let rows;
  if (eventType !== undefined && threatLevel !== undefined) {
    rows = await sql`
      SELECT id, source, event_type, coordinates, severity, threat_level,
             confidence_score, enrichment_data, created_at, discord_message_id
      FROM alerts WHERE threat_level IS NOT NULL
        AND event_type = ${String(eventType)} AND threat_level = ${String(threatLevel)}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  } else if (eventType !== undefined) {
    rows = await sql`
      SELECT id, source, event_type, coordinates, severity, threat_level,
             confidence_score, enrichment_data, created_at, discord_message_id
      FROM alerts WHERE threat_level IS NOT NULL AND event_type = ${String(eventType)}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  } else if (threatLevel !== undefined) {
    rows = await sql`
      SELECT id, source, event_type, coordinates, severity, threat_level,
             confidence_score, enrichment_data, created_at, discord_message_id
      FROM alerts WHERE threat_level IS NOT NULL AND threat_level = ${String(threatLevel)}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  } else {
    rows = await sql`
      SELECT id, source, event_type, coordinates, severity, threat_level,
             confidence_score, enrichment_data, created_at, discord_message_id
      FROM alerts WHERE threat_level IS NOT NULL
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }

  res.json(rows.map(normalizeAlertRow));
});

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

  res.json(rows.map(normalizeAlertRow));
});

// GET /alerts/:id  — full alert detail + refiner score history
alertsRouter.get('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid alert ID format' });
    return;
  }

  const rows = await sql`
    SELECT
      a.id, a.raw_event_id, a.source, a.event_type, a.coordinates,
      a.severity, a.threat_level, a.confidence_score,
      a.enrichment_data, a.prediction_data, a.discord_message_id, a.created_at,
      COALESCE(
        json_agg(
          json_build_object(
            'evaluation_time', rs.evaluation_time,
            'composite_score', rs.composite_score,
            'direction_accuracy', rs.direction_accuracy,
            'magnitude_accuracy', rs.magnitude_accuracy,
            'correction_generated', rs.correction_generated,
            'correction_note', rs.correction_note,
            'evaluated_at', rs.evaluated_at
          ) ORDER BY rs.evaluated_at ASC
        ) FILTER (WHERE rs.id IS NOT NULL),
        '[]'::json
      ) AS refiner_scores
    FROM alerts a
    LEFT JOIN refiner_scores rs ON rs.alert_id = a.id
    WHERE a.id = ${id}::uuid
    GROUP BY a.id
  `;

  if (rows.length === 0) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }

  const row = rows[0]!;
  const alert = {
    ...normalizeAlertRow(row),
    enrichment_data:
      typeof row['enrichment_data'] === 'string'
        ? JSON.parse(row['enrichment_data'])
        : (row['enrichment_data'] ?? null),
    prediction_data:
      typeof row['prediction_data'] === 'string'
        ? JSON.parse(row['prediction_data'])
        : (row['prediction_data'] ?? null),
    refiner_scores:
      typeof row['refiner_scores'] === 'string'
        ? JSON.parse(row['refiner_scores'])
        : (row['refiner_scores'] ?? []),
  };

  res.json(alert);
});
