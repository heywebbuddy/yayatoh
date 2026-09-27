import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signFakeDisputeWebhook } from '@yayatoh/payments';

const WEB = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const STAFF = 'omar@yayatoh.test';
const NOT_STAFF = 'pani@lakeside.test';

async function signIn(page: Page, email: string) {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!password) throw new Error('DEV_PERSONA_PASSWORD is not set');
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
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

test('an organizer account is not staff: no console', async ({ page }) => {
  await signIn(page, NOT_STAFF);
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
