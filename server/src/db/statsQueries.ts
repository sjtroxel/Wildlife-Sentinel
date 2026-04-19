import { sql } from './client.js';
import type { TrendPoint } from '../../../shared/types.js';

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
