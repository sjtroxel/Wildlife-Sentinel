import { sql } from './client.js';
import type { TrendPoint } from '../../../shared/types.js';

// ── Refiner stats ─────────────────────────────────────────────────────────────

interface RefinerScoreRow {
  composite_score: string;
  evaluation_time: string;
  evaluated_at: Date;
  event_type: string;
  correction_generated: boolean;
}

interface RefinerQueueRow {
  pending: string;
  due_now: string;
  next_due_at: Date | null;
}

interface PromptHealthRow {
  chars: string;
  approx_tokens: string;
  active_corrections: string;
  version: string;
  updated_at: Date;
  corrections_7d: string;
}

export interface RefinerStats {
  scores: Array<{
    compositeScore: number;
    evaluationTime: string;
    evaluatedAt: Date;
    eventType: string;
    correctionGenerated: boolean;
  }>;
  queue: {
    pending: number;
    dueNow: number;
    nextDueAt: Date | null;
  };
  promptHealth: {
    chars: number;
    approxTokens: number;
    activeCorrections: number;
    version: number;
    updatedAt: Date;
    corrections7d: number;
  } | null;
}

export async function getRefinerStats(): Promise<RefinerStats> {
  const [scores, queueRows, promptHealthRows] = await Promise.all([
    sql<RefinerScoreRow[]>`
      SELECT rs.composite_score, rs.evaluation_time, rs.evaluated_at,
             rs.correction_generated, a.event_type
      FROM refiner_scores rs
      JOIN alerts a ON a.id = rs.alert_id
      ORDER BY rs.evaluated_at DESC
      LIMIT 10
    `,
    sql<RefinerQueueRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE completed_at IS NULL)::text                    AS pending,
        COUNT(*) FILTER (WHERE completed_at IS NULL AND run_at <= NOW())::text AS due_now,
        MIN(run_at) FILTER (WHERE completed_at IS NULL AND run_at > NOW())     AS next_due_at
      FROM refiner_queue
    `,
    sql<PromptHealthRow[]>`
      SELECT
        length(system_prompt)::text                                                              AS chars,
        (length(system_prompt) / 4)::text                                                        AS approx_tokens,
        ((length(system_prompt) - length(replace(system_prompt,
          chr(10)||chr(10)||'---'||chr(10)||chr(10), ''))) / 7)::text                            AS active_corrections,
        version::text,
        updated_at,
        (SELECT COUNT(*)::text FROM refiner_scores
         WHERE correction_generated = true
           AND evaluated_at > NOW() - INTERVAL '7 days')                                         AS corrections_7d
      FROM agent_prompts
      WHERE agent_name = 'threat_assessment'
    `,
  ]);

  const q  = queueRows[0]       ?? { pending: '0', due_now: '0', next_due_at: null };
  const ph = promptHealthRows[0] ?? null;

  return {
    scores: scores.map(r => ({
      compositeScore:      parseFloat(String(r.composite_score)),
      evaluationTime:      String(r.evaluation_time),
      evaluatedAt:         new Date(r.evaluated_at),
      eventType:           String(r.event_type),
      correctionGenerated: Boolean(r.correction_generated),
    })),
    queue: {
      pending:   parseInt(String(q.pending),  10),
      dueNow:    parseInt(String(q.due_now),  10),
      nextDueAt: q.next_due_at ? new Date(q.next_due_at) : null,
    },
    promptHealth: ph ? {
      chars:             parseInt(ph.chars,              10),
      approxTokens:      parseInt(ph.approx_tokens,      10),
      activeCorrections: parseInt(ph.active_corrections, 10),
      version:           parseInt(ph.version,            10),
      updatedAt:         new Date(ph.updated_at),
      corrections7d:     parseInt(ph.corrections_7d,     10),
    } : null,
  };
}

export async function getAlertTrends(days: number): Promise<TrendPoint[]> {
  const rows = await sql`
    SELECT
      DATE(created_at AT TIME ZONE 'UTC') AS date,
      COUNT(*) FILTER (WHERE event_type = 'wildfire')          AS wildfire,
      COUNT(*) FILTER (WHERE event_type = 'tropical_storm')    AS tropical_storm,
      COUNT(*) FILTER (WHERE event_type = 'flood')             AS flood,
      COUNT(*) FILTER (WHERE event_type = 'drought')           AS drought,
      COUNT(*) FILTER (WHERE event_type = 'coral_bleaching')   AS coral_bleaching,
      COUNT(*) FILTER (WHERE event_type = 'earthquake')        AS earthquake,
      COUNT(*) FILTER (WHERE event_type = 'volcanic_eruption') AS volcanic_eruption,
      COUNT(*) FILTER (WHERE event_type = 'deforestation')     AS deforestation,
      COUNT(*) FILTER (WHERE event_type = 'sea_ice_loss')      AS sea_ice_loss,
      COUNT(*) FILTER (WHERE event_type = 'climate_anomaly')   AS climate_anomaly,
      COUNT(*) FILTER (WHERE event_type = 'illegal_fishing')   AS illegal_fishing,
      COUNT(*) AS total
    FROM alerts
    WHERE threat_level IS NOT NULL
      AND created_at >= NOW() - (${days} * INTERVAL '1 day')
    GROUP BY DATE(created_at AT TIME ZONE 'UTC')
    ORDER BY date ASC
  `;

  return rows.map(r => ({
    date:              String(r['date']).slice(0, 10),
    wildfire:          parseInt(String(r['wildfire']          ?? '0'), 10),
    tropical_storm:    parseInt(String(r['tropical_storm']    ?? '0'), 10),
    flood:             parseInt(String(r['flood']             ?? '0'), 10),
    drought:           parseInt(String(r['drought']           ?? '0'), 10),
    coral_bleaching:   parseInt(String(r['coral_bleaching']   ?? '0'), 10),
    earthquake:        parseInt(String(r['earthquake']        ?? '0'), 10),
    volcanic_eruption: parseInt(String(r['volcanic_eruption'] ?? '0'), 10),
    deforestation:     parseInt(String(r['deforestation']     ?? '0'), 10),
    sea_ice_loss:      parseInt(String(r['sea_ice_loss']      ?? '0'), 10),
    climate_anomaly:   parseInt(String(r['climate_anomaly']   ?? '0'), 10),
    illegal_fishing:   parseInt(String(r['illegal_fishing']   ?? '0'), 10),
    total:             parseInt(String(r['total']             ?? '0'), 10),
  }));
}
