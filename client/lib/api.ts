import type { AlertRow, AlertDetail, RefinerScoreRow, BboxQuery } from '@wildlife-sentinel/shared/types';

const BASE = process.env.NEXT_PUBLIC_API_URL;
if (!BASE) throw new Error('NEXT_PUBLIC_API_URL is not set');

export const api = {
  getRecentAlerts: (limit = 20): Promise<AlertRow[]> =>
    fetch(`${BASE}/alerts/recent?limit=${limit}`).then((r) => r.json()),

  getAlert: (id: string): Promise<AlertDetail> =>
    fetch(`${BASE}/alerts/${id}`).then((r) => {
      if (!r.ok) throw new Error('Alert not found');
      return r.json();
    }),

  getRefinerScores: (): Promise<RefinerScoreRow[]> =>
    fetch(`${BASE}/refiner/scores`).then((r) => r.json()),

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
