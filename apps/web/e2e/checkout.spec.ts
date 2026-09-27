import { expect, test } from '@playwright/test';
import { EVENT, expectAccessible, signIn } from './helpers.ts';

test.describe('checkout', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a guest buys a free ticket and a paid ticket through the test payment page', async ({
    page,
    browser,
  }) => {
    // Organizer sets up two ticket types.
    await signIn(page);
    await page.goto(`${EVENT}/tickets-orders`);
    const stamp = Date.now();
    for (const [name, price] of [
      [`Free pass ${stamp}`, '0'],
      [`Paid pass ${stamp}`, '40'],
    ]) {
      await page.getByLabel('Name', { exact: true }).fill(name as string);
      await page.getByLabel('Price (USD)').fill(price as string);
      await page.getByLabel('Quantity available').fill('5');
      await page.getByRole('button', { name: 'Add ticket type' }).click();
      await expect(page.getByRole('row').filter({ hasText: name as string })).toBeVisible();
    }

    // A guest (fresh context, no session) buys.
    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/midwest-leadership-summit-2027');
    await expectAccessible(guest);
    await guest.getByLabel(`Quantity — Free pass ${stamp}`).selectOption('1');
    await guest.getByLabel('Full name').fill(`Grace Hopper ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`grace+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
    await expectAccessible(guest);

    await guest.goto('/events/midwest-leadership-summit-2027');
    await guest.getByLabel(`Quantity — Paid pass ${stamp}`).selectOption('2');
    await guest.getByLabel('Full name').fill(`Alan Turing ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`alan+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await expect(guest.getByText('$80.00')).toBeVisible();
    await guest.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
    await expect(guest.getByText('$80.00').first()).toBeVisible();

    // The organizer sees both orders.
    await page.goto(`${EVENT}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: `Alan Turing ${stamp}` })).toContainText('Paid');
    await expect(page.getByRole('row').filter({ hasText: `Grace Hopper ${stamp}` })).toContainText('Paid');
  });

  test('a forged webhook is rejected', async ({ request }) => {
    const res = await request.post('/api/webhooks/fake', {
      data: { type: 'payment.succeeded', orderId: 'x' },
      headers: { 'x-fake-signature': 'deadbeef' },
    });
    expect(res.status()).toBe(400);
  });
});
