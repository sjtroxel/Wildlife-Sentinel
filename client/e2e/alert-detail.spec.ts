import { test, expect } from '@playwright/test';

const ALERT_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const mockAlert = {
  id: ALERT_ID,
  source: 'nasa_firms',
  event_type: 'wildfire',
  raw_event_id: 'firms_20260410_-3.42_104.21',
  coordinates: { lat: -3.42, lng: 104.21 },
  severity: 0.75,
  threat_level: 'high',
  confidence_score: 0.82,
  created_at: '2026-04-10T10:00:00.000Z',
  enrichment_data: {
    species_at_risk: ['Sumatran Orangutan'],
    habitat_distance_km: 12.5,
    species_status: 'CR',
    weather: 'Hot and dry with 15 km/h NW winds.',
  },
  prediction_data: {
    predicted_impact: 'Fire likely to spread NW 35km in 24h.',
    reasoning: 'Strong northwest winds and dry conditions.',
    compounding_factors: ['Species at historic population low'],
    recommended_action: 'Alert rangers in northern patrol zones.',
  },
  refiner_scores: [
    {
      evaluation_time: '24h',
      evaluated_at: '2026-04-11T10:00:00.000Z',
      composite_score: 0.72,
      direction_accuracy: 0.8,
      magnitude_accuracy: 0.61,
      correction_note: null,
    },
  ],
  discord_message_id: '1234567890',
};

test.describe('Alert detail page (/alerts/[id])', () => {
  test('renders threat assessment card, event metadata, and refiner history', async ({ page }) => {
    await page.route(`**/alerts/${ALERT_ID}`, (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ json: mockAlert });
    });

    await page.goto(`/alerts/${ALERT_ID}`);

    // Threat Assessment card
    await expect(page.getByText('Threat Assessment')).toBeVisible();
    await expect(page.getByText('Fire likely to spread NW 35km in 24h.')).toBeVisible();
    await expect(page.getByText('Species at historic population low')).toBeVisible();
    await expect(page.getByText('Alert rangers in northern patrol zones.')).toBeVisible();

    // Event metadata card
    await expect(page.getByText('Event Details')).toBeVisible();
    await expect(page.getByText('NASA FIRMS', { exact: true })).toBeVisible();
    await expect(page.getByText('Sumatran Orangutan')).toBeVisible();

    // Refiner history
    await expect(page.getByText('Prediction Accuracy (Refiner)')).toBeVisible();
  });

  test('back link navigates to dashboard', async ({ page }) => {
    await page.route(`**/alerts/${ALERT_ID}`, (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ json: mockAlert });
    });

    await page.goto(`/alerts/${ALERT_ID}`);
    // Both the header and footer have "← Dashboard" links; click the first
    await page.getByText('← Dashboard').first().click();
    await expect(page).toHaveURL('/');
  });

  test('shows error state for unknown alert ID', async ({ page }) => {
    await page.route('**/alerts/no-such-alert', (route) => {
      if (route.request().resourceType() === 'document') return route.continue();
      return route.fulfill({ status: 404, body: 'Not Found' });
    });

    await page.goto('/alerts/no-such-alert');
    await expect(page.getByText(/not found/i)).toBeVisible();
  });
});
