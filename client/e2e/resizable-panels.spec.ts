import { test, expect } from '@playwright/test';

async function mockBackgroundApis(page: import('@playwright/test').Page) {
  await page.route('**/alerts/recent**', (route) => route.fulfill({ json: [] }));
  await page.route('**/refiner/scores**', (route) => route.fulfill({ json: [] }));
  await page.route('**/stats/trends**',   (route) => route.fulfill({ json: [] }));
}

test.describe('Resizable panels', () => {
  test('desktop (1280px) — horizontal resize handle exists', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockBackgroundApis(page);
    await page.goto('/');

    // HResizeHandle uses cursor-col-resize class
    const hHandle = page.locator('.cursor-col-resize').first();
    await expect(hHandle).toBeVisible();
  });

  test('desktop (1280px) — multiple vertical resize handles in right column', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockBackgroundApis(page);
    await page.goto('/');

    const vHandles = page.locator('.cursor-row-resize');
    await expect(vHandles.first()).toBeVisible();
    expect(await vHandles.count()).toBeGreaterThanOrEqual(3);
  });

  test('mobile (375px) — no horizontal handle, only vertical handles', async ({ page }) => {
    await mockBackgroundApis(page);
    await page.goto('/');

    // Mobile uses vertical Group only — no horizontal (col-resize) handle
    expect(await page.locator('.cursor-col-resize').count()).toBe(0);

    await expect(page.locator('.cursor-row-resize').first()).toBeVisible();
  });

  test('panels are independently scrollable', async ({ page }) => {
    await mockBackgroundApis(page);
    await page.goto('/');

    // react-resizable-panels wraps each Panel in a child div with overflow:auto
    // Verify at least one such scrollable container exists
    const scrollableCount = await page.evaluate(() =>
      document.querySelectorAll('[data-panel] > div[style*="overflow"]').length
    );
    expect(scrollableCount).toBeGreaterThanOrEqual(1);
  });

  test('layout switches from vertical to horizontal at lg breakpoint', async ({ page }) => {
    await mockBackgroundApis(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    expect(await page.locator('.cursor-col-resize').count()).toBe(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(200);

    await expect(page.locator('.cursor-col-resize').first()).toBeVisible();
  });
});
