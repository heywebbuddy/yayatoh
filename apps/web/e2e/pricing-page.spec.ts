import { expect, test } from '@playwright/test';
import { expectAccessible } from './helpers.ts';

/** The public pricing and fees page (M3.11a), rendered from the fee configuration. */
test.describe('pricing and fees page', () => {
  test('from the marketplace header; the fee and an all-in example per currency; keyboard; axe', async ({
    page,
  }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Site', exact: true })
      .getByRole('link', { name: 'Pricing' })
      .click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole('heading', { name: 'Pricing and fees', level: 1 })).toBeVisible();
    // Every configured currency of the default plan (seeded: CAD, EUR, GBP, USD); USD by default.
    const currencies = page.getByRole('navigation', { name: 'Currency' });
    await expect(currencies.getByRole('link')).toHaveText(['CAD', 'EUR', 'GBP', 'USD']);
    await expect(currencies.getByRole('link', { name: 'USD' })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('heading', { name: 'Platform fee (USD)' })).toBeVisible();
    // The launch schedule is 0 until the owner sets the fee: shown as such, not as copy.
    await expect(page.getByText('No platform fee per ticket right now')).toBeVisible();
    const example = page.getByRole('table', { name: 'Example: one $25.00 ticket' });
    await expect(example.getByRole('row', { name: /Fee passed on/ })).toContainText('$25.00');
    await expect(example.getByRole('row', { name: /Fee absorbed/ })).toContainText('$25.00');
    await expect(page.getByRole('heading', { name: 'All-in pricing' })).toBeVisible();
    await expectAccessible(page);

    // Keyboard: switch to euros.
    await currencies.getByRole('link', { name: 'EUR' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/pricing\?currency=EUR$/);
    await expect(page.getByRole('heading', { name: 'Platform fee (EUR)' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Example: one €25.00 ticket' })).toBeVisible();
    // An unknown currency falls back instead of failing.
    await page.goto('/pricing?currency=XYZ');
    await expect(page.getByRole('heading', { name: 'Platform fee (USD)' })).toBeVisible();

    await page.getByRole('link', { name: 'Create your organization' }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('the buyer’s country picks the currency when they haven’t', async ({ browser }) => {
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-vercel-ip-country': 'GB' } });
    const page = await context.newPage();
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: 'Platform fee (GBP)' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Example: one £25.00 ticket' })).toBeVisible();
    await context.close();
  });

  test('Arabic, right to left', async ({ page }) => {
    await page.goto('/ar/pricing');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الأسعار والرسوم', level: 1 })).toBeVisible();
    await expect(page.getByText('لا توجد رسوم منصة على التذكرة حاليًا')).toBeVisible();
    await expectAccessible(page);
  });
});
