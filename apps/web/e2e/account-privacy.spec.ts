import { readFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  ageSession,
  codeForKey,
  devPassword,
  expectAccessible,
  lastEmailedCode,
  newUser,
  ownClientIp,
  passHumanCheck,
  signIn,
  stepUpDialog,
} from './helpers.ts';

/**
 * M1.14e: a person's own data on the account page (download it, delete the account), team
 * invitations in the organizer's privacy requests, and the platform-wide erased-address list
 * (an erased address is skipped on a guest-list import).
 */
const SECURITY = '/account/security';
const stampOf = () => `${test.info().project.name}-${Date.now()}`;

async function confirmWithPassword(page: Page) {
  const dialog = stepUpDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password', { exact: true }).fill(devPassword());
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toHaveCount(0);
}

async function downloadJson(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download the file (JSON)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^yayatoh-account-\d{4}-\d{2}-\d{2}\.json$/);
  return JSON.parse(readFileSync((await download.path()) as string, 'utf8'));
}

test.describe('my data (account page)', () => {
  test('download my data after confirming it’s me; the file holds my account and roles, never secrets', async ({
    page,
  }) => {
    const user = await newUser(page, { join: ['lakeside-events:viewer'], name: `Dana Data ${stampOf()}` });
    await ageSession(page);
    await page.goto(SECURITY);
    const region = page.getByRole('region', { name: 'Your data' });
    await expect(region).toBeVisible();
    await expectAccessible(page);
    await region.getByRole('button', { name: 'Download my data' }).click();
    await confirmWithPassword(page);
    await expect(region.getByText('Your file is ready.')).toBeVisible();
    await expectAccessible(page);
    const doc = await downloadJson(page);
    expect(doc.format).toBe('yayatoh.account/1');
    expect(doc.subject.email).toBe(user.email);
    expect(doc.account.profile.email).toBe(user.email);
    expect(doc.account.signIn.password).toBe(true);
    expect(doc.account.sessions.some((s: { current: boolean }) => s.current)).toBe(true);
    expect(doc.account.securityEvents.map((e: { action: string }) => e.action)).toContain(
      'step_up.confirmed',
    );
    expect(doc.organizations).toEqual([
      expect.objectContaining({ organization: 'Lakeside Events', role: 'viewer' }),
    ]);
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/"token"|\$argon2|backupCodes|secret/i);
  });

  test('keyboard only: download my data', async ({ page }) => {
    await newUser(page);
    await page.goto(SECURITY);
    await page.getByRole('button', { name: 'Download my data' }).focus();
    await page.keyboard.press('Enter');
    const link = page.getByRole('link', { name: 'Download the file (JSON)' });
    await expect(link).toBeVisible();
    await link.focus();
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('the download needs a signed-in, recently confirmed session', async ({ page, browser }) => {
    const anon = await (await browser.newContext()).newPage();
    expect((await anon.request.get('/api/account/export')).status()).toBe(401);
    await anon.close();
    await newUser(page);
    await ageSession(page);
    const res = await page.request.get('/api/account/export');
    expect(res.status()).toBe(403);
    expect(res.headers()['content-disposition']).toBeUndefined();
  });

  test('Arabic: the data and delete sections render right to left', async ({ page }) => {
    await newUser(page);
    await page.goto(`/ar${SECURITY}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'بياناتك' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'حذف حسابك' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'حذف حسابي' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('delete my account', () => {
  test('validation, step-up, deletion, the confirmation email; the old sign-in stops working and signing up again works', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await ownClientIp(context);
    const user = await newUser(page, { join: ['lakeside-events:viewer'], name: 'Lee Leaving' });
    await ageSession(page);
    await page.goto(SECURITY);
    const region = page.getByRole('region', { name: 'Delete your account' });
    const confirm = region.getByLabel(`Type ${user.email} to confirm`, { exact: true });
    const submit = region.getByRole('button', { name: 'Delete my account' });

    await submit.click();
    await expect(region.getByText('Type your email address to confirm.')).toBeVisible();
    await expect(confirm).toHaveAttribute('aria-invalid', 'true');
    await confirm.fill('someone-else@example.test');
    await submit.click();
    await expect(
      region.getByText("That doesn't match. Type your own email address to confirm."),
    ).toBeVisible();
    await expectAccessible(page);

    // Cancelling "Confirm it's you" keeps the account.
    await confirm.fill(user.email.toUpperCase());
    await submit.click();
    await stepUpDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(region.getByText("Please confirm it's you to continue.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${SECURITY}$`));

    await confirm.fill(user.email);
    await submit.click();
    await confirmWithPassword(page);
    await expect(page).toHaveURL(/\/account\/deleted$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Your account was deleted' })).toBeVisible();
    await expectAccessible(page);

    // The confirmation went to the old address.
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(user.email)}`);
        return ((await res.json()) as { subject: string }[]).map((m) => m.subject);
      })
      .toContain('Your Yayatoh account was deleted');

    // Signed out everywhere; the password no longer works.
    await page.goto(SECURITY);
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto('/sign-in');
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(devPassword());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "That email and password don't match." }),
    ).toBeVisible();

    // Coming back: an emailed code creates a new, empty account.
    await page.getByRole('button', { name: 'Use a one-time code instead' }).click();
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    // M1.2f: an emailed code (which can create an account) needs the human check.
    await passHumanCheck(page);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await page.getByLabel('6-digit code', { exact: true }).fill(await lastEmailedCode(page, user.email));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);
    await expect(page.getByText("You're not in an organization yet")).toBeVisible();
  });

  test('the only owner of an organization sees why they can’t delete (no form); a co-owner’s stale form is refused with the organization named', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const owner = await newUser(page, { org: true, twoFactor: true });
    const orgName = `Test Org ${owner.orgSlug?.replace(/^e2e-/, '')}`;
    await page.goto(SECURITY);
    const region = page.getByRole('region', { name: 'Delete your account' });
    await expect(region.getByText("You can't delete your account yet")).toBeVisible();
    await expect(region.getByRole('listitem').filter({ hasText: orgName })).toBeVisible();
    await expect(region.getByRole('button', { name: 'Delete my account' })).toHaveCount(0);
    await expectAccessible(page);

    // A second owner joins: both see the form.
    const other = await openAs(browser, { join: [`${owner.orgSlug}:owner`], twoFactor: true });
    await page.reload();
    await expect(region.getByRole('button', { name: 'Delete my account' })).toBeVisible();
    // The second owner deletes their account first...
    await deleteFromPage(other.page, other.user.email, other.user.setupKey ?? '');
    await expect(other.page).toHaveURL(/\/account\/deleted$/);
    await other.page.close();
    // ...so the first owner's form (still open) is refused, naming the organization.
    await region.getByLabel(`Type ${owner.email} to confirm`, { exact: true }).fill(owner.email);
    await region.getByRole('button', { name: 'Delete my account' }).click();
    await expect(
      region.getByRole('alert').filter({ hasText: "You can't delete your account yet" }),
    ).toContainText(orgName);
    await expect(page).toHaveURL(new RegExp(`${SECURITY}$`));
    await page.reload();
    await expect(region.getByRole('button', { name: 'Delete my account' })).toHaveCount(0);
  });

  test('Arabic: the confirmation page after deleting is right to left', async ({ page }) => {
    await page.goto('/ar/account/deleted');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'تم حذف حسابك' })).toBeVisible();
    await expectAccessible(page);
  });
});

async function openAs(browser: Browser, opts: Parameters<typeof newUser>[1]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const user = await newUser(page, opts);
  return { page, user };
}

/** Delete the signed-in account from its page (fresh session: no step-up dialog). */
async function deleteFromPage(page: Page, email: string, setupKey: string) {
  await page.goto(SECURITY);
  const region = page.getByRole('region', { name: 'Delete your account' });
  await region.getByLabel(`Type ${email} to confirm`, { exact: true }).fill(email);
  await region.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = stepUpDialog(page);
  // The step-up dialog only if the fresh window passed while the test ran. Wait for either
  // outcome: sampling the dialog right after the click missed one that opened a moment later.
  await expect(
    dialog.or(page.getByRole('heading', { level: 1, name: 'Your account was deleted' })),
  ).toBeVisible();
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Code', { exact: true }).fill(codeForKey(setupKey));
    await dialog.getByRole('button', { name: 'Confirm' }).click();
  }
}

test.describe('organizer privacy requests: team invitations and erased addresses', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a pending team invitation is found, exported and removed by an erasure', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const email = `invited+${stampOf()}@example.test`;
    await page.goto('/o/lakeside-events/team');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Role', { exact: true }).selectOption('scanner');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent.')).toBeVisible();

    await page.goto('/o/lakeside-events/privacy');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    const summary = page.getByTestId('dsar-summary');
    await expect(summary.locator('div').filter({ hasText: 'Team invitations' }).locator('dd')).toHaveText(
      '1',
    );
    await page.getByRole('button', { name: 'Export data (JSON)' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download the file' }).click(),
    ]);
    const doc = JSON.parse(readFileSync((await download.path()) as string, 'utf8'));
    expect(doc.teamInvitations).toEqual([
      expect.objectContaining({ email, role: 'scanner', status: 'pending' }),
    ]);
    await page.getByLabel(`Type ${email} to confirm`, { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Erase personal data' }).click();
    await expect(page.getByTestId('dsar-erased')).toBeVisible();
    await page.goto('/o/lakeside-events/team');
    await expect(page.getByRole('listitem').filter({ hasText: email })).toHaveCount(0);
  });

  test('an erased address is skipped on a guest-list import, with the reason shown', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    const stamp = Date.now();
    const email = `erased.${stamp}@example.test`;
    await page.goto('/o/lakeside-events/events/new');
    await page.getByLabel('Event name', { exact: true }).fill(`Erased import ${stamp}`);
    await page.getByLabel('Starts', { exact: true }).fill('2027-11-01T18:00');
    await page.getByLabel('Ends', { exact: true }).fill('2027-11-01T22:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/erased-import-\d+$/);
    const base = new URL(page.url()).pathname;

    const importCsv = async (csv: string) => {
      await page.goto(`${base}/attendees`);
      await page.getByRole('link', { name: 'Import' }).click();
      await page
        .getByLabel('CSV file', { exact: true })
        .setInputFiles({ name: 'guests.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await page.getByRole('button', { name: 'Upload' }).click();
      await page.getByRole('button', { name: 'Check rows' }).click();
    };
    // On the list once, then erased at their request.
    await importCsv(`Name,Email\nEra ${stamp},${email}\n`);
    await page.getByRole('button', { name: 'Import 1 guest' }).click();
    await expect(page.getByRole('region', { name: 'Guest-list import' })).toContainText(/Imported 1 guest/);
    await page.goto('/o/lakeside-events/privacy');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await page.getByLabel(`Type ${email} to confirm`, { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Erase personal data' }).click();
    await expect(page.getByTestId('dsar-erased')).toBeVisible();

    // Importing the address again: skipped with the reason.
    await importCsv(
      `Name,Email\nEra ${stamp},${email.toUpperCase()}\nNew ${stamp},new.${stamp}@example.test\n`,
    );
    await expect(page.getByText("1 ready to import, 1 can't be imported.")).toBeVisible();
    await expect(page.getByText("This person's data was erased at their request · 1")).toBeVisible();
    await expectAccessible(page);
  });
});
