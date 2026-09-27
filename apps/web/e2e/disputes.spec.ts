import { expect, test } from '@playwright/test';
import { signFakeDisputeWebhook } from '@yayatoh/payments';
import { expectAccessible, OPEN_HOUSE, signIn } from './helpers.ts';

test.describe('disputes', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a card dispute shows on the order with a downloadable evidence packet', async ({ page, browser }) => {
    const secret = process.env.FAKE_PAYMENTS_SECRET;
    test.skip(!secret, 'needs FAKE_PAYMENTS_SECRET to sign provider webhooks');
    const stamp = Date.now();
    const pass = `Disputed ${stamp}`;
    const buyer = `Dee Dispute ${stamp}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('25');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/lakeside-open-house');
    await guest.getByLabel(`Quantity — ${pass}`).selectOption('1');
    await guest.getByLabel('Full name').fill(buyer);
    await guest.getByLabel('Email for your tickets').fill(`dee+${stamp}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/checkout\/fake\?/);
    const fake = new URL(guest.url());
    const pi = fake.searchParams.get('pi') ?? '';
    const amount = Number(fake.searchParams.get('amount'));
    const currency = fake.searchParams.get('currency') ?? 'USD';
    const orgId = fake.searchParams.get('org') ?? '';
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);

    // The bank disputes the charge (a signed provider webhook, as Stripe would send).
    const { body, signature } = signFakeDisputeWebhook(secret ?? '', {
      type: 'dispute.created',
      orgId,
      providerPaymentId: pi,
      providerDisputeId: `fakedp_${stamp}`,
      amountMinor: amount,
      currency,
      reason: 'fraudulent',
      evidenceDueBy: '2030-01-01T00:00:00Z',
    });
    const res = await page.request.post('/api/webhooks/fake', {
      data: body,
      headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    });
    expect(res.status()).toBe(200);

    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByRole('link', { name: buyer }).click();
    const disputes = page.getByRole('region', { name: 'Disputes' });
    await expect(disputes.getByText('Open', { exact: true })).toBeVisible();
    await expect(disputes.getByText(/Evidence due/)).toBeVisible();
    await expectAccessible(page);
    const href = await disputes.getByRole('link', { name: 'Evidence packet (PDF)' }).getAttribute('href');
    const packet = await page.request.get(href ?? '');
    expect(packet.status()).toBe(200);
    expect(packet.headers()['content-type']).toMatch(/application\/pdf|text\/html/);
  });
});
