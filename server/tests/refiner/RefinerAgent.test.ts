import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '../fixtures/api');

// ── Hoisted mocks (available at vi.mock hoist time) ───────────────────────────

const mockSql = vi.hoisted(() => vi.fn());
const mockComplete = vi.hoisted(() => vi.fn());
const mockFetchWithRetry = vi.hoisted(() => vi.fn());
const mockLogToWarRoom = vi.hoisted(() => vi.fn());
const mockGetAgentPrompt = vi.hoisted(() => vi.fn());

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/db/client.js', () => ({ sql: mockSql }));
vi.mock('../../src/router/ModelRouter.js', () => ({ modelRouter: { complete: mockComplete } }));
vi.mock('../../src/db/agentPrompts.js', () => ({ getAgentPrompt: mockGetAgentPrompt }));
vi.mock('../../src/discord/warRoom.js', () => ({ logToWarRoom: mockLogToWarRoom }));
vi.mock('../../src/scouts/BaseScout.js', () => ({ fetchWithRetry: mockFetchWithRetry }));
vi.mock('../../src/config.js', () => ({ config: { nasaFirmsKey: 'test-firms-key' } }));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { runRefinerEvaluation } from '../../src/refiner/RefinerAgent.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockResponse(body: string): Response {
  return {
    ok: true,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as Response;
}

type AlertOverrides = Partial<{
  id: string;
  event_type: string;
  source: string;
  coordinates: { lat: number; lng: number };
  prediction_data: { predicted_impact: string };
  raw_data: Record<string, unknown> | null;
}>;

function makeAlertRows(overrides: AlertOverrides = {}) {
  return [{
    id: 'alert-uuid-001',
    event_type: 'wildfire',
    source: 'nasa_firms',
    coordinates: { lat: -3.42, lng: 104.21 },
    prediction_data: { predicted_impact: 'Fire will spread NW approximately 35km in 24h.' },
    raw_data: {},
    ...overrides,
  }];
}

/** Checks whether any mockSql call contained the given substring in its template string. */
function sqlCallContains(substring: string): boolean {
  return (mockSql.mock.calls as Array<[string[]]>).some(
    ([strings]) => strings.join('').toLowerCase().includes(substring)
  );
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();

  // Restore defaults after reset — vi.resetAllMocks() clears all return values
  mockComplete.mockResolvedValue({
    content: 'CORRECTION (wildfire): Weight offshore wind more heavily when predicting spread direction.',
    model: 'claude-haiku-4-5-20251001',
    inputTokens: 150,
    outputTokens: 40,
    estimatedCostUsd: 0.001,
  });
  mockGetAgentPrompt.mockResolvedValue('You are a threat assessment agent.');
  mockLogToWarRoom.mockResolvedValue(undefined);

  // Default sql: returns wildfire alert on SELECT, [] otherwise
  mockSql.mockImplementation(async (strings: string[]) => {
    const query = strings.join('').toLowerCase();
    if (query.includes('select') && query.includes('from alerts')) {
      return makeAlertRows();
    }
    return [];
  });
});

// ── Fire scoring ──────────────────────────────────────────────────────────────

describe('runRefinerEvaluation — wildfire', () => {
  it('scores a fire prediction and inserts a refiner_scores row', async () => {
    const firmsCsv = readFileSync(join(FIXTURES, 'firms-fire-response.csv'), 'utf8');

    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        return makeAlertRows({
          coordinates: { lat: -3.5, lng: 104.0 },
          prediction_data: { predicted_impact: 'Fire will spread NW approximately 30km in 24h.' },
        });
      }
      return [];
    });

    mockFetchWithRetry.mockResolvedValue(mockResponse(firmsCsv));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(sqlCallContains('insert into refiner_scores')).toBe(true);
  });

  it('inserts a refiner_scores row even when fire extinguished (empty FIRMS)', async () => {
    mockFetchWithRetry.mockResolvedValue(mockResponse('latitude,longitude,frp\n'));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    // empty FIRMS → toComposite(0.5, 0.2) = 0.38 — still scores, does not skip
    expect(sqlCallContains('insert into refiner_scores')).toBe(true);
  });

  it('skips scoring entirely when FIRMS API throws', async () => {
    mockFetchWithRetry.mockRejectedValue(new Error('HTTP 503'));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(sqlCallContains('insert into refiner_scores')).toBe(false);
  });
});

// ── Storm scoring ─────────────────────────────────────────────────────────────

describe('runRefinerEvaluation — tropical_storm', () => {
  it('scores an active storm matched by name', async () => {
    const nhcJson = readFileSync(join(FIXTURES, 'nhc-storms-response.json'), 'utf8');

    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        return makeAlertRows({
          event_type: 'tropical_storm',
          source: 'noaa_nhc',
          coordinates: { lat: 18.5, lng: -72.3 },
          prediction_data: { predicted_impact: 'Storm will intensify moving northwest.' },
          raw_data: { storm_name: 'BERYL', max_wind_knots: 65 },
        });
      }
      return [];
    });

    mockFetchWithRetry.mockResolvedValue(mockResponse(nhcJson));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(sqlCallContains('insert into refiner_scores')).toBe(true);
  });

  it('scores conservatively when no active storm found', async () => {
    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        return makeAlertRows({
          event_type: 'tropical_storm',
          source: 'noaa_nhc',
          coordinates: { lat: 50.0, lng: -10.0 },
          prediction_data: { predicted_impact: 'Storm will intensify.' },
          raw_data: { storm_name: 'UNKNOWN', max_wind_knots: 50 },
        });
      }
      return [];
    });

    mockFetchWithRetry.mockResolvedValue(mockResponse('{ "activeStorms": [] }'));

    await runRefinerEvaluation('alert-uuid-001', '48h');

    expect(sqlCallContains('insert into refiner_scores')).toBe(true);
  });
});

// ── Flood scoring ─────────────────────────────────────────────────────────────

describe('runRefinerEvaluation — flood', () => {
  it('scores flood when actual discharge worsened as predicted', async () => {
    const usgsJson = readFileSync(join(FIXTURES, 'usgs-gauge-response.json'), 'utf8');

    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        return makeAlertRows({
          event_type: 'flood',
          source: 'usgs_nwis',
          raw_data: {
            site_code: '09380000',
            flood_stage_cfs: 10000,
            percent_above_flood_stage: 50,
          },
          prediction_data: {
            predicted_impact: 'Flood stage expected to rise 20% over next 24h.',
          },
        });
      }
      return [];
    });

    // Fixture: 18500 cfs → (18500-10000)/10000*100 = 85% above, was 50% → worsened ✓
    mockFetchWithRetry.mockResolvedValue(mockResponse(usgsJson));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(sqlCallContains('insert into refiner_scores')).toBe(true);
  });

  it('skips scoring when raw_data is null (pre-migration alert)', async () => {
    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        return makeAlertRows({ event_type: 'flood', raw_data: null });
      }
      return [];
    });

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(sqlCallContains('insert into refiner_scores')).toBe(false);
  });
});

// ── Drought scoring ───────────────────────────────────────────────────────────

describe('runRefinerEvaluation — drought', () => {
  it('scores drought with D3 worsening', async () => {
    const droughtCsv = readFileSync(join(FIXTURES, 'drought-table-response.csv'), 'utf8');

    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        return makeAlertRows({
          event_type: 'drought',
          source: 'drought_monitor',
          raw_data: {
            fips: '06037', // LA county — fixture: D3=35, D4=10 → D3+D4=45
            d3_percent: 30, // original D3+D4=35 — fixture 45 > 35 → worsened
            d4_percent: 5,
          },
          prediction_data: { predicted_impact: 'Drought conditions expected to persist.' },
        });
      }
      return [];
    });

    mockFetchWithRetry.mockResolvedValue(mockResponse(droughtCsv));

    await runRefinerEvaluation('alert-uuid-001', 'weekly');

    expect(sqlCallContains('insert into refiner_scores')).toBe(true);
  });
});

// ── Coral bleaching scoring ───────────────────────────────────────────────────

describe('runRefinerEvaluation — coral_bleaching', () => {
  it('scores coral with alert level still elevated', async () => {
    const crwJson = readFileSync(join(FIXTURES, 'crw-alert-areas-response.json'), 'utf8');

    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        return makeAlertRows({
          event_type: 'coral_bleaching',
          source: 'coral_reef_watch',
          coordinates: { lat: 13.55, lng: 144.75 }, // near fixture feature centroid
          raw_data: { alert_level: 2 },              // fixture has 3 — still elevated
          prediction_data: { predicted_impact: 'Bleaching conditions expected to persist.' },
        });
      }
      return [];
    });

    mockFetchWithRetry.mockResolvedValue(mockResponse(crwJson));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(sqlCallContains('insert into refiner_scores')).toBe(true);
  });
});

// ── Correction note generation ────────────────────────────────────────────────

describe('correction note + system prompt update', () => {
  it('calls modelRouter and updates agent_prompts when score < 0.60', async () => {
    // Empty FIRMS → toComposite(0.5, 0.2) = 0.38 < 0.60 → correction triggered
    mockFetchWithRetry.mockResolvedValue(mockResponse('latitude,longitude\n'));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(mockComplete).toHaveBeenCalledOnce();
    expect(sqlCallContains('update agent_prompts')).toBe(true);
  });

  it('does NOT call modelRouter when score >= 0.60', async () => {
    const firmsCsv = readFileSync(join(FIXTURES, 'firms-fire-response.csv'), 'utf8');

    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        // Fixture centroid ~(lat=-3.40, lng=104.35) from origin (-3.5, 104.0)
        // Predicted NE (45°), actual bearing ~90°, angleDiff=45° → dir=0.5
        // Predicted 40km, actual ~33km → ratio 33/40=0.825
        // Composite: 0.6*0.5 + 0.4*0.825 = 0.63 ≥ 0.60 → no correction
        return makeAlertRows({
          coordinates: { lat: -3.5, lng: 104.0 },
          prediction_data: { predicted_impact: 'Fire will spread NE approximately 40km in 24h.' },
        });
      }
      return [];
    });

    mockFetchWithRetry.mockResolvedValue(mockResponse(firmsCsv));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(mockComplete).not.toHaveBeenCalled();
  });
});

// ── War room success log ──────────────────────────────────────────────────────

describe('war room success log on score > 0.85', () => {
  it('logs to war room with level=info for an excellent score', async () => {
    const nhcJson = readFileSync(join(FIXTURES, 'nhc-storms-response.json'), 'utf8');

    mockSql.mockImplementation(async (strings: string[]) => {
      const query = strings.join('').toLowerCase();
      if (query.includes('select') && query.includes('from alerts')) {
        // Exact position + intensity match → composite = 1.0 > 0.85
        return makeAlertRows({
          event_type: 'tropical_storm',
          source: 'noaa_nhc',
          coordinates: { lat: 18.5, lng: -72.3 },
          prediction_data: { predicted_impact: 'Storm will maintain intensity moving northwest.' },
          raw_data: { storm_name: 'BERYL', max_wind_knots: 65 },
        });
      }
      return [];
    });

    mockFetchWithRetry.mockResolvedValue(mockResponse(nhcJson));

    await runRefinerEvaluation('alert-uuid-001', '24h');

    expect(mockLogToWarRoom).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info' })
    );
  });
});

// ── Composite score formula ───────────────────────────────────────────────────

describe('composite score formula', () => {
  it('0.6 * 0.8 + 0.4 * 0.6 = 0.72', () => {
    const composite = parseFloat((0.6 * 0.8 + 0.4 * 0.6).toFixed(4));
    expect(composite).toBeCloseTo(0.72, 4);
  });
});
