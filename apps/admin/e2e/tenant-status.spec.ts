import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { catchUpListings } from '@yayatoh/marketplace';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import {
  expectAccessible,
  MARKET,
  makeStaff,
  openTenant,
  replayForm,
  serverForm,
  signInStaff,
  tenantSite,
  WEB,
  webPage,
  webUser,
} from './helpers.ts';

/**
 * Tenant status (M1.3f): staff suspend, reactivate and terminate an org from its console page;
 * its public face goes offline and comes back; its members see a read-only console; checkout is
 * refused with a clear message; the owners are told. Every test makes its own org.
 */
test.afterAll(async () => {
  await closePools();
});

const nameOf = (slug: string) => `Test Org ${slug.replace(/^e2e-/, '')}`;

/** No worker runs under e2e: apply the org's outbox to the listings projector as it would. */
async function runProjector(slug: string) {
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  await catchUpListings(org.orgId);
}

/** HTTP status of each public address of the org and its event, through a real browser page. */
async function publicStatuses(page: Page, slug: string, event: string) {
  const status = async (url: string) => (await page.goto(url))?.status();
  const v1 = await page.request.get(`${WEB}/api/v1/public/events/${event}`);
  return {
    event: await status(`${WEB}/events/${event}`),
    organizer: await status(`${MARKET}/o/${slug}`),
    site: await status(`${tenantSite(slug)}/`),
    siteEvent: await status(`${tenantSite(slug)}/events/${event}`),
    widget: await status(`${WEB}/embed/${event}`),
    v1: v1.status(),
  };
}
const ONLINE = { event: 200, organizer: 200, site: 200, siteEvent: 200, widget: 200, v1: 200 };
const OFFLINE = { event: 404, organizer: 404, site: 404, siteEvent: 404, widget: 404, v1: 404 };

/** The event's name (the dev route names it after its slug's stamp). */
const eventName = (event: string) => `Test Show ${event.replace(/^test-show-/, '')}`;

/** How many times the marketplace search lists the event (cached; revalidated on each change). */
async function listed(page: Page, event: string) {
  await page.goto(`${MARKET}/events?q=${encodeURIComponent(eventName(event))}`);
  return page.getByRole('link', { name: eventName(event), exact: true }).count();
}

test('staff suspend an org: public pages 404 (noindex), listing gone, checkout refused, console read-only, owners told; reactivating brings it all back', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  // The organizer: a fresh org with a published, listed event.
  const owner = await webPage(browser);
  const org = await webUser(owner, { org: true, event: true });
  const slug = org.orgSlug ?? '';
  const event = org.eventSlug ?? '';
  const name = nameOf(slug);
  const guest = await webPage(browser);
  expect(await publicStatuses(guest, slug, event)).toEqual(ONLINE);
  await expect.poll(() => listed(guest, event)).toBe(1);

  // A buyer opens the event page before anything happens.
  const buyer = await webPage(browser);
  await buyer.goto(`/events/${event}`);
  await buyer.getByLabel('Quantity — Free entry', { exact: true }).selectOption('1');
  await buyer.getByLabel('Full name', { exact: true }).fill('Bea Buyer');
  await buyer.getByLabel('Email for your tickets', { exact: true }).fill(`bea+${slug}@example.test`);

  await signInStaff(page);
  await openTenant(page, slug, name);
  const section = page.getByRole('region', { name: 'Organization status' });
  await expect(section.getByText('Status: Active')).toBeVisible();
  await expect(section.getByRole('list', { name: 'Status history' })).toHaveCount(0);
  await expect(section.getByText('No status changes yet.')).toBeVisible();
  await expectAccessible(page);

  // Validation: a blank reason, then a missing confirmation, are refused by the server.
  const suspend = section.getByRole('form', { name: 'Suspend this organization' });
  await suspend.getByLabel('Reason (kept in the audit log)', { exact: true }).fill('   ');
  await suspend.getByRole('button', { name: 'Suspend organization' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Give a reason of at least 3 characters' }),
  ).toBeVisible();
  await expectAccessible(page);
  await suspend.getByLabel('Reason (kept in the audit log)', { exact: true }).fill('e2e: chargeback review');
  await suspend.getByRole('button', { name: 'Suspend organization' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Tick the box to confirm.' })).toBeVisible();
  await expect(section.getByText('Status: Active')).toBeVisible();

  await suspend.getByLabel('Reason (kept in the audit log)', { exact: true }).fill('e2e: chargeback review');
  await suspend
    .getByLabel('I understand its public pages go offline and its console becomes read-only.', {
      exact: true,
    })
    .check();
  await suspend.getByRole('button', { name: 'Suspend organization' }).click();
  await expect(
    page.getByText('Suspended. Its public pages and ticket sales are offline and its console is read-only.'),
  ).toBeVisible();
  await expect(section.getByText('Status: Suspended')).toBeVisible();
  await expect(
    section.getByRole('list', { name: 'Status history' }).getByRole('listitem').first(),
  ).toContainText('Suspended by Omar');
  await expect(
    section.getByRole('list', { name: 'Status history' }).getByRole('listitem').first(),
  ).toContainText('“e2e: chargeback review”');
  await expect(section.getByRole('form', { name: 'Suspend this organization' })).toHaveCount(0);
  await expectAccessible(page);
  // Keep the reactivate form as the console showed it, for the termination test below.
  const reactivateForm = await serverForm(page, 'Reactivate this organization');
  expect(reactivateForm).toContain('Reactivate organization');

  // The buyer's checkout on the page opened earlier is refused, with a clear message.
  await buyer.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(
    buyer.getByText("This organizer isn't selling tickets right now. Tickets already bought stay valid."),
  ).toBeVisible();

  // Every public address is gone at once, as a 404 that search engines don't index.
  expect(await publicStatuses(guest, slug, event)).toEqual(OFFLINE);
  // (Dev hosts are never indexed anyway: check on the marketplace host.)
  expect((await guest.goto(`${MARKET}/events/${event}`))?.status()).toBe(404);
  await expect(guest.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
  expect(await listed(guest, event)).toBe(0);
  // The projector drops the listings too; the marketplace still doesn't show it.
  await runProjector(slug);
  expect(await listed(guest, event)).toBe(0);

  // The owner: a read-only console with a banner, writes refused, and a notice (inbox + email).
  await owner.goto(`/o/${slug}/settings`);
  const banner = owner.getByRole('region', { name: 'Organization status' });
  await expect(banner).toContainText('This organization is suspended');
  await expect(banner).toContainText('the console is read-only');
  await expect(banner).not.toContainText('chargeback');
  await expectAccessible(owner);
  const brand = owner.getByRole('region', { name: 'Brand' });
  await brand.getByLabel('Brand colour', { exact: true }).fill('#1a6b5c');
  await brand.getByRole('button', { name: 'Save' }).click();
  await expect(brand.getByText("That can't be done right now.")).toBeVisible();
  const drained = await owner.request.post(`${WEB}/api/dev/outbox/drain`, { form: { org: slug } });
  expect(drained.ok(), await drained.text()).toBe(true);
  const mail = await owner.request.get(`${WEB}/api/dev/mailbox?to=${encodeURIComponent(org.email)}`);
  const sent = (await mail.json()) as { subject: string; text: string }[];
  const notice = sent.find((m) => m.subject === `Yayatoh suspended ${name}`);
  expect(notice?.text).toContain('Tickets already sold stay valid');
  expect(notice?.text).not.toContain('chargeback');
  await owner.goto(`/o/${slug}/notifications`);
  await expect(
    owner
      .getByRole('main')
      .getByRole('link', { name: /^Yayatoh suspended this organization/ })
      .first(),
  ).toBeVisible();
  // Arabic: the banner reads right to left.
  await owner.goto(`/ar/o/${slug}`);
  await expect(owner.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(owner.getByRole('region', { name: 'حالة المؤسسة' })).toContainText('هذه المؤسسة معلّقة');
  await expectAccessible(owner);
  await owner.goto(`${WEB}/lang/en`);

  // Reactivate with the keyboard only.
  const reactivate = section.getByRole('form', { name: 'Reactivate this organization' });
  await reactivate.getByLabel('Reason (kept in the audit log)', { exact: true }).focus();
  await page.keyboard.type('e2e: review cleared');
  await page.keyboard.press('Tab');
  await expect(
    reactivate.getByLabel('I understand its public pages and checkout come back.', { exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(reactivate.getByRole('button', { name: 'Reactivate organization' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Reactivated. Its public pages, listings and ticket sales are back.'),
  ).toBeVisible();
  await expect(section.getByText('Status: Active')).toBeVisible();
  await page.reload();
  await expect(section.getByText('Status: Active')).toBeVisible();
  await expect(section.getByRole('list', { name: 'Status history' }).getByRole('listitem')).toHaveCount(2);

  // Tenant hosts are resolved through a 30 s in-process cache in the proxy (M1.11): poll.
  await expect.poll(() => publicStatuses(guest, slug, event), { timeout: 45_000 }).toEqual(ONLINE);
  await runProjector(slug);
  await expect.poll(() => listed(guest, event)).toBe(1);
  await owner.goto(`/o/${slug}`);
  await expect(owner.getByRole('region', { name: 'Organization status' })).toHaveCount(0);

  // Both changes are in the platform access log with the staff member and the reason.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: `staff console: suspend organization ${slug}: e2e: chargeback review` }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: `staff console: reactivate organization ${slug}: e2e: review cleared` }),
  ).toBeVisible();

  // Terminating: the address must be typed; afterwards there is no way back from the console,
  // and a replayed "Reactivate" is refused.
  await openTenant(page, slug, name);
  const terminate = section.getByRole('form', { name: 'Terminate this organization' });
  await terminate
    .getByLabel('Reason (kept in the audit log)', { exact: true })
    .fill('e2e: closed on request');
  await terminate.getByLabel(`Type its address (${slug}) to confirm`, { exact: true }).fill('wrong-address');
  await terminate.getByRole('button', { name: 'Terminate organization' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: "Type the organization's address exactly to confirm." }),
  ).toBeVisible();
  await expect(section.getByText('Status: Active')).toBeVisible();
  await terminate
    .getByLabel('Reason (kept in the audit log)', { exact: true })
    .fill('e2e: closed on request');
  await terminate
    .getByLabel(`Type its address (${slug}) to confirm`, { exact: true })
    .fill(slug.toUpperCase());
  await terminate.getByRole('button', { name: 'Terminate organization' }).click();
  await expect(page.getByText(/^Terminated\. Its public pages are offline for good/)).toBeVisible();
  await expect(section.getByText('Status: Terminated')).toBeVisible();
  await expect(section.getByRole('form')).toHaveCount(0);
  await expect(
    section.getByText("Terminated organizations can't be reactivated from the console."),
  ).toBeVisible();
  await expectAccessible(page);
  await replayForm(page, reactivateForm, { reason: 'e2e: replayed', confirm: 'yes' });
  await expect(
    page.getByRole('alert').filter({ hasText: "That didn't work (invalid_state)." }),
  ).toBeVisible();
  await expect(section.getByText('Status: Terminated')).toBeVisible();
  expect(await publicStatuses(guest, slug, event)).toEqual(OFFLINE);

  // Acting as a member of a closed org is refused.
  const act = page.getByRole('region', { name: 'Act as a member' });
  await act.getByLabel('Member', { exact: true }).selectOption({ index: 1 });
  await act.getByLabel("Reason (shown to the org's owners)", { exact: true }).fill('e2e: look around');
  await act.getByRole('button', { name: 'Start acting as member' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: "That didn't work (invalid_state)." }),
  ).toBeVisible();

  // Owners keep a read-only console to take their data out; the notice says it is closed.
  await owner.goto(`/o/${slug}/activity`);
  await expect(owner.getByRole('region', { name: 'Organization status' })).toContainText(
    'This organization is closed',
  );
  await expect(owner.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await expectAccessible(owner);
  await owner.close();
  await guest.close();
  await buyer.close();
});

test('members other than owners lose a closed org; a suspended org can still be looked into by staff acting as a member', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const owner = await webPage(browser);
  const org = await webUser(owner, { org: true });
  const slug = org.orgSlug ?? '';
  const name = nameOf(slug);
  const viewer = await webPage(browser);
  await webUser(viewer, { join: `${slug}:viewer` });
  expect((await viewer.goto(`/o/${slug}`))?.status()).toBe(200);

  await signInStaff(page);
  await openTenant(page, slug, name);
  const section = page.getByRole('region', { name: 'Organization status' });
  const suspend = section.getByRole('form', { name: 'Suspend this organization' });
  await suspend.getByLabel('Reason (kept in the audit log)', { exact: true }).fill('e2e: look into it');
  await suspend
    .getByLabel('I understand its public pages go offline and its console becomes read-only.', {
      exact: true,
    })
    .check();
  await suspend.getByRole('button', { name: 'Suspend organization' }).click();
  await expect(section.getByText('Status: Suspended')).toBeVisible();

  // Staff may still act as a member of a suspended org (read-only for them too).
  const tenantUrl = page.url().split('?')[0] ?? '';
  const act = page.getByRole('region', { name: 'Act as a member' });
  await act.getByLabel('Member', { exact: true }).selectOption({ index: 1 });
  await act.getByLabel("Reason (shown to the org's owners)", { exact: true }).fill('e2e: why suspended');
  await act.getByRole('button', { name: 'Start acting as member' }).click();
  await expect(page).toHaveURL(`${WEB}/o/${slug}`);
  await expect(page.getByRole('region', { name: 'Staff access' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Organization status' })).toContainText(
    'This organization is suspended',
  );
  await expectAccessible(page);
  await page
    .getByRole('region', { name: 'Staff access' })
    .getByRole('button', { name: /^End acting as/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`${tenantUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  // The viewer keeps a read-only console while suspended...
  await viewer.goto(`/o/${slug}`);
  await expect(viewer.getByRole('region', { name: 'Organization status' })).toContainText(
    'This organization is suspended',
  );

  // ...and loses it once the org is closed; the owner keeps it.
  await page.goto(tenantUrl);
  const terminate = section.getByRole('form', { name: 'Terminate this organization' });
  await terminate.getByLabel('Reason (kept in the audit log)', { exact: true }).fill('e2e: closed');
  await terminate.getByLabel(`Type its address (${slug}) to confirm`, { exact: true }).fill(slug);
  await terminate.getByRole('button', { name: 'Terminate organization' }).click();
  await expect(section.getByText('Status: Terminated')).toBeVisible();
  expect((await viewer.goto(`/o/${slug}`))?.status()).toBe(404);
  expect((await owner.goto(`/o/${slug}`))?.status()).toBe(200);
  await expect(owner.getByRole('region', { name: 'Organization status' })).toContainText(
    'As an owner you can still open it and download your data',
  );
  await owner.close();
  await viewer.close();
});

test('only admins change an org’s status: support staff see no controls and a replayed form is refused', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const owner = await webPage(browser);
  const org = await webUser(owner, { org: true });
  const slug = org.orgSlug ?? '';
  const name = nameOf(slug);
  await owner.close();
  // An admin's view of the form, to replay as support.
  await signInStaff(page);
  await openTenant(page, slug, name);
  const html = await serverForm(page, 'Suspend this organization');

  const support = await (await browser.newContext({ baseURL: page.url().split('/tenants')[0] })).newPage();
  const person = await webUser(support, { signIn: false });
  makeStaff(person.email, 'support');
  await signInStaff(support, person.email);
  await openTenant(support, slug, name);
  const section = support.getByRole('region', { name: 'Organization status' });
  await expect(section.getByText('Status: Active')).toBeVisible();
  await expect(section.getByText("Only admins can change an organization's status.")).toBeVisible();
  await expect(section.getByRole('form')).toHaveCount(0);
  await expectAccessible(support);
  await replayForm(support, html, { reason: 'e2e: support tries', confirm: 'yes' });
  await expect(support).toHaveURL(/\/not-staff$/);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Organization status' }).getByText('Status: Active'),
  ).toBeVisible();
  await support.close();
});
