import { expect, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

test.describe('early-bird, donation and multi-day passes', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer adds them; the public page shows them and a guest gives a chosen amount', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    const add = async (fill: () => Promise<void>, name: string) => {
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByLabel('Quantity available').fill('20');
      await fill();
      await page.getByRole('button', { name: 'Add ticket type' }).click();
      await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
    };
    await add(async () => {
      await page.getByLabel('Price (USD)').fill('30');
      await page.getByLabel('Early-bird price (USD, optional)').fill('20');
      await page.getByLabel('Early-bird ends (event time)').fill('2099-01-31T23:59');
      await page
        .getByLabel('Days this pass admits (optional)')
        .fill('2027-06-11 Gala Night\n2027-06-10 Welcome');
    }, `Early ${stamp}`);
    await add(async () => {
      await page.getByLabel('Price (USD)').fill('5');
      await page.getByLabel('Buyers choose the amount').check();
    }, `Supporter ${stamp}`);
    await expectAccessible(page);

    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/lakeside-open-house');
    const early = guest
      .getByRole('listitem')
      .filter({ has: guest.getByText(`Early ${stamp}`, { exact: true }) });
    await expect(early).toContainText('$20');
    await expect(early).toContainText('Early-bird price until Jan 31 (then $30)');
    await expect(early.getByRole('list', { name: 'Days this pass admits' }).getByRole('listitem')).toHaveText(
      [/^Welcome · /, /^Gala Night · /],
    );
    await expectAccessible(guest);

    await guest.getByLabel(`Quantity — Supporter ${stamp}`).selectOption('1');
    await guest.getByLabel(/^Your amount — Supporter/).fill('2');
    await guest.getByLabel('Full name').fill(`Ada ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`ada+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest.getByRole('region', { name: 'Choose your pass' }).getByRole('alert')).toContainText(
      'Enter an amount at or above the minimum',
    );

    await guest.getByLabel(`Quantity — Supporter ${stamp}`).selectOption('1');
    await guest.getByLabel(/^Your amount — Supporter/).fill('12.50');
    await guest.getByLabel('Full name').fill(`Ada ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`ada+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await expect(guest.getByText('$12.50')).toBeVisible();
  });
});
