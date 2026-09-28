import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { devPersonaTotpSecret, secretKey, totp } from '@yayatoh/auth/totp';
import { signFakeDisputeWebhook } from '@yayatoh/payments';

const WEB = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const STAFF = 'omar@yayatoh.test';
const NOT_STAFF = 'pani@lakeside.test';

function devPassword(): string {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!password) throw new Error('DEV_PERSONA_PASSWORD is not set');
  return password;
}

/** The seeded owners have two-step verification (M1.2c): their code comes from the dev secret. */
const personaCode = (email: string) =>
  totp(secretKey(devPersonaTotpSecret(email, devPassword())), Date.now());

/**
 * Sign-in is rate limited per client IP (10 a minute); each test acts as its own client, as real
 * staff do, so a run with many sign-ins in a minute is not mistaken for an attack.
 */
async function ownClientIp(page: Page) {
  const n = Math.floor(Math.random() * 0xffffff);
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `10.${n >> 16}.${(n >> 8) & 255}.${n & 255}` });
}

async function signIn(page: Page, email: string, opts: { twoFactor?: boolean } = {}) {
  await ownClientIp(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(devPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (!opts.twoFactor) return;
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await page.getByLabel('6-digit code').fill(personaCode(email));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
}

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))).toEqual(
    [],
  );
}

test('a sign-in with two-step verification asks for the code; a wrong code is refused', async ({ page }) => {
  await signIn(page, NOT_STAFF);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await expectAccessible(page);
  const code = page.getByLabel('6-digit code');
  const right = personaCode(NOT_STAFF);
  await code.fill(right === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "That code didn't work" })).toBeVisible();
  await code.fill(personaCode(NOT_STAFF));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/not-staff$/);
});

test('an organizer account is not staff: no console', async ({ page }) => {
  await signIn(page, NOT_STAFF, { twoFactor: true });
  await expect(page).toHaveURL(/\/not-staff$/);
  await expect(page.getByRole('heading', { name: 'Not a staff account' })).toBeVisible();
  await expectAccessible(page);
});

test('staff pause ticket sales for a tenant; the public page shows it at once; resuming restores sales', async ({
  page,
  browser,
}) => {
  await signIn(page, STAFF);
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Search by name or address').fill('lakeside');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Lakeside Events' }).click();
  await expect(page.getByRole('heading', { name: 'Lakeside Events' })).toBeVisible();
  await expectAccessible(page);

  const sales = page.locator('form').filter({ hasText: 'Ticket sales' });
  // A previous failed run may have left it paused.
  const resume = sales.getByRole('button', { name: 'Resume Ticket sales' });
  if (await resume.isVisible()) {
    await sales.getByLabel('Reason (kept in the audit log)').fill('e2e: reset');
    await resume.click();
  }
  await sales.getByLabel('Reason (kept in the audit log)').fill('e2e: chargeback spike');
  await sales.getByRole('button', { name: 'Pause Ticket sales' }).click();
  await expect(page.getByText("Paused. It applies to the organizer's next request.")).toBeVisible();
  await expect(sales.getByText('Paused', { exact: true })).toBeVisible();

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`${WEB}/events/lakeside-open-house`);
  await expect(guest.getByText('Ticket sales are paused')).toBeVisible();

  await sales.getByLabel('Reason (kept in the audit log)').fill('e2e: resolved');
  await sales.getByRole('button', { name: 'Resume Ticket sales' }).click();
  await expect(page.getByText('Resumed.')).toBeVisible();
  await guest.reload();
  await expect(guest.getByText('Ticket sales are paused')).toHaveCount(0);

  // Every cross-tenant read is in the access log, with who did it.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: 'staff console: search tenants "lakeside"' }).first(),
  ).toBeVisible();
  await expectAccessible(page);
});

test('staff see a tenant dispute and open its evidence packet', async ({ page, browser }) => {
  const secret = process.env.FAKE_PAYMENTS_SECRET;
  test.skip(!secret, 'needs FAKE_PAYMENTS_SECRET to sign provider webhooks');
  const stamp = Date.now();
  // An organizer adds a pass on the web app and a guest buys it.
  const web = await browser.newContext({ baseURL: WEB });
  const org = await web.newPage();
  const login = await org.request.post('/api/dev/login', {
    form: { email: NOT_STAFF, locale: 'en' },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(303);
  await org.goto('/o/lakeside-events/e/lakeside-open-house/tickets-orders');
  await org.getByLabel('Name', { exact: true }).fill(`Staff dispute ${stamp}`);
  await org.getByLabel('Price (USD)').fill('20');
  await org.getByLabel('Quantity available').fill('5');
  await org.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(org.getByRole('row').filter({ hasText: `Staff dispute ${stamp}` })).toBeVisible();
  const guest = await (await browser.newContext({ baseURL: WEB })).newPage();
  await guest.goto('/events/lakeside-open-house');
  await guest.getByLabel(`Quantity — Staff dispute ${stamp}`).selectOption('1');
  await guest.getByLabel('Full name').fill('Stella Staff');
  await guest.getByLabel('Email for your tickets').fill(`stella+${stamp}@example.test`);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(guest).toHaveURL(/\/checkout\/fake\?/);
  const fake = new URL(guest.url());
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\//);
  const { body, signature } = signFakeDisputeWebhook(secret ?? '', {
    type: 'dispute.created',
    orgId: fake.searchParams.get('org') ?? '',
    providerPaymentId: fake.searchParams.get('pi') ?? '',
    providerDisputeId: `fakedp_staff_${stamp}`,
    amountMinor: Number(fake.searchParams.get('amount')),
    currency: fake.searchParams.get('currency') ?? 'USD',
    reason: 'product_not_received',
  });
  const res = await guest.request.post('/api/webhooks/fake', {
    data: body,
    headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
  });
  expect(res.status()).toBe(200);

  await signIn(page, STAFF);
  await page.getByLabel('Search by name or address').fill('lakeside');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Lakeside Events' }).click();
  const disputes = page.getByRole('region', { name: 'Disputes' });
  const item = disputes.getByRole('listitem').filter({ hasText: 'product_not_received' }).first();
  await expect(item).toBeVisible();
  const href = await item.getByRole('link', { name: 'Evidence packet' }).getAttribute('href');
  const packet = await page.request.get(href ?? '');
  expect(packet.status()).toBe(200);
  await expectAccessible(page);
});

const cents = (text: string) => Math.round(Number(text.replace(/[^0-9.-]/g, '')) * 100);

test('staff read the commission report (a fee booked on a sale shows up) and /v1 API usage', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  await signIn(page, STAFF);
  await page.getByRole('link', { name: 'Commission' }).click();
  await expect(page.getByRole('heading', { name: 'Commission', level: 1 })).toBeVisible();
  await expect(page.getByText(/\(UTC\)$/)).toBeVisible();
  const report = page.getByRole('table', { name: 'Commission' });
  const lakesideNet = async () => {
    const row = report.getByRole('row').filter({ hasText: 'lakeside-events' }).filter({ hasText: 'USD' });
    return (await row.count()) ? cents(await row.getByRole('cell').nth(5).innerText()) : 0;
  };
  const before = await lakesideNet();

  // A $1.00 fixed fee on Lakeside's USD sales while the organizer records a box-office sale.
  await page.goto('/?q=lakeside');
  await page.getByRole('link', { name: 'Lakeside Events' }).click();
  const fees = page.locator('form').filter({ has: page.getByLabel('Percent (basis points)') });
  const setFee = async (fixed: string, reason: string) => {
    await fees.getByLabel('Currency').fill('USD');
    await fees.getByLabel('Percent (basis points)').fill('0');
    await fees.getByLabel('Fixed (minor units)').fill(fixed);
    await fees.getByLabel('Reason (kept in the audit log)').fill(reason);
    await fees.getByRole('button', { name: 'Save fee override' }).click();
    await expect(page.getByText('Fee override saved.')).toBeVisible();
  };
  try {
    await setFee('100', 'e2e: commission report');
    const web = await browser.newContext({ baseURL: WEB });
    const org = await web.newPage();
    const login = await org.request.post('/api/dev/login', {
      form: { email: NOT_STAFF, locale: 'en' },
      maxRedirects: 0,
    });
    expect(login.status()).toBe(303);
    await org.goto('/o/lakeside-events/e/lakeside-open-house/tickets-orders');
    await org.getByLabel('Name', { exact: true }).fill(`Commission ${stamp}`);
    await org.getByLabel('Price (USD)').fill('10');
    await org.getByLabel('Quantity available').fill('5');
    await org.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(org.getByRole('row').filter({ hasText: `Commission ${stamp}` })).toBeVisible();
    const box = org.getByRole('region', { name: 'Box office' });
    await box.getByLabel("Buyer's name").fill(`Cora Commission ${stamp}`);
    await box.getByLabel(/Buyer's email/).fill(`cora+${stamp}@example.test`);
    await box.getByLabel(new RegExp(`^Commission ${stamp}`)).fill('2');
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Sale recorded. The tickets are on their way.')).toBeVisible();
    await web.close();
  } finally {
    await page.goto('/?q=lakeside');
    await page.getByRole('link', { name: 'Lakeside Events' }).click();
    await setFee('0', 'e2e: reset after the commission report');
  }

  await page.getByRole('link', { name: 'Commission' }).click();
  await expect(page).toHaveURL(/\/commission$/);
  await expect(page.getByRole('heading', { name: 'Commission', level: 1 })).toBeVisible();
  // Two tickets × $1.00.
  await expect.poll(lakesideNet).toBe(before + 200);
  await expectAccessible(page);

  // A backwards period is refused; a past period is empty.
  await page.getByLabel('From', { exact: true }).fill('2027-02-10');
  await page.getByLabel('To', { exact: true }).fill('2027-02-01');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'end date' })).toHaveText(
    'The end date is before the start date. Showing this month instead.',
  );
  await expect(page.getByLabel('To', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('From', { exact: true }).fill('2020-01-01');
  await page.getByLabel('To', { exact: true }).fill('2020-01-31');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText('No platform fees in this period.')).toBeVisible();
  await expect(page.getByText('2020-01-01 to 2020-01-31 (UTC)')).toBeVisible();
  await expectAccessible(page);

  // The cross-tenant read is audited with its period.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: 'staff console: commission report 2020-01-01 to 2020-01-31' }).first(),
  ).toBeVisible();

  // /v1 app-version telemetry (M1.13c), in the same session: the admin sign-in is rate limited.
  // An app build calls the web's /v1 mount (the same router as api.yayatoh.com).
  const version = `9.${stamp % 100000}.0`;
  const app = await browser.newContext();
  for (let i = 0; i < 2; i++) {
    const res = await app.request.get(`${WEB}/api/v1/mobile/config`, {
      headers: { 'x-yayatoh-client': `android/${version}` },
    });
    expect(res.status()).toBe(200);
  }
  await app.close();
  await page.getByRole('link', { name: 'API usage' }).click();
  await expect(page.getByRole('heading', { name: 'API usage by app version' })).toBeVisible();
  const usage = page.getByRole('row').filter({ hasText: version });
  await expect(async () => {
    await page.reload();
    await expect(usage).toContainText('GET /mobile/config', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(usage).toContainText('android');
  await expect(usage.getByRole('cell').nth(3)).toHaveText('2');
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: 'staff console: read /v1 app-version telemetry' }).first(),
  ).toBeVisible();
});

test('an organizer account cannot open the commission report or the API usage', async ({ page }) => {
  await signIn(page, NOT_STAFF, { twoFactor: true });
  await expect(page).toHaveURL(/\/not-staff$/);
  await page.goto('/commission');
  await expect(page).toHaveURL(/\/not-staff$/);
  await expect(page.getByRole('table', { name: 'Commission' })).toHaveCount(0);
  await page.goto('/api-usage');
  await expect(page).toHaveURL(/\/not-staff$/);
  await expect(page.getByRole('heading', { name: 'API usage by app version' })).toHaveCount(0);
});

test('staff review a messaging report: allowlisted excerpt, a note is required, resolve, closed list, access log', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
  const guestName = `Rex ${stamp}`;
  const email = `rex.${stamp}@example.test`;
  const subject = `Parking ${stamp}`;

  // On the web: an organizer announces to one attendee, who opens the conversation and reports it.
  const web = await (await browser.newContext({ baseURL: WEB })).newPage();
  const login = await web.request.post('/api/dev/login', {
    form: { email: NOT_STAFF, locale: 'en' },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(303);
  await web.goto('/o/lakeside-events/events/new');
  await web.getByLabel('Event name', { exact: true }).fill(`Reported ${stamp}`);
  await web.getByLabel('Starts', { exact: true }).fill('2027-11-01T18:00');
  await web.getByLabel('Ends', { exact: true }).fill('2027-11-01T22:00');
  await web.getByRole('button', { name: 'Create draft' }).click();
  await expect(web).toHaveURL(/\/o\/lakeside-events\/e\/reported-\d+/);
  const base = new URL(web.url()).pathname;
  await web.goto(`${base}/attendees`);
  await web
    .getByText(/^Add (attendee|guest)/i)
    .first()
    .click();
  await web.getByLabel('Full name').fill(guestName);
  await web.getByLabel('Email', { exact: true }).fill(email);
  await web.getByRole('button', { name: 'Add to the list' }).click();
  await expect(web.getByRole('row').filter({ hasText: guestName })).toBeVisible();
  await web.goto(`${base}/marketing`);
  const composer = web.getByRole('form', { name: 'New announcement' });
  await composer.getByLabel('Subject').fill(subject);
  await composer.getByLabel('Message').fill('Lot B is closed.');
  await composer.getByRole('button', { name: 'Preview' }).click();
  await web.getByRole('button', { name: 'Send to 1 person' }).click();
  await expect(web.getByText('Sent to 1 person. Delivery continues in the background.')).toBeVisible();
  expect((await web.request.post('/api/dev/outbox/drain', { form: { org: 'lakeside-events' } })).ok()).toBe(
    true,
  );
  const mails = (await (
    await web.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`)
  ).json()) as {
    html: string;
  }[];
  const replyLink = /href="(https?:\/\/[^"]+\/messages\/[^"]+)"/.exec(mails[0]?.html ?? '')?.[1] ?? '';
  expect(replyLink).toMatch(/\/messages\//);
  const guest = await (await browser.newContext({ baseURL: WEB })).newPage();
  await guest.goto(new URL(replyLink).pathname);
  const theirs = guest.getByRole('region', { name: 'Block or report' });
  await theirs.getByLabel('Reason').selectOption('abuse');
  await theirs.getByLabel('Details (optional)').fill(`Rude ${stamp}`);
  await theirs.getByRole('button', { name: 'Report to Yayatoh' }).click();
  await expect(theirs.getByText('Thanks. Yayatoh will review this conversation.')).toBeVisible();

  // Staff: the open list shows it with the reporter's side, reason, note and an excerpt.
  await signIn(page, STAFF);
  await page.getByRole('link', { name: 'Messaging reports' }).click();
  await expect(page.getByRole('heading', { name: 'Messaging reports' })).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: `Rude ${stamp}` });
  await expect(card.getByRole('heading', { name: 'Lakeside Events · Abuse' })).toBeVisible();
  await expect(card).toContainText('Reported by the contact');
  await expect(card.getByRole('region', { name: 'Conversation excerpt' })).toContainText(subject);
  await expect(card.getByRole('region', { name: 'Conversation excerpt' })).toContainText('Organizer');
  // Allowlisted: the contact's address never appears.
  await expect(card).not.toContainText(email);
  await expectAccessible(page);

  // A note is required.
  await card.getByRole('button', { name: 'Resolve' }).click();
  const again = page.getByRole('article').filter({ hasText: `Rude ${stamp}` });
  await expect(again.getByText('Add a note before resolving or dismissing a report.')).toBeVisible();
  await expect(again.getByLabel('Note (kept in the audit log)')).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page);
  // Keyboard: type the note, Tab to Resolve, Enter.
  await again.getByLabel('Note (kept in the audit log)').fill(`Warned the organizer ${stamp}`);
  await page.keyboard.press('Tab');
  await expect(again.getByRole('button', { name: 'Resolve' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Report resolved.')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: `Rude ${stamp}` })).toHaveCount(0);

  await page.getByRole('link', { name: 'Closed' }).click();
  const closed = page.getByRole('article').filter({ hasText: `Rude ${stamp}` });
  await expect(closed).toContainText('Resolved');
  await expect(closed).toContainText(`Warned the organizer ${stamp}`);
  await expect(closed.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  await expectAccessible(page);

  // Every cross-org read is in the access log.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: 'staff console: messaging reports (open)' }).first(),
  ).toBeVisible();
});

test('an organizer account cannot open messaging reports', async ({ page }) => {
  await signIn(page, NOT_STAFF);
  await expect(page).toHaveURL(/\/not-staff$/);
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/not-staff$/);
  await expect(page.getByRole('heading', { name: 'Messaging reports' })).toHaveCount(0);
});

test('staff see a tenant’s reconciliation differences and resolve one with a note', async ({ page }) => {
  const tag = `staff-${Date.now()}`;
  const day = new Date(Date.UTC(1980, 0, 1) + (Date.now() % 3_000) * 86_400_000).toISOString().slice(0, 10);
  // The nightly reconciliation (dev route on the web app, fake provider) finds a stray movement.
  const run = await page.request.post(`${WEB}/api/dev/payments/reconcile`, {
    form: { org: 'lakeside-events', day, drift: tag, amount: '500' },
  });
  expect(run.status()).toBe(200);
  await signIn(page, STAFF);
  await page.getByLabel('Search by name or address').fill('lakeside');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Lakeside Events' }).click();
  const section = page.getByRole('region', { name: 'Reconciliation' });
  const item = section.getByRole('listitem').filter({ hasText: `order:drift-${tag}` });
  await expect(item.getByText('Not in the ledger')).toBeVisible();
  await expect(item.getByText('Ledger USD 0 · provider USD 500')).toBeVisible();
  await expectAccessible(page);
  await item.getByLabel('Resolution note').fill('Stripe test payment, not a Yayatoh order');
  await item.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('Reconciliation difference resolved.')).toBeVisible();
  await expect(section.getByText(`order:drift-${tag}`)).toHaveCount(0);
});

test('staff act as a member for an hour: reason required, banner everywhere, money, exports and confirmations refused, then end', async ({
  page,
  browser,
}) => {
  // A long journey across both apps (sign-in, a purchase, five pages).
  test.setTimeout(120_000);
  const stamp = Date.now();
  await signIn(page, STAFF);
  await page.getByLabel('Search by name or address').fill('lakeside');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Lakeside Events' }).click();
  await expect(page.getByRole('heading', { name: 'Lakeside Events' })).toBeVisible();
  const tenantUrl = page.url();
  const section = page.getByRole('region', { name: 'Act as a member' });
  await expect(section.getByText(/at most one hour/)).toBeVisible();
  await expectAccessible(page);

  // A blank reason is refused by the server (the owners see the reason).
  const member = section.getByLabel('Member');
  await member.selectOption({ label: 'Pani Digital (pani@lakeside.test) · owner' });
  await section.getByLabel("Reason (shown to the org's owners)").fill('   ');
  await section.getByRole('button', { name: 'Start acting as member' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: "Give a reason: the org's owners see it." }),
  ).toBeVisible();
  await expectAccessible(page);

  // With a reason: signed in on the app host as the member, with the banner.
  await member.selectOption({ label: 'Pani Digital (pani@lakeside.test) · owner' });
  await section.getByLabel("Reason (shown to the org's owners)").fill(`e2e support check ${stamp}`);
  await section.getByRole('button', { name: 'Start acting as member' }).click();
  await expect(page).toHaveURL(`${WEB}/o/lakeside-events`);
  const banner = page.getByRole('region', { name: 'Staff access' });
  await expect(banner).toContainText(
    /You are acting as Pani Digital \(.+, Yayatoh staff\)\. Refunds, payouts, exports and deletions are turned off\. This ends at/,
  );
  await expectAccessible(page);

  // The org's owners are told at once, with the reason (inbox and email; D14).
  const drained = await page.request.post(`${WEB}/api/dev/outbox/drain`, {
    form: { org: 'lakeside-events' },
  });
  expect(drained.ok()).toBe(true);
  const mail = await page.request.get(`${WEB}/api/dev/mailbox?to=${encodeURIComponent(NOT_STAFF)}`);
  const notices = (await mail.json()) as { subject: string; text: string }[];
  expect(
    notices.some(
      (n) =>
        n.subject === 'Yayatoh support is acting as Pani Digital in Lakeside Events' &&
        n.text.includes(`e2e support check ${stamp}`),
    ),
  ).toBe(true);
  await page.goto(`${WEB}/o/lakeside-events/notifications`);
  await expect(
    page
      .getByRole('main')
      .getByRole('link', { name: /^Yayatoh support is acting as Pani Digital until / })
      .first(),
  ).toBeVisible();

  // Allowed work goes through and is audited with the staff member next to the member.
  await page.goto(`${WEB}/o/lakeside-events/e/lakeside-open-house/tickets-orders`);
  await expect(banner).toBeVisible();
  const pass = `Staff pass ${stamp}`;
  await page.getByLabel('Name', { exact: true }).fill(pass);
  await page.getByLabel('Price (USD)').fill('15');
  await page.getByLabel('Quantity available').fill('5');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: pass })).toBeVisible();

  // A guest buys; the staff member can't refund it.
  const guest = await (await browser.newContext({ baseURL: WEB })).newPage();
  await guest.goto('/events/lakeside-open-house');
  await guest.getByLabel(`Quantity — ${pass}`).selectOption('1');
  await guest.getByLabel('Full name').fill(`Ivy Impersonation ${stamp}`);
  await guest.getByLabel('Email for your tickets').fill(`ivy+${stamp}@example.test`);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  await page.reload();
  await page.getByRole('link', { name: `Ivy Impersonation ${stamp}` }).click();
  const refund = page.getByRole('region', { name: 'Refund' });
  await refund.getByLabel('Reason').selectOption('requested_by_customer');
  await refund.getByRole('checkbox').first().check();
  await refund.getByRole('button', { name: 'Refund' }).click();
  const refused =
    "Staff acting as a member can't do this: refunds, payouts, exports, deletions and confirmations are turned off.";
  await expect(refund.getByText(refused)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Refunds' })).toHaveCount(0);
  await expectAccessible(page);

  // Exports are refused too; the activity log names the staff member on the new pass.
  await page.goto(`${WEB}/o/lakeside-events/activity`);
  await expect(page.getByText(/impersonatedBy: staff:/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect(page.getByText(`The export didn’t start: ${refused}`)).toBeVisible();

  // Confirmations can't be given: granting access is refused with the same message.
  await page.goto(`${WEB}/o/lakeside-events/team`);
  await page.getByLabel('Email address').fill(`imp-${stamp}@example.test`);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(refused)).toBeVisible();
  await expect(page.getByRole('dialog', { name: "Confirm it's you" })).toHaveCount(0);

  // The member's own security settings are out of reach, and so are other orgs.
  await page.goto(`${WEB}/account/security`);
  await expect(
    page.getByText("Account security isn't available while Yayatoh staff act as this member."),
  ).toBeVisible();
  expect((await page.goto(`${WEB}/o/harbor-arts`))?.status()).toBe(404);

  // Arabic: the banner renders right to left.
  await page.goto(`${WEB}/ar/o/lakeside-events`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('region', { name: 'وصول الموظفين' })).toContainText(
    'أنت تتصرف بصفة Pani Digital',
  );
  await expectAccessible(page);
  // Back to English (the language choice is remembered in a cookie).
  await page.goto(`${WEB}/lang/en`);

  // End it from the banner with the keyboard: back to the staff console, the session is gone.
  await page.goto(`${WEB}/o/lakeside-events`);
  const end = banner.getByRole('button', { name: 'End acting as Pani Digital' });
  await end.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${tenantUrl}?done=impersonation_ended`);
  await expect(page.getByText('Acting as the member ended.')).toBeVisible();
  const history = page.getByRole('list', { name: 'Recent staff access' });
  await expect(history.getByRole('listitem').filter({ hasText: `e2e support check ${stamp}` })).toContainText(
    'Ended',
  );
  await expectAccessible(page);
  const after = await page.request.get(`${WEB}/o/lakeside-events`, { maxRedirects: 0 });
  expect(after.status()).toBe(307);
});

test('an open impersonation can be ended from the staff console too', async ({ page }) => {
  const stamp = Date.now();
  await signIn(page, STAFF);
  await page.getByLabel('Search by name or address').fill('lakeside');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Lakeside Events' }).click();
  await expect(page.getByRole('heading', { name: 'Lakeside Events' })).toBeVisible();
  const tenantUrl = page.url();
  const section = page.getByRole('region', { name: 'Act as a member' });
  await section.getByLabel('Member').selectOption({ label: 'Jordan Lee (jordan@lakeside.test) · viewer' });
  await section.getByLabel("Reason (shown to the org's owners)").fill(`e2e console end ${stamp}`);
  await section.getByRole('button', { name: 'Start acting as member' }).click();
  await expect(page).toHaveURL(`${WEB}/o/lakeside-events`);
  await expect(page.getByRole('region', { name: 'Staff access' })).toContainText('Jordan Lee');
  await page.goto(tenantUrl);
  const entry = page
    .getByRole('list', { name: 'Recent staff access' })
    .getByRole('listitem')
    .filter({ hasText: `e2e console end ${stamp}` });
  await expect(entry).toContainText('Active');
  await entry.getByRole('button', { name: 'End acting as Jordan Lee' }).click();
  await expect(page.getByText('Acting as the member ended.')).toBeVisible();
  await expect(entry).toContainText('Ended');
  // The web session made for it no longer works.
  const after = await page.request.get(`${WEB}/o/lakeside-events`, { maxRedirects: 0 });
  expect(after.status()).toBe(307);
});
