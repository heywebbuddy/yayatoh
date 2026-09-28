import { expect, test } from '@playwright/test';
import { continueToPayment, expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

test.describe('checkout', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a guest buys a free ticket and a paid ticket through the test payment page', async ({
    page,
    browser,
  }) => {
    // Organizer sets up two ticket types.
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
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
    await guest.goto('/events/lakeside-open-house');
    await expectAccessible(guest);
    await guest.getByLabel(`Quantity — Free pass ${stamp}`).selectOption('1');
    await guest.getByLabel('Full name').fill(`Grace Hopper ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`grace+${stamp}@example.test`);
    await continueToPayment(guest, `grace+${stamp}@example.test`);
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
    await expect(guest.getByRole('heading', { name: 'Your ticket' })).toBeVisible();
    await expect(guest.getByRole('img', { name: /^QR code for ticket number \d+$/ })).toHaveCount(1);
    await expectAccessible(guest);
    // The tickets PDF (Gotenberg, ADR 0017) is reached with the same manage token.
    const pdfHref = await guest.getByRole('link', { name: 'Download tickets (PDF)' }).getAttribute('href');
    const pdf = await guest.request.get(pdfHref ?? '');
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect(pdf.headers()['cache-control']).toContain('no-store');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    await guest.goto('/events/lakeside-open-house');
    await guest.getByLabel(`Quantity — Paid pass ${stamp}`).selectOption('2');
    await guest.getByLabel('Full name').fill(`Alan Turing ${stamp}`);
    await guest.getByLabel('Email for your tickets').fill(`alan+${stamp}@example.test`);
    await guest.getByLabel(/^Email me news and offers from Lakeside Events/).check();
    await continueToPayment(guest, `alan+${stamp}@example.test`);
    await expect(guest.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await expect(guest.getByText('$80.00')).toBeVisible();
    // The hosted payment page names what is being paid for (Stripe shows the same line).
    await expect(guest.getByText('Lakeside Open House', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
    await expect(guest.getByText('$80.00').first()).toBeVisible();
    await expect(guest.getByRole('heading', { name: 'Your 2 tickets' })).toBeVisible();
    await expect(guest.getByRole('img', { name: /^QR code for ticket number \d+$/ })).toHaveCount(2);

    // The organizer sees both orders.
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: `Alan Turing ${stamp}` })).toContainText('Paid');
    await expect(page.getByRole('row').filter({ hasText: `Grace Hopper ${stamp}` })).toContainText('Paid');

    // Every ticket became an attendee: one for Grace, two for Alan.
    await page.goto(`${OPEN_HOUSE}/attendees?q=${stamp}`);
    await expect(page.getByRole('row').filter({ hasText: `Grace Hopper ${stamp}` })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: `Alan Turing ${stamp}` })).toHaveCount(2);
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: `Alan Turing ${stamp}` })
        .first(),
    ).toContainText(`Paid pass ${stamp}`);
    await expectAccessible(page);
  });

  test('an unknown order token gets no PDF', async ({ request }) => {
    const res = await request.get(`/orders/${'x'.repeat(43)}/pdf`);
    expect(res.status()).toBe(404);
  });

  test('a forged webhook is rejected', async ({ request }) => {
    const res = await request.post('/api/webhooks/fake', {
      data: { type: 'payment.succeeded', orderId: 'x' },
      headers: { 'x-fake-signature': 'deadbeef' },
    });
    expect(res.status()).toBe(400);
  });

  test('only the configured provider has a webhook endpoint (Stripe is off in dev and CI)', async ({
    request,
  }) => {
    const stripe = await request.post('/api/webhooks/stripe', {
      data: '{"id":"evt_1","type":"checkout.session.completed"}',
      headers: { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json' },
    });
    expect(stripe.status()).toBe(404);
  });
});
