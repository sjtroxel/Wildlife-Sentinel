import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  haversineBearing,
  computePolygonCentroid,
  parseCSV,
  parseNHCLatLng,
  extractPredictedBearing,
  extractPredictedDistance,
  extractPredictedPercentChange,
  getNextThursday,
  getMostRecentThursdayDateStr,
} from '../../src/refiner/geoUtils.js';

describe('haversineDistance', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineDistance({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 }))
      .toBeCloseTo(0, 1);
  });

  it('returns ~342 km between Paris and London', () => {
    // Paris: 48.8566°N, 2.3522°E — London: 51.5074°N, 0.1278°W
    const dist = haversineDistance(
      { lat: 48.8566, lng: 2.3522 },
      { lat: 51.5074, lng: -0.1278 }
    );
    expect(dist).toBeGreaterThan(330);
    expect(dist).toBeLessThan(355);
  });

  it('is symmetric', () => {
    const a = { lat: 35.0, lng: 139.0 };
    const b = { lat: -33.8, lng: 151.2 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 3);
  });
});

describe('haversineBearing', () => {
  it('returns ~0° going due north', () => {
    const bearing = haversineBearing({ lat: 0, lng: 0 }, { lat: 10, lng: 0 });
    expect(bearing).toBeCloseTo(0, 0);
  });

  it('returns ~90° going due east', () => {
    const bearing = haversineBearing({ lat: 0, lng: 0 }, { lat: 0, lng: 10 });
    expect(bearing).toBeCloseTo(90, 0);
  });

  it('returns ~180° going due south', () => {
    const bearing = haversineBearing({ lat: 10, lng: 0 }, { lat: 0, lng: 0 });
    expect(bearing).toBeCloseTo(180, 0);
  });

  it('returns ~270° going due west', () => {
    const bearing = haversineBearing({ lat: 0, lng: 10 }, { lat: 0, lng: 0 });
    expect(bearing).toBeCloseTo(270, 0);
  });

  it('returns ~315° going northwest', () => {
    const bearing = haversineBearing({ lat: 0, lng: 10 }, { lat: 10, lng: 0 });
    expect(bearing).toBeGreaterThan(300);
    expect(bearing).toBeLessThan(330);
  });
});

describe('computePolygonCentroid', () => {
  it('returns centroid of a simple square ring', () => {
    // Ring: [lng, lat] order (GeoJSON convention)
    const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    const centroid = computePolygonCentroid(ring);
    expect(centroid.lng).toBeCloseTo(0.8, 1); // avg of 0,2,2,0,0
    expect(centroid.lat).toBeCloseTo(0.8, 1); // avg of 0,0,2,2,0
  });

  it('returns {0,0} for empty ring', () => {
    const centroid = computePolygonCentroid([]);
    expect(centroid.lat).toBe(0);
    expect(centroid.lng).toBe(0);
  });
});

describe('parseCSV', () => {
  it('parses header + rows into objects', () => {
    const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Alice', age: '30', city: 'NYC' });
    expect(rows[1]).toEqual({ name: 'Bob', age: '25', city: 'LA' });
  });

  it('returns [] for empty string', () => {
    expect(parseCSV('')).toEqual([]);
  });

  it('returns [] for header-only', () => {
    expect(parseCSV('name,age')).toEqual([]);
  });

  it('skips blank rows', () => {
    const csv = 'a,b\n1,2\n\n3,4';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it('handles missing trailing values with empty string', () => {
    const csv = 'a,b,c\n1,2';
    const rows = parseCSV(csv);
    expect(rows[0]?.['c']).toBe('');
  });
});

describe('parseNHCLatLng', () => {
  it('parses north / east coordinates', () => {
    const result = parseNHCLatLng('18.5N', '72.3E');
    expect(result.lat).toBeCloseTo(18.5, 1);
    expect(result.lng).toBeCloseTo(72.3, 1);
  });

  it('parses south / west coordinates', () => {
    const result = parseNHCLatLng('18.5S', '72.3W');
    expect(result.lat).toBeCloseTo(-18.5, 1);
    expect(result.lng).toBeCloseTo(-72.3, 1);
  });
});

describe('extractPredictedBearing', () => {
  it('extracts NW as 315°', () => {
    expect(extractPredictedBearing('Fire will spread NW approximately 35km')).toBe(315);
  });

  it('extracts "northwest" as 315°', () => {
    expect(extractPredictedBearing('moving northwest toward coastal habitat')).toBe(315);
  });

  it('extracts SE as 135°', () => {
    expect(extractPredictedBearing('storm tracking southeast')).toBe(135);
  });

  it('extracts N as 0°', () => {
    expect(extractPredictedBearing('moving north')).toBe(0);
  });

  it('prefers longer match (NNW over N or W)', () => {
    expect(extractPredictedBearing('tracking NNW')).toBe(337.5);
  });

  it('returns null when no direction found', () => {
    expect(extractPredictedBearing('fire will intensify')).toBeNull();
  });
});

describe('extractPredictedDistance', () => {
  it('extracts integer km', () => {
    expect(extractPredictedDistance('Fire will spread NW 35km in 24h')).toBe(35);
  });

  it('extracts decimal km', () => {
    expect(extractPredictedDistance('spread 12.5km from origin')).toBe(12.5);
  });

  it('extracts "kilometers" spelling', () => {
    expect(extractPredictedDistance('advance 50 kilometers')).toBe(50);
  });

  it('returns null when no distance found', () => {
    expect(extractPredictedDistance('fire will intensify and spread')).toBeNull();
  });
});

describe('extractPredictedPercentChange', () => {
  it('extracts percent sign', () => {
    expect(extractPredictedPercentChange('flood stage expected to rise 30%')).toBe(30);
  });

  it('extracts "percent" word', () => {
    expect(extractPredictedPercentChange('increase by 25 percent over 24h')).toBe(25);
  });

  it('extracts "worsen by N" pattern', () => {
    expect(extractPredictedPercentChange('conditions will worsen by 15 over the week')).toBe(15);
  });

  it('returns null when no match', () => {
    expect(extractPredictedPercentChange('conditions will continue')).toBeNull();
  });
});

describe('getNextThursday', () => {
  it('returns a Date that is a Thursday', () => {
    const next = getNextThursday();
    expect(next.getUTCDay()).toBe(4); // 4 = Thursday
  });

  it('returns a date in the future', () => {
    expect(getNextThursday().getTime()).toBeGreaterThan(Date.now());
  });

  it('returns 18:00 UTC', () => {
    const next = getNextThursday();
    expect(next.getUTCHours()).toBe(18);
    expect(next.getUTCMinutes()).toBe(0);
  });
});

describe('getMostRecentThursdayDateStr', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(getMostRecentThursdayDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a Thursday or a date in the past week', () => {
    const dateStr = getMostRecentThursdayDateStr();
    const date = new Date(dateStr + 'T00:00:00Z');
    expect(date.getUTCDay()).toBe(4); // Thursday
    // Must be <= today
    expect(date.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);
  });
});
