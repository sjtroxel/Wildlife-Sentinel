import { test, expect } from '@playwright/test';

const trendData = [
  {
    date: '2026-04-01',
    wildfire: 3, tropical_storm: 1, flood: 2, drought: 0, coral_bleaching: 1,
    earthquake: 0, volcanic_eruption: 0, deforestation: 1, sea_ice_loss: 0,
    climate_anomaly: 0, illegal_fishing: 0,
  },
  {
    date: '2026-04-02',
    wildfire: 2, tropical_storm: 0, flood: 1, drought: 1, coral_bleaching: 0,
    earthquake: 1, volcanic_eruption: 0, deforestation: 0, sea_ice_loss: 1,
    climate_anomaly: 0, illegal_fishing: 1,
  },
];

test.describe('Trend chart (TrendChart)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/alerts/recent**', (route) => route.fulfill({ json: [] }));
    await page.route('**/refiner/scores**', (route) => route.fulfill({ json: [] }));
    await page.route('**/stats/trends**',   (route) => route.fulfill({ json: trendData }));
  });

  test('chart heading renders when trend data is available', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Alert Frequency (30 days)')).toBeVisible();
  });

  test('legend entries visible for multiple event types', async ({ page }) => {
    await page.goto('/');

    // Recharts legend uses EVENT_LABELS mapping: 'wildfire' → 'Wildfire' etc.
    // Buttons say 'wildfire' (lowercase); legend says 'Wildfire' (capitalized).
    // Use exact: true so 'Wildfire' doesn't match the lowercase toggle button.
    await expect(page.getByText('Wildfire', { exact: true })).toBeVisible();
    await expect(page.getByText('Flood', { exact: true })).toBeVisible();
    await expect(page.getByText('Illegal Fishing', { exact: true })).toBeVisible();
  });

  test('chart does not render when trend data is empty', async ({ page }) => {
    // Override the trends route to return empty array for this test
    await page.route('**/stats/trends**', (route) => route.fulfill({ json: [] }));
    await page.goto('/');
    await expect(page.getByText('Alert Frequency (30 days)')).not.toBeVisible();
  });
});
