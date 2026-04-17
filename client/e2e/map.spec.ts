import { test, expect } from '@playwright/test';

test.describe('Map panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('map panel has non-zero dimensions', async ({ page }) => {
    // Phase 10: react-resizable-panels — Panel divs have data-panel attribute
    const mapPanel = page.locator('[data-panel]').first();
    const box = await mapPanel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('map container renders (loading state or live map)', async ({ page }) => {
    const mapPanel = page.locator('[data-panel]').first();
    await expect(mapPanel).not.toBeEmpty();
  });
});
