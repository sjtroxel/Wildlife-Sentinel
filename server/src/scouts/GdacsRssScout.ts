import { XMLParser } from 'fast-xml-parser';
import type { RawDisasterEvent } from '@wildlife-sentinel/shared/types';
import { BaseScout, fetchWithRetry } from './BaseScout.js';

const GDACS_RSS_URL = 'https://www.gdacs.org/xml/rss.xml';

const GDACS_MAX_SCORE = 3;

// Saffir-Simpson Category 5 thresholds for tropical cyclone severity normalization
const CAT5_KMH   = 254;
const CAT5_KNOTS = 137;

// Alert-level fallback severity (used when alertscore is absent or zero)
const LEVEL_SEVERITY: Record<string, number> = {
  green:  0.25,
  orange: 0.60,
  red:    0.90,
};

// Event codes present in the GDACS RSS that we care about.
// WF and EQ are in the same feed but handled by NASA FIRMS and USGS respectively.
type GdacsCode = 'TC' | 'FL' | 'DR' | 'VO';

const GDACS_CODES = new Set<string>(['TC', 'FL', 'DR', 'VO']);

// Maps each GDACS code to the exact source/event_type pair and event-ID prefix
// used by the old per-type scouts — preserving all existing DB records unchanged.
const CODE_MAP = {
  TC: { source: 'gdacs'         as const, event_type: 'tropical_storm'    as const, idPrefix: 'gdacs'    },
  FL: { source: 'gdacs_flood'   as const, event_type: 'flood'             as const, idPrefix: 'gdacs_fl' },
  DR: { source: 'gdacs_drought' as const, event_type: 'drought'           as const, idPrefix: 'gdacs_dr' },
  VO: { source: 'gdacs_volcano' as const, event_type: 'volcanic_eruption' as const, idPrefix: 'gdacs_vo' },
};

// fast-xml-parser: elements with attributes produce { '#text': ..., '@_attr': ... }
interface SeverityElement {
  '#text'?: string;
  '@_unit'?: string;
  '@_value'?: string;
}

interface GdacsRssItem {
  'gdacs:eventtype'?:    string;
  'gdacs:alertlevel'?:   string;
  'gdacs:alertscore'?:   number | string;
  'gdacs:eventid'?:      number | string;
  'gdacs:episodeid'?:    number | string;
  'gdacs:eventname'?:    string;
  'gdacs:country'?:      string;
  'gdacs:datemodified'?: string;
  'gdacs:fromdate'?:     string;
  // severity element has attributes (unit, value) AND text content
  'gdacs:severity'?:     SeverityElement | string;
  // "lat lng" space-separated (lat first — opposite of GeoJSON)
  'georss:point'?:       string;
}

const parser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  // Force 'item' to always be an array even when the feed has only one event.
  isArray: (name) => name === 'item',
});

// Extract numeric value + unit string from a severity element.
// Returns null if the element is missing, is a plain string, or has no parseable value.
function parseSeverity(el: SeverityElement | string | undefined): { value: number; unit: string } | null {
  if (!el || typeof el === 'string') return null;
  const value = parseFloat(el['@_value'] ?? '');
  if (isNaN(value)) return null;
  return { value, unit: el['@_unit'] ?? '' };
}

function parseScore(raw: number | string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return isNaN(n) ? null : n;
}

function normalizeTc(
  sev: SeverityElement | string | undefined,
  alertscore: number | null,
  alertlevel: string,
): number {
  const parsed = parseSeverity(sev);
  if (parsed && parsed.value > 0) {
    const cap = parsed.unit.toLowerCase().includes('km') ? CAT5_KMH : CAT5_KNOTS;
    return Math.min(parsed.value / cap, 1.0);
  }
  if (alertscore !== null && alertscore > 0) return Math.min(alertscore / GDACS_MAX_SCORE, 1.0);
  return LEVEL_SEVERITY[alertlevel.toLowerCase()] ?? 0.25;
}

function normalizeScore(alertscore: number | null, alertlevel: string): number {
  if (alertscore !== null && alertscore > 0) return Math.min(alertscore / GDACS_MAX_SCORE, 1.0);
  return LEVEL_SEVERITY[alertlevel.toLowerCase()] ?? 0.25;
}

export class GdacsRssScout extends BaseScout {
  constructor() {
    super({
      name:                   'gdacs',
      dedupTtlSeconds:        12 * 3_600, // 12h — GDACS updates active events multiple times per day
      maxConsecutiveFailures: 5,
      circuitOpenMinutes:     30,
    });
  }

  protected async fetchEvents(): Promise<RawDisasterEvent[]> {
    const res  = await fetchWithRetry(GDACS_RSS_URL);
    const text = await res.text();

    const parsed = parser.parse(text) as {
      rss?: { channel?: { item?: GdacsRssItem[] } };
    };
    const items: GdacsRssItem[] = parsed?.rss?.channel?.item ?? [];

    const events: RawDisasterEvent[] = [];

    for (const item of items) {
      const code = item['gdacs:eventtype']?.trim().toUpperCase() ?? '';

      // Only process the 4 types this scout owns
      if (!GDACS_CODES.has(code)) continue;

      const mapping = CODE_MAP[code as GdacsCode];
      if (!mapping) continue; // unreachable, but satisfies noUncheckedIndexedAccess

      const alertlevel = item['gdacs:alertlevel'] ?? 'Green';
      const alertscore = parseScore(item['gdacs:alertscore']);

      // Volcanic eruptions: Orange/Red only — Green means unrest/watch, not an eruption
      if (code === 'VO' && alertlevel.toLowerCase() === 'green') continue;

      // Coordinates: georss:point is "lat lng" (lat first — opposite of GeoJSON [lng, lat])
      const pointStr = item['georss:point'] ?? '';
      const [latStr, lngStr] = pointStr.trim().split(/\s+/);
      if (latStr === undefined || lngStr === undefined) continue;
      const lat = parseFloat(latStr);
      const lng = parseFloat(lngStr);
      if (isNaN(lat) || isNaN(lng)) continue;

      const eventId   = Number(item['gdacs:eventid']   ?? 0);
      const episodeId = Number(item['gdacs:episodeid']  ?? 0);
      if (!eventId || !episodeId) continue;

      const id = `${mapping.idPrefix}_${eventId}_ep${episodeId}`;

      let timestamp: string;
      try {
        const dateStr = item['gdacs:datemodified'] ?? item['gdacs:fromdate'] ?? '';
        timestamp = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
      } catch {
        timestamp = new Date().toISOString();
      }

      const sev    = item['gdacs:severity'];
      const sevNum = parseSeverity(sev);

      let severity: number;
      if (code === 'TC') {
        severity = normalizeTc(sev, alertscore, alertlevel);
        // Skip tropical depressions / disturbances with no usable speed data
        if (severity <= 0) continue;
      } else {
        severity = normalizeScore(alertscore, alertlevel);
        if (severity <= 0) continue;
      }

      // Build raw_data that matches the schema each old scout produced.
      // Downstream agents and the DB already know these shapes.
      let raw_data: Record<string, unknown>;

      if (code === 'TC') {
        raw_data = {
          storm_name:     item['gdacs:eventname'] ?? null,
          alert_level:    alertlevel,
          max_wind_value: sevNum?.value ?? null,
          max_wind_unit:  sevNum?.unit  ?? null,
          episode_id:     episodeId,
        };
      } else if (code === 'VO') {
        raw_data = {
          volcano_name:  item['gdacs:eventname'] ?? null,
          alert_level:   alertlevel,
          alert_score:   alertscore,
          country:       item['gdacs:country'] ?? null,
          episode_id:    episodeId,
          severity_text: typeof sev === 'object' ? (sev['#text'] ?? null) : null,
        };
      } else {
        // FL and DR share the same raw_data shape
        raw_data = {
          event_name:     item['gdacs:eventname'] ?? null,
          alert_level:    alertlevel,
          alert_score:    alertscore,
          country:        item['gdacs:country'] ?? null,
          episode_id:     episodeId,
          severity_value: sevNum?.value ?? null,
          severity_unit:  sevNum?.unit  ?? null,
        };
      }

      events.push({
        id,
        source:      mapping.source,
        event_type:  mapping.event_type,
        coordinates: { lat, lng },
        severity,
        timestamp,
        raw_data,
      });
    }

    return events;
  }
}
