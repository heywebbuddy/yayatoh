import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/**
 * M1.14e: staff handle data-subject requests about Yayatoh accounts (the controller side): find a
 * person by email, export their account data, erase them with a reason. Admin and support only.
 */
const WEB = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
const STAFF = 'omar@yayatoh.test';

function devPassword(): string {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!password) throw new Error('DEV_PERSONA_PASSWORD is not set');
  return password;
}

async function signIn(page: Page, email: string) {
  const n = Math.floor(Math.random() * 0xffffff);
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-forwarded-for': `10.${n >> 16}.${(n >> 8) & 255}.${n & 255}` });
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(devPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/sign-in$/);
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

/** A throwaway web account (the web app's dev endpoint), not signed in anywhere. */
async function webUser(page: Page, opts: { join?: string; org?: boolean; name?: string } = {}) {
  const form = new URLSearchParams({ signIn: '0' });
  if (opts.join) form.set('join', opts.join);
  if (opts.org) form.set('org', 'new');
  if (opts.name) form.set('name', opts.name);
  const res = await page.request.post(`${WEB}/api/dev/user`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { email: string; orgSlug: string | null };
}

async function find(page: Page, email: string) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Find', exact: true }).click();
}

test('staff find a person, export their account data and erase them with a reason; the record keeps no address', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const person = await webUser(page, { join: 'lakeside-events:viewer', name: `Pat Person ${Date.now()}` });
  await signIn(page, STAFF);
  await page.getByRole('link', { name: 'Privacy requests' }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy requests' })).toBeVisible();
  await expectAccessible(page);

  await find(page, 'not-an-email');
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await find(page, `nobody-${Date.now()}@example.test`);
  await expect(page.getByText('Nothing found for this email.')).toBeVisible();

  await find(page, person.email.toUpperCase());
  await expect(page.getByRole('heading', { name: `What Yayatoh holds about ${person.email}` })).toBeVisible();
  await expect(page.getByTestId('person-summary')).toContainText('Pat Person');
  await expect(page.getByRole('listitem').filter({ hasText: 'Lakeside Events · viewer' })).toBeVisible();
  expect(page.url()).not.toContain('example.test');
  await expectAccessible(page);

  // Export: a reason is required, then the JSON file downloads.
  const exportReason = page.getByLabel('Reason for this export', { exact: true });
  await page.getByRole('button', { name: 'Export data (JSON)' }).click();
  await expect(page.getByText('Give a reason of 10 to 500 characters.')).toBeVisible();
  await exportReason.fill('Ticket #501: access request, identity checked');
  await page.getByRole('button', { name: 'Export data (JSON)' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download the file' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^yayatoh-account-\d{4}-\d{2}-\d{2}\.json$/);
  const doc = JSON.parse(readFileSync((await download.path()) as string, 'utf8'));
  expect(doc.format).toBe('yayatoh.account/1');
  expect(doc.account.profile.email).toBe(person.email);
  expect(doc.organizations).toEqual([
    expect.objectContaining({ organization: 'Lakeside Events', role: 'viewer' }),
  ]);
  expect(JSON.stringify(doc)).not.toMatch(/\$argon2|"token"|backupCodes/);

  // Erase: the reason and the typed email are checked.
  const eraseReason = page.getByLabel('Reason for this erasure', { exact: true });
  const confirm = page.getByLabel(`Type ${person.email} to confirm`, { exact: true });
  await eraseReason.fill('Ticket #502: deletion request, identity checked');
  await confirm.fill('someone@example.test');
  await page.getByRole('button', { name: 'Erase this person' }).click();
  await expect(page.getByText("That doesn't match. Type the same email address to confirm.")).toBeVisible();
  await eraseReason.fill('short');
  await confirm.fill(person.email);
  await page.getByRole('button', { name: 'Erase this person' }).click();
  await expect(page.getByText('Give a reason of 10 to 500 characters.')).toBeVisible();
  await eraseReason.fill('Ticket #502: deletion request, identity checked');
  await confirm.fill(person.email);
  await page.getByRole('button', { name: 'Erase this person' }).click();
  await expect(page.getByTestId('person-erased')).toContainText(/Erased\. 1 organization updated/);
  await expectAccessible(page);

  // Nothing is left but the masked record: on the erased list, both requests with the reasons.
  await find(page, person.email);
  await expect(page.getByText('Nothing found for this email.')).toBeVisible();
  await expect(page.getByText(/On the erased-address list since/)).toBeVisible();
  const history = page.getByTestId('person-requests');
  await expect(history).toContainText('Erasure');
  await expect(history).toContainText('Ticket #502: deletion request, identity checked');
  await expect(history).toContainText('Access (export)');

  // The access log names the staff member and a masked address, never the address.
  await page.getByRole('link', { name: 'Access log' }).click();
  const masked = `DSAR lookup ${person.email.slice(0, 1)}•••@example.test`;
  await expect(page.getByRole('cell', { name: `staff console: ${masked}` }).first()).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(person.email);
});

test('keyboard only: find a person', async ({ page }) => {
  const person = await webUser(page, { join: 'lakeside-events:viewer' });
  await signIn(page, STAFF);
  await page.goto('/people');
  await page.getByLabel('Email address', { exact: true }).focus();
  await page.keyboard.type(person.email);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: `What Yayatoh holds about ${person.email}` })).toBeVisible();
  await page.getByLabel('Reason for this export', { exact: true }).focus();
  await page.keyboard.type('Keyboard-only access request');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Download the file' })).toBeVisible();
});

test('the only owner of an organization is not erased; staff see which organization', async ({ page }) => {
  const owner = await webUser(page, { org: true });
  await signIn(page, STAFF);
  await page.goto('/people');
  await find(page, owner.email);
  await page
    .getByLabel('Reason for this erasure', { exact: true })
    .fill('Deletion request by phone, verified');
  await page.getByLabel(`Type ${owner.email} to confirm`, { exact: true }).fill(owner.email);
  await page.getByRole('button', { name: 'Erase this person' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'They are the only owner of these organizations' });
  await expect(alert).toContainText(`Test Org ${owner.orgSlug?.replace(/^e2e-/, '')}`);
  await expectAccessible(page);
  // Nothing changed.
  await find(page, owner.email);
  await expect(page.getByTestId('person-summary')).not.toContainText('No account');
});

test('finance staff get no privacy requests: no nav item and the page is refused', async ({ page }) => {
  const person = await webUser(page);
  execFileSync('node', ['scripts/staff.ts', '--email', person.email, '--role', 'finance'], {
    cwd: fileURLToPath(new URL('../../worker/', import.meta.url)),
    env: process.env,
  });
  await signIn(page, person.email);
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy requests' })).toHaveCount(0);
  await page.goto('/people');
  await expect(page).toHaveURL(/\/not-staff$/);
});
