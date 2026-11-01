import { expect, type Page, test } from '@playwright/test';

/**
 * The home finder's "Where" field: a combobox over every city and country (grouped by country,
 * narrowed as you type, keyboard operable) and "Use my location" (emulated position, and the
 * refusals: denied, timeout, insecure page). The events list then respects what was chosen.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;

const where = (page: Page) => page.getByRole('combobox', { name: 'Where' });

test.describe('home finder: Where', () => {
  test('lists countries with their cities, filters as you type and picks with the keyboard', async ({
    page,
  }) => {
    await page.goto(MARKET);
    await where(page).focus();
    const list = page.getByRole('listbox', { name: 'Cities and countries' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('group', { name: 'France' })).toBeVisible();
    await expect(list.getByRole('option', { name: 'Paris' })).toBeVisible();
    await where(page).fill('germ');
    await expect(list.getByRole('option', { name: 'Germany' })).toBeVisible();
    await expect(list.getByRole('option', { name: 'Berlin' })).toBeVisible();
    await expect(list.getByRole('option', { name: 'Paris' })).toHaveCount(0);
    await where(page).fill('zzzzqq');
    await expect(list.getByText('No matching place')).toBeVisible();
    await where(page).fill('sao');
    await page.keyboard.press('ArrowDown');
    await expect(where(page)).toHaveAttribute('aria-activedescendant', /.+/);
    await page.keyboard.press('Enter');
    await expect(where(page)).toHaveValue(/São Paulo, Brazil/);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/city=S%C3%A3o\+Paulo|city=S%C3%A3o%20Paulo/);
  });

  test('a country is searchable and the events list says so', async ({ page }) => {
    await page.goto(MARKET);
    await where(page).fill('france');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/country=FR/);
    await expect(page.getByTestId('place-filter')).toContainText('In France');
  });

  test('"Use my location" fills the field and searches by coordinates', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'], { origin: MARKET });
    await context.setGeolocation({ latitude: 48.85, longitude: 2.35 });
    await page.goto(MARKET);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(where(page)).toHaveValue('Near Paris, France');
    await expect(page.getByRole('status').filter({ hasText: 'Nearest city: Paris' })).toBeVisible();
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/lat=48\.85/);
    await expect(page).toHaveURL(/lng=2\.35/);
    await expect(page.getByTestId('place-filter')).toContainText('Near your location');
  });

  test('a refused location explains itself and keeps the cities available', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) =>
        fail?.({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    await page.goto(MARKET);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByText('Location access is blocked.')).toBeVisible();
    await where(page).focus();
    await expect(page.getByRole('option', { name: 'Paris' })).toBeVisible();
  });

  test('a timeout is reported', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) =>
        fail?.({ code: 3, message: 'timeout' } as GeolocationPositionError);
    });
    await page.goto(MARKET);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByText('took too long')).toBeVisible();
  });

  test('the home page lets the browser ask for the location', async ({ page }) => {
    const res = await page.goto(MARKET);
    expect(res?.headers()['permissions-policy']).toContain('geolocation=(self)');
  });
});
