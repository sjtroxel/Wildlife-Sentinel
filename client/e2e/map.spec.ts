import { test, expect } from '@playwright/test';

test.describe('Map panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('map panel has non-zero dimensions', async ({ page }) => {
    const mapPanel = page.locator('main > div').first();
    const box = await mapPanel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('map container renders (loading state or live map)', async ({ page }) => {
    // Either "Loading map..." text or the Leaflet container is rendered
    const mapPanel = page.locator('main > div').first();
    await expect(mapPanel).not.toBeEmpty();
  });
});
