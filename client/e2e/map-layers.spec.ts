import { test, expect } from '@playwright/test';

async function setupPage(page: import('@playwright/test').Page) {
  await page.route('**/alerts/recent**', (route) => route.fulfill({ json: [] }));
  await page.route('**/refiner/scores**', (route) => route.fulfill({ json: [] }));
  await page.route('**/stats/trends**',   (route) => route.fulfill({ json: [] }));
}

test.describe('Map layer toggles', () => {
  test('toggle buttons are visible at 375px mobile viewport', async ({ page }) => {
    await setupPage(page);
    await page.goto('/');

    // Buttons are in the DisasterMap overlay div (absolute top-2 left-2)
    // Use exact: true to avoid matching AlertsFeed alert buttons that contain event type names
    const wildfireToggle = page.getByRole('button', { name: 'wildfire', exact: true });
    await expect(wildfireToggle).toBeVisible();

    for (const label of ['flood', 'drought', 'earthquake']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
  });

  test('clicking a toggle reduces its opacity (layer hidden)', async ({ page }) => {
    await setupPage(page);
    await page.goto('/');

    const btn = page.getByRole('button', { name: 'wildfire', exact: true });
    await expect(btn).toBeVisible();

    await expect(btn).toHaveClass(/opacity-100/);

    await btn.click();

    await expect(btn).toHaveClass(/opacity-30/);
  });

  test('clicking a toggled-off button restores opacity (layer shown again)', async ({ page }) => {
    await setupPage(page);
    await page.goto('/');

    const btn = page.getByRole('button', { name: 'wildfire', exact: true });
    await expect(btn).toBeVisible();

    await btn.click();
    await expect(btn).toHaveClass(/opacity-30/);

    await btn.click();
    await expect(btn).toHaveClass(/opacity-100/);
  });

  test('toggle buttons remain visible at 1280px desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setupPage(page);
    await page.goto('/');

    const btn = page.getByRole('button', { name: 'wildfire', exact: true });
    await expect(btn).toBeVisible();

    await btn.click();
    await expect(btn).toHaveClass(/opacity-30/);
  });
});
