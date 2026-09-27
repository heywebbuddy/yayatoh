import { expect, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

test.describe('refunds', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer refunds one ticket of a paid order; the ticket stops working and the buyer sees it', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const pass = `Refundable ${stamp}`;
    const buyer = `Rita Refund ${stamp}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('30');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    // A guest buys two tickets through the test payment page.
    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/lakeside-open-house');
    await guest.getByLabel(`Quantity — ${pass}`).selectOption('2');
    await guest.getByLabel('Full name').fill(buyer);
    await guest.getByLabel('Email for your tickets').fill(`rita+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    const orderUrl = guest.url();

    // The organizer opens the order and refunds one ticket.
    await page.reload();
    await page.getByRole('link', { name: buyer }).click();
    await expect(page.getByRole('heading', { name: `Order from ${buyer}` })).toBeVisible();
    await expectAccessible(page);
    const form = page.getByRole('region', { name: 'Refund' });
    await form.getByLabel('Reason').selectOption('requested_by_customer');
    await form.getByRole('checkbox').first().check();
    await form.getByRole('button', { name: 'Refund' }).click();
    await expect(form.getByText(/^Refunded\./)).toBeVisible();
    await expect(page.getByText('Partially refunded').first()).toBeVisible();
    const tickets = page.getByRole('table', { name: 'Tickets' });
    await expect(tickets.getByText('Void')).toHaveCount(1);
    const refunds = page.getByRole('table', { name: 'Refunds' });
    await expect(refunds.getByText('The buyer asked')).toBeVisible();
    await expectAccessible(page);

    // Asking for more than is left is refused.
    await form.getByLabel('An amount (tickets stay valid)').check();
    await form.getByLabel('Amount (USD)').fill('1000');
    await form.getByRole('button', { name: 'Refund' }).click();
    await expect(form.getByText('That is more than is left to refund on this order.')).toBeVisible();

    // The buyer's page shows the partial refund and only the ticket that still works.
    await guest.goto(orderUrl);
    await expect(guest.getByText('Partially refunded').first()).toBeVisible();
    await expect(guest.getByRole('img', { name: /^QR code for ticket number \d+$/ })).toHaveCount(1);
  });
});
