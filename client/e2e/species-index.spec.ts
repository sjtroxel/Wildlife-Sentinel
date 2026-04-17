import { test, expect } from '@playwright/test';
import type { SpeciesListItem } from '@wildlife-sentinel/shared/types';

let _id = 0;
function makeSpecies(overrides: Partial<SpeciesListItem> = {}): SpeciesListItem {
  const n = ++_id;
  return {
    slug: `test-species-${n}`,
    species_name: `Testus speciesius ${n}`,
    common_name: `Test Species ${n}`,
    iucn_status: 'CR',
    iucn_species_id: null,
    ...overrides,
  };
}

function makeSpeciesList(count: number, overrides: Partial<SpeciesListItem> = {}): SpeciesListItem[] {
  return Array.from({ length: count }, () => makeSpecies(overrides));
}

function routeSpecies(
  page: import('@playwright/test').Page,
  handler: (url: URL) => unknown
) {
  return page.route('**/species**', (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    const url = new URL(route.request().url());
    return route.fulfill({ json: handler(url) });
  });
}

test.describe('Species index page (/species)', () => {
  test('renders species cards with names', async ({ page }) => {
    const species: SpeciesListItem[] = [
      makeSpecies({ slug: 'sumatran-orangutan', species_name: 'Pongo abelii', common_name: 'Sumatran Orangutan', iucn_status: 'CR' }),
      makeSpecies({ slug: 'bengal-tiger', species_name: 'Panthera tigris', common_name: 'Bengal Tiger', iucn_status: 'EN' }),
    ];

    await routeSpecies(page, () => species);
    await page.goto('/species');

    await expect(page.getByText('Sumatran Orangutan')).toBeVisible();
    await expect(page.getByText('Bengal Tiger')).toBeVisible();
    await expect(page.getByText('Pongo abelii')).toBeVisible();
  });

  test('IUCN status badges are visible', async ({ page }) => {
    const species: SpeciesListItem[] = [
      makeSpecies({ slug: 'sp-cr', common_name: 'Critically Endangered One', iucn_status: 'CR' }),
      makeSpecies({ slug: 'sp-en', common_name: 'Endangered One',            iucn_status: 'EN' }),
      makeSpecies({ slug: 'sp-vu', common_name: 'Vulnerable One',            iucn_status: 'VU' }),
    ];

    await routeSpecies(page, () => species);
    await page.goto('/species');

    // Badges render "STATUS · Label" — use partial regex to avoid middot encoding issues
    await expect(page.getByText(/CR.*Critically Endangered/)).toBeVisible();
    await expect(page.getByText(/EN.*Endangered/)).toBeVisible();
    await expect(page.getByText(/VU.*Vulnerable/)).toBeVisible();
  });

  test('Load more button appears and appends results', async ({ page }) => {
    const PAGE_SIZE = 50;
    const firstBatch = makeSpeciesList(PAGE_SIZE);
    const secondBatch: SpeciesListItem[] = [
      makeSpecies({ slug: 'extra-species', common_name: 'Extra Rare Species', iucn_status: 'VU' }),
    ];

    await routeSpecies(page, (url) => {
      const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
      return offset === 0 ? firstBatch : secondBatch;
    });

    await page.goto('/species');

    const loadMoreBtn = page.getByRole('button', { name: /load more/i });
    await expect(loadMoreBtn).toBeVisible();

    await loadMoreBtn.click();

    await expect(page.getByText('Extra Rare Species')).toBeVisible();
  });

  test('shows species count after load', async ({ page }) => {
    const species = makeSpeciesList(3);

    await routeSpecies(page, () => species);
    await page.goto('/species');

    await expect(page.getByText('3 loaded')).toBeVisible();
  });
});
