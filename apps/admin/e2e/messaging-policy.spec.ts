import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { devPersonaTotpSecret, secretKey, totp } from '@yayatoh/auth/totp';

/**
 * M3.5a in the staff console: a tenant's complaint rate goes over 0.3 % (120 sends to the fake
 * provider's `complaint@` mailbox), its messaging pauses itself, the organizer sees why, staff see
 * it in the header and lift it with a note; staff set and reset a quota. Keyboard and axe
 * throughout; the organizer's page is also checked in Arabic.
 */
const WEB = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const STAFF = 'omar@yayatoh.test';
const NOT_STAFF = 'pani@lakeside.test';

function devPassword(): string {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!password) throw new Error('DEV_PERSONA_PASSWORD is not set');
  return password;
}

async function signIn(page: Page, email: string, opts: { twoFactor?: boolean } = {}) {
  const n = Math.floor(Math.random() * 0xffffff);
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `10.${n >> 16}.${(n >> 8) & 255}.${n & 255}` });
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(devPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (!opts.twoFactor) return;
  await page
    .getByLabel('6-digit code')
    .fill(totp(secretKey(devPersonaTotpSecret(email, devPassword())), Date.now()));
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

test('a complaint rate over 0.3 % auto-pauses the tenant; staff see it and lift it with a note; quotas', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const tag = `ap${Date.now()}${test.info().project.name.slice(0, 1)}`.toLowerCase();

  // On the web: a new organization sends 120 event updates to addresses that complain.
  const web = await (await browser.newContext({ baseURL: WEB })).newPage();
  const created = await web.request.post('/api/dev/user', { form: { org: 'new', twoFactor: '1' } });
  expect(created.status()).toBe(200);
  const { orgSlug } = (await created.json()) as { orgSlug: string };
  const seed = await web.request.post('/api/dev/messaging', {
    form: { org: orgSlug, action: 'sends', count: '120', local: 'complaint', tag },
  });
  expect(await seed.json()).toEqual({ queued: 120 });
  expect((await web.request.post('/api/dev/outbox/drain', { form: { org: orgSlug } })).ok()).toBe(true);
  await web.goto(`/o/${orgSlug}/messaging`);
  await expect(
    web.getByText(
      /^Messaging is paused: complaints reached [\d.]+% \(\d+ of 120 emails\), above the 0\.3% limit\./,
    ),
  ).toBeVisible();
  const ar = await (
    await browser.newContext({ baseURL: WEB, storageState: await web.context().storageState() })
  ).newPage();
  await ar.goto(`/ar/o/${orgSlug}/messaging`);
  await expect(ar.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(ar.getByText(/المراسلة موقوفة مؤقتًا/)).toBeVisible();

  // Staff: the header counts auto-paused tenants; the list links to the tenant's messaging page.
  await signIn(page, STAFF);
  await page.getByRole('link', { name: /^Auto-paused messaging \(\d+\)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Auto-paused messaging', level: 1 })).toBeVisible();
  await expectAccessible(page);
  const row = page.getByRole('row').filter({ hasText: orgSlug });
  await expect(row).toContainText(/[\d.]+% \(\d+ complaints? in 120 emails\)/);
  await row.getByRole('link').click();
  await expect(page.getByRole('heading', { name: /^Messaging: / })).toBeVisible();
  await expect(page.getByText(/^Auto-paused since/)).toBeVisible();
  await expectAccessible(page);
  // Keyboard: the note, then Enter.
  const note = page.getByLabel('Why lift it (what was reviewed)', { exact: true });
  await note.fill('Reviewed the list with the organizer; bad import removed');
  await note.press('Enter');
  await expect(page.getByText('The auto-pause was lifted. Messaging resumed.')).toBeVisible();
  await expect(page.getByText(/^Not auto-paused \(last lifted/)).toBeVisible();
  await expect(page.getByLabel('Why lift it (what was reviewed)', { exact: true })).toHaveCount(0);

  // The organizer's banner is gone.
  await web.reload();
  await expect(web.getByText(/^Messaging is paused/)).toHaveCount(0);

  // Quotas: set SMS to 100 with a reason, then back to the default.
  const sms = page.getByRole('form', { name: 'SMS (segments) quota' });
  await sms.getByLabel('SMS (segments) monthly limit (default 500)', { exact: true }).fill('100');
  await sms.getByLabel('Reason for the SMS (segments) change', { exact: true }).fill('Trial organizer');
  await sms.getByRole('button', { name: 'Set the SMS (segments) limit' }).click();
  await expect(page.getByText('The quota was saved.')).toBeVisible();
  const quotas = page.getByRole('table', { name: 'Usage against monthly quotas' });
  await expect(quotas.getByRole('row').filter({ hasText: 'SMS (segments)' })).toContainText('100');
  await expectAccessible(page);
  await sms.getByLabel('Reason for the SMS (segments) change', { exact: true }).fill('Back to plan');
  await sms.getByRole('button', { name: 'Reset SMS (segments) to the default' }).click();
  await expect(page.getByText('The quota is back to the default.')).toBeVisible();
  await expect(quotas.getByRole('row').filter({ hasText: 'SMS (segments)' })).toContainText('500 (default)');
  // The access log recorded the cross-tenant read.
  await page.goto('/access-log');
  await expect(
    page.getByRole('cell', { name: 'staff console: auto-paused messaging' }).first(),
  ).toBeVisible();
});

test('an organizer account cannot open auto-paused messaging', async ({ page }) => {
  await signIn(page, NOT_STAFF, { twoFactor: true });
  await expect(page).toHaveURL(/\/not-staff$/);
  await page.goto('/messaging');
  await expect(page).toHaveURL(/\/not-staff$/);
});
