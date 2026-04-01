import { test, expect } from '@playwright/test';

test.describe('Layout — 375px mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore network failures — backend may not be running in test env
        if (!text.includes('ERR_CONNECTION_REFUSED') && !text.includes('Failed to load resource')) {
          errors.push(text);
        }
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('header contains Wildlife Sentinel logo', async ({ page }) => {
    const logo = page.locator('img[alt="Wildlife Sentinel"]');
    await expect(logo).toBeVisible();
  });

  test('no horizontal scroll at 375px', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });

  test('map container is present', async ({ page }) => {
    // The map panel div wraps DisasterMap; loading state or live map both render content
    const mapPanel = page.locator('main > div').first();
    await expect(mapPanel).toBeVisible();
  });

  test('Recent Alerts heading is present', async ({ page }) => {
    await expect(page.getByText('Recent Alerts')).toBeVisible();
  });

  test('Agent Activity heading is present', async ({ page }) => {
    await expect(page.getByText('Agent Activity')).toBeVisible();
  });
});
