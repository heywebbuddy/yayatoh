import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, OPEN_HOUSE, signIn, WEDDING, WEDDING_OWNER } from './helpers.ts';

interface Captured {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** Deliver the org's pending messages now (what the worker does every 2 s), into the dev mailbox. */
async function drain(page: Page, org = 'lakeside-events') {
  const res = await page.request.post('/api/dev/outbox/drain', { form: { org } });
  expect(res.ok()).toBe(true);
}

async function mailbox(page: Page, to: string): Promise<Captured[]> {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

test.describe('notifications: emails sent and the message log', () => {
  test('a purchase emails the tickets; the buyer and the organizer see it in the order’s message log', async ({
    page,
    browser,
  }) => {
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const pass = `Mailed ${stamp}`;
    const buyer = `Mia Mail ${stamp}`;
    const email = `mia+${stamp}@example.test`;
    await signIn(page);
    await page.goto(`${OPEN_HOUSE}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(pass);
    await page.getByLabel('Price (USD)').fill('12');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto('/events/lakeside-open-house');
    await guest.getByLabel(`Quantity — ${pass}`).selectOption('2');
    await guest.getByLabel('Full name').fill(buyer);
    await guest.getByLabel('Email for your tickets').fill(email);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await guest.getByRole('button', { name: /^Pay/ }).click();
    await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
    const orderUrl = new URL(guest.url()).pathname;

    const emails = guest.getByRole('region', { name: 'Emails sent' });
    await drain(page);
    const [mail] = await mailbox(page, email);
    expect(mail?.subject).toBe('Your tickets for Lakeside Open House');
    expect(mail?.text).toContain(orderUrl);
    expect(mail?.html).toContain('View my tickets');
    // Transactional: no unsubscribe header.
    expect(mail?.headers['List-Unsubscribe']).toBeUndefined();

    await guest.reload();
    await expect(emails.getByText('Tickets', { exact: true })).toBeVisible();
    await expect(emails.getByText('Your tickets for Lakeside Open House')).toBeVisible();
    await expect(emails.getByText(/^Sent /)).toBeVisible();
    await expectAccessible(guest);

    // Arabic, right to left.
    await guest.goto(`/ar${orderUrl}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: 'الرسائل المرسلة' })).toBeVisible();
    await expectAccessible(guest);

    // The organizer's order page logs it with the recipient and status.
    await page.reload();
    await page.getByRole('link', { name: buyer }).click();
    const log = page.getByRole('table', { name: 'Messages' });
    const row = log.getByRole('row').filter({ hasText: 'Your tickets for Lakeside Open House' });
    await expect(row).toContainText(email);
    await expect(row).toContainText('Email');
    await expect(row).toContainText('Sent');
    await expectAccessible(page);
  });

  test('before any delivery, the organizer sees an empty message log', async ({ page }) => {
    // Rosewood: no spec delivers its messages, so a new order stays undelivered.
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    await signIn(page, WEDDING_OWNER);
    await page.goto(`${WEDDING}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill(`Quiet ${stamp}`);
    await page.getByLabel('Price (USD)').fill('20');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: `Quiet ${stamp}` })).toBeVisible();
    const box = page.getByRole('region', { name: 'Box office' });
    await box.getByLabel("Buyer's name").fill(`Quinn ${stamp}`);
    await box.getByLabel(/Buyer's email/).fill(`quinn+${stamp}@example.test`);
    await box.getByLabel(new RegExp(`^Quiet ${stamp}`)).fill('1');
    await box.getByLabel('Paid by').selectOption('zelle');
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Sale recorded. The tickets are on their way.')).toBeVisible();
    await box.getByRole('link', { name: 'Open the order' }).click();
    await expect(page.getByRole('heading', { name: `Order from Quinn ${stamp}` })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Messages' })).toContainText(
      'No messages about this order yet.',
    );
    await expectAccessible(page);
  });
});

test.describe('notifications: one-click unsubscribe', () => {
  test('a guest email carries RFC 8058 headers; the page and the one-click endpoint unsubscribe; tickets still arrive', async ({
    page,
    browser,
  }) => {
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const email = `una.${stamp}@example.test`;
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(`Mailing ${stamp}`);
    await page.getByLabel('Starts', { exact: true }).fill('2027-11-01T18:00');
    await page.getByLabel('Ends', { exact: true }).fill('2027-11-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/mailing-\d+/);
    const base = new URL(page.url()).pathname;
    await page.goto(`${base}/attendees`);
    await page
      .getByText(/^Add (attendee|guest)/i)
      .first()
      .click();
    await page.getByLabel('Full name').fill(`Una ${stamp}`);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('row').filter({ hasText: `Una ${stamp}` })).toBeVisible();
    await page.reload();
    const bulk = page.getByRole('form', { name: 'Bulk actions' });
    await bulk.getByLabel('The 1 matching').check();
    await bulk.getByLabel('Action').selectOption({ label: 'Send email' });
    await bulk.getByLabel('Subject').fill(`Parking ${stamp}`);
    await bulk.getByLabel('Message').fill('Use lot C.');
    await bulk.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('region', { name: 'Email to guests' })).toContainText(/Sent to 1 /);

    await drain(page);
    const [mail] = await mailbox(page, email);
    expect(mail?.subject).toBe(`Parking ${stamp}`);
    expect(mail?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const oneClick = /^<(.+)>$/.exec(mail?.headers['List-Unsubscribe'] ?? '')?.[1] ?? '';
    expect(oneClick).toMatch(/\/api\/unsubscribe\/[0-9a-f-]{36}~[\w-]+$/);
    const pageLink = /href="([^"]+\/unsubscribe\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
    expect(pageLink).toContain('/unsubscribe/');
    expect(mail?.text).toContain(`Unsubscribe: ${pageLink}`);

    // The page (no account): unsubscribe, persisted, then subscribe again.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto(new URL(pageLink).pathname);
    await expect(visitor.getByRole('heading', { name: 'Emails from Lakeside Events' })).toBeVisible();
    await expect(visitor.getByText(/^Address: u•+@example\.test$/)).toBeVisible();
    await expect(
      visitor.getByText('Stop receiving event updates from Lakeside Events at this address?'),
    ).toBeVisible();
    await expectAccessible(visitor);
    await visitor.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(visitor.getByRole('status')).toContainText(
      "You're unsubscribed from event updates from Lakeside Events.",
    );
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Subscribe again' })).toBeVisible();
    await expectAccessible(visitor);
    // Keyboard only: focus the button and press Enter.
    await visitor.getByRole('button', { name: 'Subscribe again' }).focus();
    await visitor.keyboard.press('Enter');
    await expect(visitor.getByRole('button', { name: 'Unsubscribe' })).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Unsubscribe' })).toBeVisible();

    // RFC 8058 one-click, as a mail client would send it (no cookies, no page).
    const bad = await visitor.request.post(new URL(oneClick).pathname, { data: 'nope' });
    expect(bad.status()).toBe(400);
    const res = await visitor.request.post(new URL(oneClick).pathname, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: 'List-Unsubscribe=One-Click',
    });
    expect(res.status()).toBe(200);
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Subscribe again' })).toBeVisible();

    // Arabic, right to left.
    await visitor.goto(`/ar${new URL(pageLink).pathname}`);
    await expect(visitor.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(visitor.getByRole('button', { name: 'الاشتراك مجددًا' })).toBeVisible();
    await expectAccessible(visitor);

    // A forged link is a 404, on the page and the endpoint.
    const forged = new URL(pageLink).pathname.replace(/~[\w-]+$/, '~forged');
    const notFound = await visitor.goto(forged);
    expect(notFound?.status()).toBe(404);
    const forgedPost = await visitor.request.post(new URL(oneClick).pathname.replace(/~[\w-]+$/, '~forged'), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: 'List-Unsubscribe=One-Click',
    });
    expect(forgedPost.status()).toBe(404);
  });
});

test.describe('notifications: dev mailbox', () => {
  test('lists captured messages and filters by recipient', async ({ page }) => {
    await page.goto('/dev/mailbox');
    await expect(page.getByRole('heading', { name: 'Dev mailbox' })).toBeVisible();
    await page.getByLabel('Recipient').fill('nobody-at-all@example.test');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByText('No messages yet')).toBeVisible();
    await expectAccessible(page);
  });
});
