import { test, expect } from '@playwright/test';

async function mockBackgroundApis(page: import('@playwright/test').Page) {
  await page.route('**/alerts/recent**', (route) => route.fulfill({ json: [] }));
  await page.route('**/refiner/scores**', (route) => route.fulfill({ json: [] }));
  await page.route('**/stats/trends**',   (route) => route.fulfill({ json: [] }));
}

test.describe('Dark mode toggle', () => {
  test('clicking toggle switches .dark class on <html>', async ({ page }) => {
    await mockBackgroundApis(page);
    await page.goto('/');

    const isDarkBefore = await page.evaluate(
      () => document.documentElement.classList.contains('dark')
    );

    await page.getByLabel('Toggle colour scheme').click();

    const isDarkAfter = await page.evaluate(
      () => document.documentElement.classList.contains('dark')
    );

    expect(isDarkAfter).toBe(!isDarkBefore);
  });

  test('preference persists on page reload via localStorage', async ({ page }) => {
    await mockBackgroundApis(page);
    await page.goto('/');

    const wasAlreadyDark = await page.evaluate(
      () => document.documentElement.classList.contains('dark')
    );
    if (!wasAlreadyDark) {
      await page.getByLabel('Toggle colour scheme').click();
    }

    const stored = await page.evaluate(() => localStorage.getItem('theme'));
    expect(stored).toBe('dark');

    await mockBackgroundApis(page);
    await page.reload();

    const isDarkAfterReload = await page.evaluate(
      () => document.documentElement.classList.contains('dark')
    );
    expect(isDarkAfterReload).toBe(true);
  });

  test('system dark preference activates dark mode on first load', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.context().addInitScript(() => {
      window.localStorage.removeItem('theme');
    });
    await mockBackgroundApis(page);
    await page.goto('/');

    const isDark = await page.evaluate(
      () => document.documentElement.classList.contains('dark')
    );
    expect(isDark).toBe(true);
  });

  test('light preference in localStorage keeps light mode on reload', async ({ page }) => {
    await page.context().addInitScript(() => {
      window.localStorage.setItem('theme', 'light');
    });
    await mockBackgroundApis(page);
    await page.goto('/');

    const isDark = await page.evaluate(
      () => document.documentElement.classList.contains('dark')
    );
    expect(isDark).toBe(false);
  });
});
