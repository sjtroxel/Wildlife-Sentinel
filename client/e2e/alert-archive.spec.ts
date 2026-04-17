import { test, expect } from '@playwright/test';

function makeAlert(overrides: Record<string, unknown> = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    source: 'nasa_firms',
    event_type: 'wildfire',
    threat_level: 'high',
    confidence_score: 0.8,
    severity: 0.7,
    created_at: '2026-04-10T10:00:00.000Z',
    coordinates: { lat: -3.42, lng: 104.21 },
    ...overrides,
  };
}

function makeAlerts(n: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: n }, () => makeAlert(overrides));
}

// Intercept only API calls, not Next.js page navigation
function routeAlerts(
  page: import('@playwright/test').Page,
  handler: (url: URL) => unknown
) {
  return page.route('**/alerts**', (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    const url = new URL(route.request().url());
    return route.fulfill({ json: handler(url) });
  });
}

test.describe('Alert archive page (/alerts)', () => {
  test('initial load renders alert rows', async ({ page }) => {
    const alerts = [
      makeAlert({ event_type: 'wildfire', threat_level: 'high' }),
      makeAlert({ event_type: 'flood',    threat_level: 'medium' }),
    ];

    await routeAlerts(page, (url) => {
      if (url.pathname.includes('/recent')) return [];
      return alerts;
    });

    await page.goto('/alerts');

    await expect(page.locator('ul li').getByText('wildfire').first()).toBeVisible();
    await expect(page.locator('ul li').getByText('flood').first()).toBeVisible();
  });

  test('filter by event type passes event_type param to API', async ({ page }) => {
    const wildfireAlert = makeAlert({ event_type: 'wildfire', threat_level: 'high' });
    const capturedUrls: string[] = [];

    await routeAlerts(page, (url) => {
      if (url.pathname.includes('/recent')) return [];
      capturedUrls.push(url.search);
      return [wildfireAlert];
    });

    await page.goto('/alerts');
    await page.waitForSelector('select');

    // Select "wildfire" from the first dropdown (event type)
    await page.locator('select').first().selectOption('wildfire');
    await page.getByRole('button', { name: 'Apply' }).click();

    // Wait for the results to refresh
    await page.waitForFunction(() =>
      document.querySelectorAll('ul > li').length > 0
    );

    // Verify that at least one API call included event_type=wildfire
    expect(capturedUrls.some((s) => s.includes('event_type=wildfire'))).toBe(true);
  });

  test('filter by threat level passes threat_level param to API', async ({ page }) => {
    const capturedUrls: string[] = [];

    await routeAlerts(page, (url) => {
      if (url.pathname.includes('/recent')) return [];
      capturedUrls.push(url.search);
      return [makeAlert({ threat_level: 'high' })];
    });

    await page.goto('/alerts');
    await page.waitForSelector('select');

    // Second dropdown is threat level
    await page.locator('select').nth(1).selectOption('high');
    await page.getByRole('button', { name: 'Apply' }).click();

    await page.waitForFunction(() =>
      document.querySelectorAll('ul > li').length > 0
    );

    expect(capturedUrls.some((s) => s.includes('threat_level=high'))).toBe(true);
  });

  test('Load more button appends additional results', async ({ page }) => {
    const PAGE_SIZE = 50;
    const firstBatch = makeAlerts(PAGE_SIZE, { event_type: 'wildfire' });
    const secondBatch = [makeAlert({ event_type: 'drought', threat_level: 'medium' })];

    await routeAlerts(page, (url) => {
      if (url.pathname.includes('/recent')) return [];
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
      return offset === 0 ? firstBatch : secondBatch;
    });

    await page.goto('/alerts');

    // With 50 results, hasMore = true → "Load more" button shown
    const loadMoreBtn = page.getByRole('button', { name: /load more/i });
    await expect(loadMoreBtn).toBeVisible();

    await loadMoreBtn.click();

    // After second batch, drought alert from secondBatch appears
    await expect(page.locator('ul li').getByText('drought').first()).toBeVisible();
  });

  test('empty state shown when no alerts match', async ({ page }) => {
    await routeAlerts(page, (url) => {
      if (url.pathname.includes('/recent')) return [];
      return [];
    });

    await page.goto('/alerts');

    await expect(page.getByText('No alerts match these filters.')).toBeVisible();
  });
});
