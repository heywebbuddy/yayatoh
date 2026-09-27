import { expect, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

test.describe('promo codes', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer adds a one-use code; the first guest saves, the second is told it is not valid', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const pass = `Promo pass ${stamp}`;
    const code = `SAVE${stamp}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('20');
    await page.getByLabel('Quantity available').fill('10');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    await page.getByLabel('Code', { exact: true }).fill(code.toLowerCase());
    await page.getByLabel('Discount type').selectOption('percent');
    await page.getByLabel('Discount', { exact: true }).fill('25');
    await page.getByLabel('Maximum uses (optional)').fill('1');
    await page.getByRole('button', { name: 'Add code' }).click();
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toContainText('25% off');
    await expect(row).toContainText('0 / 1');
    await expectAccessible(page);

    const buy = async (name: string) => {
      const guest = await (await browser.newContext()).newPage();
      await guest.goto('/events/lakeside-open-house');
      await guest.getByLabel(`Quantity — ${pass}`).selectOption('1');
      await guest.getByLabel('Full name').fill(`${name} ${stamp}`);
      await guest.getByLabel('Email for your tickets').fill(`${name.toLowerCase()}+${stamp}@example.test`);
      await guest.getByLabel('Promo code').fill(code.toLowerCase());
      await guest.getByRole('button', { name: 'Continue to payment' }).click();
      return guest;
    };

    const first = await buy('Katherine');
    await expect(first.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await expect(first.getByText('$15.00')).toBeVisible();
    await first.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(first.getByText('Paid', { exact: true })).toBeVisible();
    await expect(first.getByText(`Includes $5.00 off with ${code}`)).toBeVisible();

    const second = await buy('Dorothy');
    await expect(second.getByRole('alert')).toContainText("That promo code isn't valid for these tickets.");

    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: code })).toContainText('1 / 1');
  });
});
