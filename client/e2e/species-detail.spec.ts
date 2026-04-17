import { test, expect } from '@playwright/test';

const SLUG = 'sumatran-orangutan';

const mockSpecies = {
  slug: SLUG,
  species_name: 'Pongo abelii',
  common_name: 'Sumatran Orangutan',
  iucn_status: 'CR',
  iucn_species_id: 39780,
  centroid: { lat: 3.5, lng: 98.0 },
  range_geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[[95, 2], [101, 2], [101, 5], [95, 5], [95, 2]]],
        },
      },
    ],
  },
  recent_alerts: [
    {
      id: 'alert-001',
      event_type: 'wildfire',
      threat_level: 'high',
      source: 'nasa_firms',
      coordinates: { lat: -3.42, lng: 104.21 },
      created_at: '2026-04-10T10:00:00.000Z',
    },
  ],
};

test.describe('Species detail page (/species/[slug])', () => {
  test('renders IUCN badge, range map section, and recent alerts', async ({ page }) => {
    await page.route(`**/species/${SLUG}`, (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ json: mockSpecies });
    });

    await page.goto(`/species/${SLUG}`);

    await expect(page.getByText('Sumatran Orangutan').first()).toBeVisible();
    await expect(page.getByText('Pongo abelii').first()).toBeVisible();

    // Badge: "CR · Critically Endangered" — partial match avoids middot encoding issues
    await expect(page.getByText(/CR.*Critically Endangered/)).toBeVisible();

    // Habitat range section
    await expect(page.getByRole('heading', { name: 'Habitat Range' })).toBeVisible();

    // Recent alerts section
    await expect(page.getByText('Recent Alerts Involving This Species')).toBeVisible();
    await expect(page.getByText('Wildfire')).toBeVisible();
  });

  test('handles 404 gracefully with error state and back link', async ({ page }) => {
    await page.route('**/species/nonexistent-species', (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ status: 404, body: 'Not Found' });
    });

    await page.goto('/species/nonexistent-species');

    await expect(page.getByText(/not found/i)).toBeVisible();
    await expect(page.getByText('← Species list')).toBeVisible();
  });

  test('footer back link navigates to /species', async ({ page }) => {
    await page.route(`**/species/${SLUG}`, (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ json: mockSpecies });
    });

    await page.goto(`/species/${SLUG}`);

    // Footer has "← All species" link
    await page.getByText('← All species').click();
    await expect(page).toHaveURL('/species');
  });

  test('shows empty alert state when species has no recent alerts', async ({ page }) => {
    const speciesNoAlerts = { ...mockSpecies, recent_alerts: [] };

    await page.route(`**/species/${SLUG}`, (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ json: speciesNoAlerts });
    });

    await page.goto(`/species/${SLUG}`);

    await expect(page.getByText('No alerts recorded for this species yet.')).toBeVisible();
  });
});
