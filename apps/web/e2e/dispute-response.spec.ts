import { expect, test } from '@playwright/test';
import { signFakeDisputeWebhook } from '@yayatoh/payments';
import { continueToPayment, expectAccessible, OPEN_HOUSE, pickOption, signIn } from './helpers.ts';

/**
 * Responding to a dispute (M1.6e): the organizer reviews the evidence packet (order, tickets, the
 * door's access log, messages, refund policy), writes a statement, leaves a section out, and
 * submits it through the payment port once they confirm they read it.
 */
test.describe('dispute response (M1.6e)', () => {
  test('build, review, edit and submit an evidence packet', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const secret = process.env.FAKE_PAYMENTS_SECRET;
    test.skip(!secret, 'needs FAKE_PAYMENTS_SECRET to sign provider webhooks');
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Contested ${stamp}`;
    const buyer = `Cleo Chargeback ${stamp}`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('35');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/lakeside-open-house');
    await pickOption(guest.getByLabel(`Quantity — ${pass}`), '1');
    await guest.getByLabel('Full name').fill(buyer);
    await guest.getByLabel('Email for your tickets').fill(`cleo+${stamp}@example.test`);
    await continueToPayment(guest, `cleo+${stamp}@example.test`);
    await expect(guest).toHaveURL(/\/checkout\/fake\?/);
    const fake = new URL(guest.url());
    const pi = fake.searchParams.get('pi') ?? '';
    const amount = Number(fake.searchParams.get('amount'));
    const orgId = fake.searchParams.get('org') ?? '';
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);

    const { body, signature } = signFakeDisputeWebhook(secret ?? '', {
      type: 'dispute.created',
      orgId,
      providerPaymentId: pi,
      providerDisputeId: `fakedp_resp_${stamp}`,
      amountMinor: amount,
      currency: 'USD',
      reason: 'product_not_received',
      evidenceDueBy: '2030-01-01T00:00:00Z',
    });
    const res = await page.request.post('/api/webhooks/fake', {
      data: body,
      headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    });
    expect(res.status()).toBe(200);

    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByRole('link', { name: buyer }).click();
    await expect(page.getByRole('heading', { name: `Order from ${buyer}` })).toBeVisible();
    const orderUrl = page.url();
    await page
      .getByRole('region', { name: 'Disputes' })
      .getByRole('link', { name: 'Review and respond' })
      .click();
    await expect(page.getByRole('heading', { name: 'Respond to a dispute', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/disputes\/[0-9a-f-]{36}$/);
    const reviewUrl = page.url();

    // The packet preview: what will be sent, in English.
    const preview = page.getByRole('article', { name: 'Evidence packet' });
    await expect(preview).toHaveAttribute('lang', 'en');
    for (const heading of ['Dispute', 'Order', 'Access log (door scans)', 'Messages sent to the buyer'])
      await expect(preview.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(preview.getByText('No door scans were recorded for these tickets.')).toBeVisible();
    await expectAccessible(page);

    // Submitting needs the confirmation, and a real statement.
    const form = page.getByRole('region', { name: 'Your response' });
    await form.getByLabel('Your statement').fill('Too short');
    await form.getByRole('button', { name: 'Submit evidence' }).click();
    await expect(
      form.getByText('Confirm that you read the evidence packet before submitting.'),
    ).toBeVisible();
    await form.getByLabel('Your statement').fill('Too short');
    await form.getByLabel('I read the evidence packet below and it is accurate.').check();
    await form.getByRole('button', { name: 'Submit evidence' }).click();
    await expect(form.getByText('Write a statement of at least 10 characters.')).toBeVisible();

    // Save a draft without the messages section, keyboard only.
    const statement = `The buyer ${buyer} received their ticket by email at purchase and never asked for a refund.`;
    await form.getByLabel('Your statement').focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(statement);
    await form.getByLabel('Messages sent to the buyer').focus();
    await page.keyboard.press('Space');
    await form.getByRole('button', { name: 'Save draft' }).focus();
    await page.keyboard.press('Enter');
    await expect(form.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(form.getByLabel('Your statement')).toHaveValue(statement);
    await expect(form.getByLabel('Messages sent to the buyer')).not.toBeChecked();
    await expect(preview.getByRole('heading', { name: 'Statement from the seller' })).toBeVisible();
    await expect(preview.getByText(statement)).toBeVisible();
    await expect(
      preview.getByRole('heading', { name: 'Messages sent to the buyer', exact: true }),
    ).toHaveCount(0);

    // The downloadable packet is the same document.
    const href = await page.getByRole('link', { name: 'Evidence packet (PDF)' }).getAttribute('href');
    const packet = await page.request.get(href ?? '');
    expect(packet.status()).toBe(200);
    expect(packet.headers()['content-type']).toMatch(/application\/pdf|text\/html/);

    // Submit.
    await form.getByLabel('I read the evidence packet below and it is accurate.').check();
    await form.getByRole('button', { name: 'Submit evidence' }).click();
    await expect(page.getByText(/^Evidence submitted on /)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your response' })).toHaveCount(0);
    await page.goto(orderUrl);
    const disputes = page.getByRole('region', { name: 'Disputes' });
    await expect(disputes.getByText('Evidence submitted', { exact: true }).first()).toBeVisible();
    await expect(disputes.getByRole('link', { name: 'Review and respond' })).toHaveCount(0);

    // Finance can open the review; viewers cannot.
    await signIn(page, 'fran@lakeside.test');
    await page.goto(reviewUrl);
    await expect(page.getByRole('heading', { name: 'Respond to a dispute', level: 1 })).toBeVisible();
    await page.goto(reviewUrl.replace('/o/', '/ar/o/'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الرد على نزاع', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await signIn(page, 'jordan@lakeside.test');
    const denied = await page.goto(reviewUrl);
    expect(denied?.status()).toBe(404);
  });
});
