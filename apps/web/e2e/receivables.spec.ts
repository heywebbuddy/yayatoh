import { expect, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

/**
 * Receivables on the settlement view (M1.6e): a refund after the organizer's funds were released
 * (platform_mor) takes the organizer's share from the event's reserve, and the rest is owed —
 * shown on Payouts until the next payout nets it.
 */
test.describe('receivables (M1.6e)', () => {
  test('a refund after release shows as a receivable on the settlement view', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Released ${stamp}`;
    const buyer = `Rae Receivable ${stamp}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('40');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/lakeside-open-house');
    await guest.getByLabel(`Quantity — ${pass}`).selectOption('2');
    await guest.getByLabel('Full name').fill(buyer);
    await guest.getByLabel('Email for your tickets').fill(`rae+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);

    // The release job runs after the event (dev route; the worker does it every 10 minutes).
    const res = await page.request.post('/api/dev/payments/settle', {
      form: { org: 'lakeside-events', now: '2035-01-01T00:00:00Z' },
    });
    expect(res.status()).toBe(200);

    // Refund one ticket after release.
    await page.reload();
    await page.getByRole('link', { name: buyer }).click();
    const form = page.getByRole('region', { name: 'Refund', exact: true });
    await form.getByLabel('Reason').selectOption('duplicate');
    await form
      .getByRole('checkbox', { name: new RegExp(`#\\d+ · ${pass}`) })
      .first()
      .check();
    await form.getByRole('button', { name: 'Refund' }).click();
    await expect(form.getByText(/^Refunded\./)).toBeVisible();

    await page.goto('/o/lakeside-events/payouts');
    const receivables = page.getByRole('region', { name: 'Receivables' });
    const history = receivables.getByRole('table', { name: 'Receivable history' });
    await expect(history.getByText(/^Refund after payout · /).first()).toBeVisible();
    // Still owed — or already taken from a later payout (another run's release may have netted it).
    await expect(
      receivables
        .getByText('Taken from your next payout')
        .or(history.getByText('Taken from a payout'))
        .first(),
    ).toBeVisible();
    // The release it came after is on the same page.
    await expect(page.getByRole('region', { name: 'Settlements' }).getByRole('table')).toBeVisible();
    await expectAccessible(page);

    await page.goto('/ar/o/lakeside-events/payouts');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'المستحقات' })).toBeVisible();
    await expectAccessible(page);
  });

  test('viewers see no receivables or settlements', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events/payouts');
    await expect(page.getByRole('heading', { name: 'Payouts', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Receivables' })).toHaveCount(0);
  });
});
