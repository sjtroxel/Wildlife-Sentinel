import { parse } from 'csv-parse/sync';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { config } from '../config.js';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

// Geographic bounding boxes for high-priority critical habitat biomes.
// Format: West,South,East,North (FIRMS bbox convention)
const PRIORITY_BBOXES: Array<{ name: string; bbox: string }> = [
  { name: 'SE_Asia',        bbox: '94,-11,145,25'   }, // Sumatra, Borneo, mainland SE Asia
  { name: 'Central_Africa', bbox: '8,-10,35,10'     }, // Congo Basin, Virunga
  { name: 'Amazon',         bbox: '-82,-20,-34,10'  }, // Amazon basin
  { name: 'California',     bbox: '-125,32,-114,42' }, // California condor range
  { name: 'E_Australia',    bbox: '138,-40,154,-22' }, // Koala habitat zones
];

interface FIRMSRow {
  latitude: string;
  longitude: string;
  bright_t31: string;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: string;
  frp: string;
  daynight: string;
}

export class FirmsScout extends BaseScout {
  constructor() {
    super({
      name: 'nasa_firms',
      dedupTtlSeconds: 7_200,       // 2 hours — FIRMS refreshes every 10 min
      maxConsecutiveFailures: 5,
      circuitOpenMinutes: 30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const events: RawDisasterEvent[] = [];

    for (const { name, bbox } of PRIORITY_BBOXES) {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${config.nasaFirmsKey}/VIIRS_SNPP_NRT/${bbox}/1/${today}`;

      let csvText: string;
      try {
        const res = await fetchWithRetry(url);
        csvText = await res.text();
      } catch (err) {
        console.warn(`[firms:scout] Failed to fetch ${name} bbox:`, err);
        continue;
      }

      // FIRMS returns an HTML error page if the key is wrong — guard against it
      if (!csvText.trim() || !csvText.startsWith('latitude')) {
        continue;
      }

      // Empty result = just headers (one line)
      if (csvText.split('\n').filter(l => l.trim()).length <= 1) {
        continue;
      }

      const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as FIRMSRow[];

      for (const row of rows) {
        const frp = parseFloat(row.frp);
        const lat = parseFloat(row.latitude);
        const lng = parseFloat(row.longitude);

        // Pre-filter: weak burns and low-confidence detections
        if (frp < 10) continue;
        if (row.confidence === 'l') continue; // l=low, n=nominal, h=high

        if (isNaN(lat) || isNaN(lng) || isNaN(frp)) continue;

        // Unique ID: coordinates + date + time (same fire in consecutive scans = duplicate)
        const eventId = `firms_${row.acq_date}_${row.acq_time}_${lat.toFixed(3)}_${lng.toFixed(3)}`;

        // acq_time is an integer in the CSV (e.g. 145 for 01:45) — pad to 4 digits
        const acqTimePadded = row.acq_time.padStart(4, '0');

        events.push({
          id: eventId,
          source: 'nasa_firms',
          event_type: 'wildfire',
          coordinates: { lat, lng },
          // FRP normalized: 1000 MW = severity 1.0
          severity: Math.min(frp / 1_000, 1.0),
          timestamp: new Date(
            `${row.acq_date}T${acqTimePadded.slice(0, 2)}:${acqTimePadded.slice(2, 4)}:00Z`
          ).toISOString(),
          raw_data: {
            frp,
            confidence: row.confidence,
            bright_t31: parseFloat(row.bright_t31),
            acq_date: row.acq_date,
            acq_time: row.acq_time,
            satellite: row.satellite,
            daynight: row.daynight,
            bbox_name: name,
          },
        });
      }
    }

    return events;
  }
}
