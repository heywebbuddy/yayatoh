import { expect, test } from '@playwright/test';
import {
  expectAccessible,
  makeStaff,
  signInStaff,
  WEB,
  webPage,
  webUser,
  withOpenSignupLock,
} from './helpers.ts';

/** The open-signup switch (M3.11a): off until launch; admins flip it, audited; nobody else can. */
test('an admin opens self-serve signup (confirmation and reason required) and closes it again; the web follows', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  await withOpenSignupLock(async () => {
    await signInStaff(page);
    await page
      .getByRole('navigation', { name: 'Staff console' })
      .getByRole('link', { name: 'Open signup' })
      .click();
    await expect(page).toHaveURL(/\/open-signup$/);
    await expect(page.getByRole('heading', { name: 'Open signup', level: 1 })).toBeVisible();
    await expect(page.getByText('Closed: signup codes only')).toBeVisible();
    await expectAccessible(page);

    const web = await webPage(browser);
    await web.goto(`${WEB}/signup`);
    await expect(web.getByRole('heading', { name: 'Self-serve signup is coming soon' })).toBeVisible();

    // Opening needs the confirmation box.
    await page.getByLabel('Reason').fill(`Launch rehearsal ${stamp}`);
    await page.getByRole('button', { name: 'Open signup' }).click();
    await expect(page.getByText('Tick the box to confirm opening signup.')).toBeVisible();
    await expect(page.getByText('Closed: signup codes only')).toBeVisible();
    await expectAccessible(page);

    // Keyboard only: reason, confirmation, submit.
    await page.getByLabel('Reason').focus();
    await page.keyboard.type(`Launch rehearsal ${stamp}`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Signup is open.')).toBeVisible();
    await expect(page.getByText('Open: anyone can sign up')).toBeVisible();
    const opened = page.getByRole('row').filter({ hasText: `Launch rehearsal ${stamp}` });
    await expect(opened).toContainText('Opened');
    await expect(opened).toContainText('Omar');
    await expectAccessible(page);

    // The public signup page offers self-serve signup at once.
    await web.reload();
    await expect(web.getByText('Create your organizer account and your organization')).toBeVisible();
    await expect(web.getByRole('link', { name: 'Continue with email' })).toBeVisible();

    // Close it again (a reason, no confirmation needed).
    await page.getByLabel('Reason').fill(`Rehearsal over ${stamp}`);
    await page.getByRole('button', { name: 'Close signup' }).click();
    await expect(page.getByText('Signup is closed.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `Rehearsal over ${stamp}` })).toContainText(
      'Closed',
    );
    await web.reload();
    await expect(web.getByRole('heading', { name: 'Self-serve signup is coming soon' })).toBeVisible();
    await web.close();

    // Both changes are in the access log with the reason.
    await page
      .getByRole('navigation', { name: 'Staff console' })
      .getByRole('link', { name: 'Access log' })
      .click();
    await expect(
      page.getByRole('cell', { name: `staff console: open self-serve signup: Launch rehearsal ${stamp}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: `staff console: close self-serve signup: Rehearsal over ${stamp}` }),
    ).toBeVisible();
  });
});

test('support staff and non-staff accounts can neither see nor flip the switch', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const web = await webPage(browser);
  const support = await webUser(web, { signIn: false });
  const organizer = await webUser(web, { signIn: false });
  await web.close();
  makeStaff(support.email, 'support');

  await signInStaff(page, support.email);
  const nav = page.getByRole('navigation', { name: 'Staff console' });
  await expect(nav.getByRole('link', { name: 'Tenants' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Open signup' })).toHaveCount(0);
  await page.goto('/open-signup');
  await expect(page).toHaveURL(/\/not-staff$/);
  await expect(page.getByRole('button', { name: 'Open signup' })).toHaveCount(0);

  const other = await (await browser.newContext({ baseURL: page.url().split('/not-staff')[0] })).newPage();
  await signInStaff(other, organizer.email);
  await other.goto('/open-signup');
  await expect(other).toHaveURL(/\/not-staff$/);
  await expect(other.getByRole('heading', { name: 'Not a staff account' })).toBeVisible();
  await expectAccessible(other);
  await other.close();
});
