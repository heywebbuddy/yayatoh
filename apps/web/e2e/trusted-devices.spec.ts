import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  codeForKey,
  devPassword,
  expectAccessible,
  newUser,
  ownClientIp,
  passHumanCheck,
  type TestUser,
} from './helpers.ts';

/**
 * "Trust this device for 30 days" (M1.2f): after the second step, a browser can skip it on later
 * sign-ins. The person sees and revokes trusted devices in account security; a password change
 * (here: a reset) revokes them all.
 */
const challengeHeading = (page: Page) => page.getByRole('heading', { name: 'Two-step verification' });
const devices = (page: Page) => page.getByRole('region', { name: 'Trusted devices' });
const TRUST = "Trust this device for 30 days (don't ask for a code here)";

async function passwordSignIn(page: Page, email: string, password = devPassword()) {
  await page.goto('/sign-in');
  await page.waitForLoadState('load');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** The second step with a backup code (each works once; authenticator codes can't be replayed). */
async function answerWithBackup(page: Page, code: string, trust: boolean) {
  await expect(challengeHeading(page)).toBeVisible();
  await page.getByRole('button', { name: 'Use a backup code instead' }).click();
  await page.getByLabel('Backup code').fill(code);
  if (trust) await page.getByRole('checkbox', { name: TRUST }).check();
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/o$/);
}

/** Sign out here but keep the browser's trusted-device cookie (a new visit on the same device). */
async function signOutKeepingDevice(context: BrowserContext) {
  const keep = (await context.cookies()).filter((c) => c.name.endsWith('yy.trusted'));
  await context.clearCookies();
  await context.addCookies(keep);
  await ownClientIp(context);
}

test.describe('trusted devices (M1.2f)', () => {
  let user: TestUser;
  test.beforeEach(async ({ page, context }) => {
    await ownClientIp(context);
    user = await newUser(page, { twoFactor: true, signIn: false });
  });

  test('trusting a device skips the second step there; revoking it brings the step back (keyboard, axe)', async ({
    page,
    context,
  }) => {
    await passwordSignIn(page, user.email);
    await expect(challengeHeading(page)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: TRUST })).not.toBeChecked();
    await expectAccessible(page);
    // Keyboard only: code, tick "trust", submit.
    await page.getByLabel('6-digit code').focus();
    await page.keyboard.type(codeForKey(user.setupKey ?? ''));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: TRUST })).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/o$/);

    // Same browser, new sign-in: no second step.
    await signOutKeepingDevice(context);
    await passwordSignIn(page, user.email);
    await expect(page).toHaveURL(/\/o$/);
    await expect(challengeHeading(page)).toHaveCount(0);

    // Another browser is not trusted.
    const other = await (await page.context().browser()?.newContext())?.newPage();
    if (!other) throw new Error('no browser');
    await ownClientIp(other.context());
    await passwordSignIn(other, user.email);
    await expect(challengeHeading(other)).toBeVisible();
    await other.context().close();

    // Listed in account security (persists across reloads), then revoked with the keyboard.
    await page.goto('/account/security');
    await expect(devices(page)).toContainText('Chrome on Windows');
    await expect(devices(page)).toContainText('Trusted on');
    await page.reload();
    await expect(devices(page)).toContainText('Chrome on Windows');
    await expectAccessible(page);
    await devices(page).getByRole('button', { name: 'Revoke Chrome on Windows' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Revoked. That device will ask for your code again.' }),
    ).toBeVisible();
    await expect(devices(page)).toContainText('No trusted devices.');
    await expectAccessible(page);

    await signOutKeepingDevice(context);
    await passwordSignIn(page, user.email);
    await answerWithBackup(page, user.backupCodes[0] ?? '', false);
  });

  test('without ticking, nothing is trusted; "Revoke all" ends every trusted device', async ({
    page,
    context,
  }) => {
    await passwordSignIn(page, user.email);
    await answerWithBackup(page, user.backupCodes[0] ?? '', false);
    await page.goto('/account/security');
    await expect(devices(page)).toContainText('No trusted devices.');

    await signOutKeepingDevice(context);
    await passwordSignIn(page, user.email);
    await answerWithBackup(page, user.backupCodes[1] ?? '', true);
    await page.goto('/account/security');
    await devices(page).getByRole('button', { name: 'Revoke all trusted devices' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'All trusted devices revoked.' })).toBeVisible();
    await signOutKeepingDevice(context);
    await passwordSignIn(page, user.email);
    await expect(challengeHeading(page)).toBeVisible();
  });

  test('a password reset revokes trusted devices', async ({ page, context }) => {
    await passwordSignIn(page, user.email);
    await answerWithBackup(page, user.backupCodes[0] ?? '', true);
    await signOutKeepingDevice(context);

    await page.goto('/forgot-password');
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await passHumanCheck(page);
    await page.getByRole('button', { name: 'Send me a link' }).click();
    await expect(page.getByText("If an account uses that email, we've sent a link")).toBeVisible();
    let link = '';
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/dev/last-link?to=${encodeURIComponent(user.email)}`);
        link = ((await res.json()) as { url: string | null }).url ?? '';
        return link;
      })
      .toContain('/reset-password/');
    await page.goto(link);
    const next = `reset-${Date.now()}-password`;
    await page.getByLabel('New password').fill(next);
    await page.getByLabel('Type it again').fill(next);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page).toHaveURL(/\/sign-in\?reset=done/);

    await passwordSignIn(page, user.email, next);
    await expect(challengeHeading(page)).toBeVisible();
    await answerWithBackup(page, user.backupCodes[1] ?? '', false);
    await page.goto('/account/security');
    await expect(devices(page)).toContainText('No trusted devices.');
  });

  test('trusted devices in Arabic read right to left', async ({ page }) => {
    await passwordSignIn(page, user.email);
    await answerWithBackup(page, user.backupCodes[0] ?? '', true);
    await page.goto('/ar/account/security');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('region', { name: 'الأجهزة الموثوقة' })).toContainText('Chrome on Windows');
    await expectAccessible(page);
  });
});
