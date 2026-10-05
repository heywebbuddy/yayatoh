import { expect, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, pickOption, signIn } from './helpers.ts';

test.describe('box office', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer records a Zelle sale; tickets are issued and the order says who collected', async ({
    page,
  }) => {
    const stamp = Date.now();
    const pass = `Door ${stamp}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('15');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    const box = page.getByRole('region', { name: 'Box office' });
    await box.getByLabel("Buyer's name").fill(`Zed Zelle ${stamp}`);
    await box.getByLabel(/Buyer's email/).fill(`zed+${stamp}@example.test`);
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Choose at least one ticket.')).toBeVisible();
    // A refused sale keeps what was typed.
    await expect(box.getByLabel("Buyer's name")).toHaveValue(`Zed Zelle ${stamp}`);
    await box.getByLabel(new RegExp(`^${pass}`)).fill('2');
    await pickOption(box.getByLabel('Paid by'), 'zelle');
    await box.getByLabel(/Reference/).fill('ZL-777');
    await expectAccessible(page);
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Sale recorded. The tickets are on their way.')).toBeVisible();
    await box.getByRole('link', { name: 'Open the order' }).click();

    await expect(page.getByRole('heading', { name: `Order from Zed Zelle ${stamp}` })).toBeVisible();
    await expect(page.getByText('Collected by you · Zelle · ZL-777')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Tickets' }).getByText('Valid')).toHaveCount(2);
    // Money the organizer holds is refunded in person: no refund form here.
    await expect(page.getByRole('region', { name: 'Refund' })).toHaveCount(0);
    await expectAccessible(page);
  });
});
