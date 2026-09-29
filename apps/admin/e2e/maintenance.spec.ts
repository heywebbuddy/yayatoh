import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { adminClient } from '@yayatoh/db/testing';
import {
  devPassword,
  expectAccessible,
  makeStaff,
  replayForm,
  serverForm,
  signInStaff,
  tenantSite,
  WEB,
  webPage,
  webUser,
} from './helpers.ts';

/**
 * Maintenance (M2.5a; runbook docs/runbooks/cutover.md): admin staff start and end the read-only
 * freeze for listed organizations, giving a reason and confirming it's them; the organizer sees the
 * banner at once, their writes are refused, their public pages stay up; every change is in the
 * history and the access log. The freeze is one platform-wide flag: only the desktop project
 * switches it (for its own org, never platform-wide), the others check the page and its refusals.
 */
test.afterAll(async () => {
  await closePools();
});

/** Changes recorded with this reason (a client per call: workers may reuse this file after afterAll). */
async function changesWithReason(reason: string): Promise<number> {
  const db = adminClient();
  try {
    const [r] = await db<
      { n: number }[]
    >`select count(*)::int as n from platform.ops_flag_changes where reason = ${reason}`;
    return r?.n ?? 0;
  } finally {
    await db.end();
  }
}

const START = 'Start or change the read-only freeze';
const END = 'End the read-only freeze';

async function fillStart(page: Page, opts: { orgs: string; reason: string; password: string }) {
  const form = page.getByRole('form', { name: START });
  // Keyboard only, from the organizations field to the button.
  await form.getByLabel('Organization addresses, separated by commas (for listed organizations)').focus();
  await page.keyboard.type(opts.orgs);
  await form.getByLabel('Reason (kept in the change history and the access log)').focus();
  await page.keyboard.type(opts.reason);
  await page.keyboard.press('Tab');
  await expect(form.getByLabel("Your password (confirm it's you)")).toBeFocused();
  await page.keyboard.type(opts.password);
  await page.keyboard.press('Tab');
  await expect(form.getByRole('button', { name: /read-only freeze/ })).toBeFocused();
  await page.keyboard.press('Enter');
}

test('admin staff freeze one organization by keyboard with step-up; the organizer sees it; then end it', async ({
  page,
  browser,
}) => {
  test.skip(test.info().project.name !== 'desktop-1280', 'one project switches the single global flag');
  test.setTimeout(180_000);
  const owner = await webPage(browser);
  const org = await webUser(owner, { org: true, event: true });
  const slug = org.orgSlug ?? '';
  const reason = `e2e: rehearsal R2 ${Date.now()}`;

  await signInStaff(page);
  await page.getByRole('link', { name: 'Maintenance' }).click();
  await expect(page.getByRole('heading', { name: 'Maintenance', level: 1 })).toBeVisible();
  await expectAccessible(page);

  // A wrong password is refused and changes nothing.
  await fillStart(page, { orgs: slug, reason, password: 'not-the-password' });
  await expect(
    page.getByRole('alert').filter({ hasText: "That password or code isn't right." }),
  ).toBeVisible();
  expect(await changesWithReason(reason)).toBe(0);

  await fillStart(page, { orgs: slug, reason, password: devPassword() });
  await expect(page.getByText(/^Read-only freeze is on\./)).toBeVisible();
  const section = page.getByRole('region', { name: 'Read-only freeze' });
  await expect(section.getByRole('list', { name: 'Frozen organizations' })).toContainText(slug);
  await expectAccessible(page);
  // Persisted: still on after a reload, with the change in the history.
  await page.reload();
  await expect(section.getByRole('list', { name: 'Frozen organizations' })).toContainText(slug);
  await expect(page.getByRole('region', { name: 'Change history' })).toContainText(reason);

  // The organizer: banner in the console, a save refused, the public site up.
  await owner.goto(`${WEB}/o/${slug}/venues`);
  await expect(owner.getByRole('region', { name: 'Maintenance' })).toContainText(
    'Scheduled maintenance: changes are paused',
  );
  await owner.getByLabel('Venue name').fill('Frozen Hall');
  await owner.getByLabel('Country code').fill('us');
  await owner.getByRole('button', { name: 'Add venue' }).click();
  await expect(
    owner.getByRole('alert').filter({ hasText: 'Changes are paused during scheduled maintenance.' }),
  ).toBeVisible();
  const site = await owner.goto(`${tenantSite(slug)}/`);
  expect(site?.status()).toBe(200);

  // The access log names it with the reason.
  await page.getByRole('link', { name: 'Access log' }).click();
  await expect(
    page.getByRole('cell', { name: `staff console: read-only freeze 1 org(s): ${reason}` }),
  ).toBeVisible();

  // End it (reason + step-up), by keyboard.
  await page.getByRole('link', { name: 'Maintenance' }).click();
  const end = page.getByRole('form', { name: END });
  await end.getByLabel('Reason (kept in the change history and the access log)').focus();
  await page.keyboard.type(`${reason} done`);
  await page.keyboard.press('Tab');
  await page.keyboard.type(devPassword());
  await page.keyboard.press('Tab');
  await expect(end.getByRole('button', { name: 'End read-only freeze' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Read-only freeze ended. Writes work again.')).toBeVisible();
  await owner.goto(`${WEB}/o/${slug}/venues`);
  await expect(owner.getByRole('region', { name: 'Maintenance' })).toHaveCount(0);
  await owner.close();
});

test('refusals that change nothing: unknown address, unconfirmed platform-wide, and support staff', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const reason = `e2e: refused ${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;
  await signInStaff(page);
  await page.goto('/maintenance');
  await fillStart(page, { orgs: 'no-such-org-e2e', reason, password: devPassword() });
  await expect(
    page.getByRole('alert').filter({ hasText: 'No organization has these addresses: no-such-org-e2e.' }),
  ).toBeVisible();
  await expectAccessible(page);

  const form = page.getByRole('form', { name: START });
  await form.getByRole('radio', { name: 'The whole platform' }).check();
  await form.getByLabel('Reason (kept in the change history and the access log)').fill(reason);
  await form.getByLabel("Your password (confirm it's you)").fill(devPassword());
  await form.getByRole('button', { name: /read-only freeze/ }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Tick the box to confirm a platform-wide freeze.' }),
  ).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Support staff: no link, the page refuses them, and a crafted submission changes nothing.
  const html = await serverForm(page, START);
  const support = await (await browser.newContext({ baseURL: new URL(page.url()).origin })).newPage();
  const person = await webUser(support, { signIn: false });
  makeStaff(person.email, 'support');
  await signInStaff(support, person.email);
  await expect(support.getByRole('link', { name: 'Maintenance' })).toHaveCount(0);
  await support.goto('/maintenance');
  await expect(support).toHaveURL(/\/not-staff$/);
  await replayForm(support, html, {
    scope: 'platform',
    confirmPlatform: 'yes',
    reason,
    password: devPassword(),
  });
  await expect(support).toHaveURL(/\/not-staff$/);
  expect(await changesWithReason(reason)).toBe(0);
  await support.close();
});
