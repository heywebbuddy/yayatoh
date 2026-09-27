import { expect, test } from '@playwright/test';
import { EVENT, expectAccessible, signIn } from './helpers.ts';

test.describe('ticket types', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an owner adds a ticket type and it appears on the public page at the all-in price', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`${EVENT}/tickets-orders`);
    const name = `Balcony ${Date.now()}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Price (USD)').fill('75');
    await page.getByLabel('Quantity available').fill('40');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByText('Ticket type added.')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toContainText('$75.00');
    await expectAccessible(page);

    await page.goto('/events/midwest-leadership-summit-2027');
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText('$75')).toBeVisible();

    await page.goto(`${EVENT}/tickets-orders`);
    await page.getByRole('button', { name: `Remove ${name}` }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });

  test('a viewer sees ticket types read-only', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto(`${EVENT}/tickets-orders`);
    await expect(page.getByRole('button', { name: 'Add ticket type' })).toHaveCount(0);
  });
});
