import type { AlertRow, AlertDetail, RefinerScoreRow, BboxQuery, EventType, ThreatLevel, SpeciesListItem, SpeciesDetail, TrendPoint } from '@wildlife-sentinel/shared/types';

export interface AlertFilters {
  event_type?: EventType;
  threat_level?: ThreatLevel;
  limit?: number;
  offset?: number;
}

const BASE = process.env.NEXT_PUBLIC_API_URL;
if (!BASE) throw new Error('NEXT_PUBLIC_API_URL is not set');

export const api = {
  getRecentAlerts: (limit = 20): Promise<AlertRow[]> =>
    fetch(`${BASE}/alerts/recent?limit=${limit}`).then((r) => r.json()),

  getAlerts: (filters: AlertFilters = {}): Promise<AlertRow[]> => {
    const params = new URLSearchParams();
    if (filters.event_type) params.set('event_type', filters.event_type);
    if (filters.threat_level) params.set('threat_level', filters.threat_level);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return fetch(`${BASE}/alerts${qs ? `?${qs}` : ''}`).then((r) => r.json());
  },

  getAlert: (id: string): Promise<AlertDetail> =>
    fetch(`${BASE}/alerts/${id}`).then((r) => {
      if (!r.ok) throw new Error('Alert not found');
      return r.json();
    }),

  getRefinerScores: (): Promise<RefinerScoreRow[]> =>
    fetch(`${BASE}/refiner/scores`).then((r) => r.json()),

  getSpeciesList: (limit = 50, offset = 0): Promise<SpeciesListItem[]> =>
    fetch(`${BASE}/species?limit=${limit}&offset=${offset}`).then((r) => r.json()),

  getSpecies: (slug: string): Promise<SpeciesDetail> =>
    fetch(`${BASE}/species/${encodeURIComponent(slug)}`).then((r) => {
      if (!r.ok) throw new Error('Species not found');
      return r.json();
    }),

  getTrends: (days = 30): Promise<TrendPoint[]> =>
    fetch(`${BASE}/stats/trends?days=${days}`).then((r) => r.json()),

  getHabitats: (bbox: BboxQuery): Promise<GeoJSON.FeatureCollection> => {
    const params = new URLSearchParams({
      minLng: String(bbox.minLng),
      minLat: String(bbox.minLat),
      maxLng: String(bbox.maxLng),
      maxLat: String(bbox.maxLat),
    });
    return fetch(`${BASE}/habitats?${params}`).then((r) => r.json());
  },
};
