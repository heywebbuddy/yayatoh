import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { catchUpListings } from '@yayatoh/marketplace';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import {
  devPassword,
  expectAccessible,
  makeStaff,
  openTenant,
  signInStaff,
  tenantSite,
  WEB,
  webPage,
  webUser,
} from './helpers.ts';

/**
 * Restoring a terminated org (M1.13d; runbook docs/runbooks/restore-terminated-org.md): admin
 * staff give a reason, type the org's address and confirm it's them; the org gets back the status
 * it had before, its public face and owners' console return, the owners are told, and the access
 * log records it. Every test makes its own org.
 */
test.afterAll(async () => {
  await closePools();
});

const nameOf = (slug: string) => `Test Org ${slug.replace(/^e2e-/, '')}`;

async function publicStatuses(page: Page, slug: string, event: string) {
  const status = async (url: string) => (await page.goto(url))?.status();
  const v1 = await page.request.get(`${WEB}/api/v1/public/events/${event}`);
  return {
    event: await status(`${WEB}/events/${event}`),
    site: await status(`${tenantSite(slug)}/`),
    v1: v1.status(),
  };
}
const ONLINE = { event: 200, site: 200, v1: 200 };
const OFFLINE = { event: 404, site: 404, v1: 404 };

async function terminate(page: Page, slug: string) {
  const section = page.getByRole('region', { name: 'Organization status' });
  const form = section.getByRole('form', { name: 'Terminate this organization' });
  await form.getByLabel('Reason (kept in the audit log)', { exact: true }).fill('e2e: closed by mistake');
  await form.getByLabel(`Type its address (${slug}) to confirm`, { exact: true }).fill(slug);
  await form.getByRole('button', { name: 'Terminate organization' }).click();
  await expect(section.getByText('Status: Terminated')).toBeVisible();
}

test('admin staff restore a terminated org by keyboard: refusals first, then it is back online and the owners are told', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = await webPage(browser);
  const org = await webUser(owner, { org: true, event: true });
  const slug = org.orgSlug ?? '';
  const event = org.eventSlug ?? '';
  const name = nameOf(slug);
  const guest = await webPage(browser);
  expect(await publicStatuses(guest, slug, event)).toEqual(ONLINE);

  await signInStaff(page);
  await openTenant(page, slug, name);
  await expect(page.getByRole('region', { name: 'Restore a terminated organization' })).toHaveCount(0);
  await terminate(page, slug);
  expect(await publicStatuses(guest, slug, event)).toEqual(OFFLINE);

  // The owner's console, in Arabic once: closed, right to left.
  await owner.goto(`/ar/o/${slug}`);
  await expect(owner.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(owner.getByRole('region', { name: 'حالة المؤسسة' })).toContainText('هذه المؤسسة مغلقة');
  await owner.goto(`${WEB}/lang/en`);

  const restore = page.getByRole('region', { name: 'Restore a terminated organization' });
  const form = restore.getByRole('form', { name: 'Restore this organization' });
  await expect(form).toContainText('Puts back the status it had when it was terminated: Active.');
  await expectAccessible(page);

  // Keyboard only. A wrong password is refused and changes nothing.
  const fill = async (password: string, address = slug) => {
    await form.getByLabel('Reason (kept in the audit log)', { exact: true }).focus();
    await page.keyboard.type('e2e: ticket 4711, approved by the owner');
    await page.keyboard.press('Tab');
    await expect(form.getByLabel(`Type its address (${slug}) to confirm`, { exact: true })).toBeFocused();
    await page.keyboard.type(address);
    await page.keyboard.press('Tab');
    await expect(form.getByLabel("Your password (confirm it's you)", { exact: true })).toBeFocused();
    await page.keyboard.type(password);
    await page.keyboard.press('Tab');
    await expect(form.getByRole('button', { name: 'Restore organization' })).toBeFocused();
    await page.keyboard.press('Enter');
  };
  await fill('not-the-password');
  await expect(
    page.getByRole('alert').filter({ hasText: "That password or code isn't right." }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Organization status' }).getByText('Status: Terminated'),
  ).toBeVisible();
  await expectAccessible(page);
  await fill(devPassword(), 'wrong-address');
  await expect(
    page.getByRole('alert').filter({ hasText: "Type the organization's address exactly to confirm." }),
  ).toBeVisible();

  await fill(devPassword());
  await expect(page.getByText(/^Organization restored to the status it had before/)).toBeVisible();
  const section = page.getByRole('region', { name: 'Organization status' });
  await expect(section.getByText('Status: Active')).toBeVisible();
  await expect(
    section.getByRole('list', { name: 'Status history' }).getByRole('listitem').first(),
  ).toContainText('Restored by Omar');
  await expect(page.getByRole('region', { name: 'Restore a terminated organization' })).toHaveCount(0);
  await expectAccessible(page);

  // Its public face and the owner's console come back; the owner is told.
  await expect.poll(() => publicStatuses(guest, slug, event), { timeout: 45_000 }).toEqual(ONLINE);
  const resolved = await resolveOrgSlug(slug);
  if (resolved) await catchUpListings(resolved.orgId);
  await owner.goto(`/o/${slug}`);
  await expect(owner.getByRole('region', { name: 'Organization status' })).toHaveCount(0);
  const drained = await owner.request.post(`${WEB}/api/dev/outbox/drain`, { form: { org: slug } });
  expect(drained.ok(), await drained.text()).toBe(true);
  const mail = await owner.request.get(`${WEB}/api/dev/mailbox?to=${encodeURIComponent(org.email)}`);
  const sent = (await mail.json()) as { subject: string; text: string }[];
  const notice = sent.find((m) => m.subject === `${name} is back online`);
  expect(notice?.text).not.toContain('4711');

  // The platform access log names the restore with the reason.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', {
      name: `staff console: restore organization ${slug}: e2e: ticket 4711, approved by the owner`,
    }),
  ).toBeVisible();
  await owner.close();
  await guest.close();
});

test('support staff see no restore form', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const owner = await webPage(browser);
  const org = await webUser(owner, { org: true });
  const slug = org.orgSlug ?? '';
  const name = nameOf(slug);
  await owner.close();
  await signInStaff(page);
  await openTenant(page, slug, name);
  await terminate(page, slug);

  const support = await (await browser.newContext({ baseURL: page.url().split('/tenants')[0] })).newPage();
  const person = await webUser(support, { signIn: false });
  makeStaff(person.email, 'support');
  await signInStaff(support, person.email);
  await openTenant(support, slug, name);
  const restore = support.getByRole('region', { name: 'Restore a terminated organization' });
  await expect(restore.getByText('Only admins can restore an organization.')).toBeVisible();
  await expect(restore.getByRole('form')).toHaveCount(0);
  await expectAccessible(support);
  await support.close();
});
