import { test, expect } from '@playwright/test';

test.describe('Responsive layout', () => {
  test('768px — right panel is visible alongside map', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');

    const mapPanel = page.locator('main > div').first();
    const rightPanel = page.locator('main > div').last();

    await expect(mapPanel).toBeVisible();
    await expect(rightPanel).toBeVisible();

    // Both panels should be present in the viewport
    const mapBox = await mapPanel.boundingBox();
    const rightBox = await rightPanel.boundingBox();
    expect(mapBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
  });

  test('1280px — two-column grid layout (map and right panel side by side)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    const mapPanel = page.locator('main > div').first();
    const rightPanel = page.locator('main > div').last();

    const mapBox = await mapPanel.boundingBox();
    const rightBox = await rightPanel.boundingBox();

    expect(mapBox).not.toBeNull();
    expect(rightBox).not.toBeNull();

    // At 1280px the grid kicks in — panels should be horizontally adjacent
    // (right panel's left edge is to the right of the map panel's left edge)
    expect(rightBox!.x).toBeGreaterThan(mapBox!.x);
  });

  test('1280px — no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1280);
  });
});
