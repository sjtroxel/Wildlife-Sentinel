import { test, expect } from '@playwright/test';

// Backend base URL (from .env.local NEXT_PUBLIC_API_URL)
const API = 'http://localhost:3000';

const ALERT_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const SPECIES_SLUG = 'sumatran-orangutan';

const mockCharities = [
  {
    id: 'c1',
    name: 'Orangutan Foundation International',
    slug: 'orangutan-foundation-international',
    url: 'https://orangutan.org',
    donation_url: 'https://orangutan.org/donate-2',
    description: 'Founded by Dr. Biruté Mary Galdikas, OFI works to protect orangutans.',
    logo_url: null,
    charity_navigator_rating: 3,
    headquarters_country: 'USA',
    focus_regions: ['Borneo', 'Sumatra'],
    is_active: true,
    created_at: '2026-04-29T00:00:00.000Z',
  },
  {
    id: 'c2',
    name: 'World Wildlife Fund',
    slug: 'wwf',
    url: 'https://www.worldwildlife.org',
    donation_url: 'https://www.worldwildlife.org/donate',
    description: 'The world\'s leading conservation organization.',
    logo_url: null,
    charity_navigator_rating: 4,
    headquarters_country: 'USA',
    focus_regions: ['Global'],
    is_active: true,
    created_at: '2026-04-29T00:00:00.000Z',
  },
];

const mockAlert = {
  id: ALERT_ID,
  source: 'nasa_firms',
  event_type: 'wildfire',
  raw_event_id: 'firms_test',
  coordinates: { lat: -3.42, lng: 104.21 },
  severity: 0.75,
  threat_level: 'high',
  confidence_score: 0.82,
  created_at: '2026-04-10T10:00:00.000Z',
  enrichment_data: { species_at_risk: ['Pongo abelii'], habitat_distance_km: 12.5 },
  prediction_data: { predicted_impact: 'Fire spreading NW.', compounding_factors: [] },
  refiner_scores: [],
  discord_message_id: null,
};

const mockSpecies = {
  slug: SPECIES_SLUG,
  species_name: 'Pongo abelii',
  common_name: 'Sumatran Orangutan',
  iucn_status: 'CR',
  iucn_species_id: 39780,
  centroid: { lat: 3.5, lng: 98.0 },
  range_geojson: null,
  recent_alerts: [],
};

// ── /charities directory page ─────────────────────────────────────────────────

test.describe('/charities directory page', () => {
  test('renders heading and charity cards', async ({ page }) => {
    await page.route(`${API}/charities`, (route) =>
      route.fulfill({ json: mockCharities })
    );

    await page.goto('/charities');

    await expect(page.locator('h1')).toHaveText('Conservation Partners');
    await expect(page.getByText('Orangutan Foundation International')).toBeVisible();
    await expect(page.getByText('World Wildlife Fund')).toBeVisible();
  });

  test('charity cards have Donate Now links', async ({ page }) => {
    await page.route(`${API}/charities`, (route) =>
      route.fulfill({ json: mockCharities })
    );

    await page.goto('/charities');

    await expect(page.getByText('Donate Now →').first()).toBeVisible();
  });

  test('shows no JS errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (text.includes('ERR_CONNECTION_REFUSED') || text.includes('Failed to load resource')) return;
        errors.push(text);
      }
    });

    await page.route(`${API}/charities`, (route) =>
      route.fulfill({ json: mockCharities })
    );

    await page.goto('/charities');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('breadcrumb links back to dashboard', async ({ page }) => {
    await page.route(`${API}/charities`, (route) =>
      route.fulfill({ json: [] })
    );

    await page.goto('/charities');
    await page.getByRole('link', { name: '← Dashboard' }).first().click();
    await expect(page).toHaveURL('/');
  });
});

// ── Homepage nav link ─────────────────────────────────────────────────────────

test.describe('Homepage nav', () => {
  test('header contains Charities nav link', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: 'Charities' });
    await expect(link).toBeVisible();
  });
});

// ── Alert detail — charity section ───────────────────────────────────────────

test.describe('Alert detail — How You Can Help section', () => {
  test('shows charity cards when charities returned for alert', async ({ page }) => {
    await page.route(`**/alerts/${ALERT_ID}`, (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ json: mockAlert });
    });
    await page.route(`${API}/charities*`, (route) =>
      route.fulfill({ json: mockCharities })
    );

    await page.goto(`/alerts/${ALERT_ID}`);

    await expect(page.getByText('💛 How You Can Help')).toBeVisible();
    await expect(page.getByText('Orangutan Foundation International')).toBeVisible();
  });

  test('charity section has link to /charities directory', async ({ page }) => {
    await page.route(`**/alerts/${ALERT_ID}`, (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ json: mockAlert });
    });
    await page.route(`${API}/charities*`, (route) =>
      route.fulfill({ json: mockCharities })
    );

    await page.goto(`/alerts/${ALERT_ID}`);

    await expect(page.getByText('Browse all conservation partners →')).toBeVisible();
  });
});

// ── Species detail — Conservation Organizations section ───────────────────────

test.describe('Species detail — Conservation Organizations section', () => {
  test('shows charity cards for the species', async ({ page }) => {
    await page.route(`**/species/${SPECIES_SLUG}`, (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ json: mockSpecies });
    });
    await page.route(`${API}/charities*`, (route) =>
      route.fulfill({ json: mockCharities })
    );

    await page.goto(`/species/${SPECIES_SLUG}`);

    await expect(page.getByText('Conservation Organizations')).toBeVisible();
    await expect(page.getByText('Orangutan Foundation International')).toBeVisible();
  });
});
