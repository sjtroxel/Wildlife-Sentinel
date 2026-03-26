/**
 * GBIF Occurrence API client.
 * No authentication required. Be polite — callers should add delays between calls.
 */
import type { GBIFSighting } from '@wildlife-sentinel/shared/types';
import { fetchWithRetry } from './BaseScout.js';

interface GBIFOccurrence {
  key: number;
  scientificName: string;
  decimalLatitude: number;
  decimalLongitude: number;
  eventDate: string;
  datasetName: string;
  occurrenceID: string;
}

interface GBIFResponse {
  results: GBIFOccurrence[];
  count: number;
  endOfRecords: boolean;
}

/**
 * Fetch recent GBIF confirmed sightings within 50km of coordinates.
 * Covers the last 2 calendar years. Returns empty array if none found.
 */
export async function fetchRecentSightings(
  lat: number,
  lng: number,
  speciesName: string
): Promise<GBIFSighting[]> {
  const currentYear = new Date().getFullYear();
  const yearRange = `${currentYear - 1},${currentYear}`;

  const url = new URL('https://api.gbif.org/v1/occurrence/search');
  url.searchParams.set('decimalLatitude', String(lat));
  url.searchParams.set('decimalLongitude', String(lng));
  url.searchParams.set('radius', '50000');
  url.searchParams.set('hasCoordinate', 'true');
  url.searchParams.set('hasGeospatialIssue', 'false');
  url.searchParams.set('year', yearRange);
  url.searchParams.set('limit', '10');

  let res: Response;
  try {
    res = await fetchWithRetry(url.toString());
  } catch (err) {
    console.warn(`[gbif] Failed to fetch sightings for ${speciesName}:`, err);
    return [];
  }

  if (!res.ok) {
    console.warn(`[gbif] Non-OK response ${res.status} for ${speciesName}`);
    return [];
  }

  const data = await res.json() as GBIFResponse;

  return (data.results ?? []).map(r => ({
    speciesName: r.scientificName,
    decimalLatitude: r.decimalLatitude,
    decimalLongitude: r.decimalLongitude,
    eventDate: r.eventDate ?? '',
    datasetName: r.datasetName ?? '',
    occurrenceID: r.occurrenceID ?? String(r.key),
  }));
}
