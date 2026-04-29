import { test, expect } from '@playwright/test';

test.describe('Responsive layout', () => {
  test('768px — right panel is visible alongside map', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');

    // Phase 10: react-resizable-panels — panels have data-panel-id attribute
    const panels = page.locator('[data-panel]');
    const firstPanel = panels.first();
    const lastPanel = panels.last();

    await expect(firstPanel).toBeVisible();
    await expect(lastPanel).toBeVisible();

    const firstBox = await firstPanel.boundingBox();
    const lastBox = await lastPanel.boundingBox();
    expect(firstBox).not.toBeNull();
    expect(lastBox).not.toBeNull();
  });

  test('1280px — two-column grid layout (map and right panel side by side)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    const panels = page.locator('[data-panel]');
    const firstPanel = panels.first();
    const lastPanel = panels.last();

    // Wait for React hydration to complete before reading layout positions
    await expect(firstPanel).toBeVisible();
    await expect(lastPanel).toBeVisible();

    const firstBox = await firstPanel.boundingBox();
    const lastBox = await lastPanel.boundingBox();

    expect(firstBox).not.toBeNull();
    expect(lastBox).not.toBeNull();

    // At 1280px the horizontal layout kicks in — panels are side by side
    expect(lastBox!.x).toBeGreaterThan(firstBox!.x);
  });

  test('1280px — no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1280);
  });
});
