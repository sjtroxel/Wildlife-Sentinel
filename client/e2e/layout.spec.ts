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
        if (text.includes('ERR_CONNECTION_REFUSED')) return;
        if (text.includes('Failed to load resource')) return;
        // Ignore React's expected warning about anti-flash script tags in layout.tsx
        if (text.includes('Encountered a script tag')) return;
        errors.push(text);
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('header contains Wildlife Sentinel logo', async ({ page }) => {
    // Phase 10 dark mode added two logo images (light + dark variant). Use first().
    const logo = page.locator('img[alt="Wildlife Sentinel"]').first();
    await expect(logo).toBeVisible();
  });

  test('no horizontal scroll at 375px', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });

  test('main content area is present', async ({ page }) => {
    // Phase 10 replaced <main> with react-resizable-panels — target the panel group div
    // that immediately follows the <header>
    const content = page.locator('header + div');
    await expect(content).toBeVisible();
  });

  test('Recent Alerts heading is present', async ({ page }) => {
    await expect(page.getByText('Recent Alerts')).toBeVisible();
  });

  test('Agent Activity heading is present', async ({ page }) => {
    await expect(page.getByText('Agent Activity')).toBeVisible();
  });
});
