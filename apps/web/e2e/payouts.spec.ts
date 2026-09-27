import { expect, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

test.describe('payouts', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an owner connects a payout account; buyers then pay the organizer directly', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events');
    await page.getByRole('link', { name: 'Payouts' }).first().click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/payouts$/);
    await expectAccessible(page);

    // A fresh database starts without an account; a rerun locally finds it already active.
    const start = page.getByRole('button', { name: 'Set up payouts' });
    if (await start.isVisible()) {
      await start.click();
      await expect(page).toHaveURL(/\/connect\/fake\?/);
      await expectAccessible(page);
      await page.getByRole('button', { name: 'Submit with details missing' }).click();
      await expect(page).toHaveURL(/\/payouts\?onboarding=returned$/);
      await expect(page.getByText('More information needed')).toBeVisible();
      await expect(page.getByText('external_account')).toBeVisible();
      await page.getByRole('button', { name: 'Continue setup' }).click();
      await page.getByRole('button', { name: 'Finish setup' }).click();
      await expect(page).toHaveURL(/\/payouts\?onboarding=returned$/);
    } else if (await page.getByRole('button', { name: 'Continue setup' }).isVisible()) {
      // A local rerun after an interrupted run: setup was started but not finished; resume it.
      await expect(page.getByText('Setup started')).toBeVisible();
      await page.getByRole('button', { name: 'Continue setup' }).click();
      await page.getByRole('button', { name: 'Finish setup' }).click();
      await expect(page).toHaveURL(/\/payouts\?onboarding=returned$/);
    }
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText('New orders are paid straight into your account.')).toBeVisible();
    await expectAccessible(page);

    // Checkout now charges the organizer's connected account (the fake page shows it in its URL).
    const stamp = Date.now();
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(`Direct pass ${stamp}`);
    await page.getByLabel('Price (USD)').fill('25');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: `Direct pass ${stamp}` })).toBeVisible();
    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/lakeside-open-house');
    await guest.getByLabel(`Quantity — Direct pass ${stamp}`).selectOption('1');
    await guest.getByLabel('Full name').fill('Direct Buyer');
    await guest.getByLabel('Email for your tickets').fill(`direct+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/checkout\/fake\?.*acct=fakeacct_/);
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
    await expect(guest.getByText(/^Sold by (?!Pani)/)).toBeVisible();
  });
});
