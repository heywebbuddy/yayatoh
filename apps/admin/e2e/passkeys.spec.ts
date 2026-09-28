import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { base32Decode, totp } from '@yayatoh/auth/totp';
import { expectAccessible, makeStaff, ownClientIp, WEB } from './helpers.ts';

/**
 * Staff passkeys (M1.2f, roadmap §10): a staff member adds a passkey on the console's Passkeys
 * page and then signs in with it. A passkey that verifies the person is both sign-in steps, so
 * staff with two-step verification skip the authenticator code (the console's second-step rule
 * accepts it). Chromium's virtual authenticator stands in for the device.
 */

async function virtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: authenticatorId };
}

/** A fresh staff member with two-step verification on (their setup key comes back). */
async function twoFactorStaff(page: Page) {
  const res = await page.request.post(`${WEB}/api/dev/user`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ twoFactor: '1', signIn: '0', name: `Pat Passkey ${Date.now()}` }).toString(),
  });
  expect(res.status()).toBe(200);
  const user = (await res.json()) as { email: string; setupKey: string };
  makeStaff(user.email, 'support');
  return user;
}

async function passwordAndCode(page: Page, email: string, setupKey: string) {
  await ownClientIp(page);
  await page.goto('/sign-in');
  await page.waitForLoadState('load');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEV_PERSONA_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await page.getByLabel('6-digit code').fill(totp(base32Decode(setupKey), Date.now()));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('staff add a passkey and sign in with it, skipping the authenticator code (keyboard, axe)', async ({
  page,
}) => {
  const { cdp, id } = await virtualAuthenticator(page);
  const staff = await twoFactorStaff(page);
  await passwordAndCode(page, staff.email, staff.setupKey);

  await page.getByRole('link', { name: 'Passkeys' }).click();
  await expect(page.getByRole('heading', { name: 'Passkeys', level: 1 })).toBeVisible();
  await expect(page.getByText('No passkeys yet.')).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Name (optional)').fill('Work laptop');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Passkey added.' })).toBeVisible();
  await expect(page.getByText('Work laptop', { exact: true })).toBeVisible();
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId: id });
  expect(credentials).toHaveLength(1);
  await page.reload();
  await expect(page.getByText('Work laptop', { exact: true })).toBeVisible();
  await expectAccessible(page);

  // Signed out, the passkey alone signs in (no password, no authenticator code), by keyboard.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.waitForLoadState('load');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toHaveCount(0);
  await expect(page.getByText(/Pat Passkey/)).toBeVisible();

  // Removing the passkey: it no longer signs in.
  await page.goto('/security');
  await page.getByRole('button', { name: 'Remove Work laptop' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Passkey removed.' })).toBeVisible();
  await expect(page.getByText('No passkeys yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.waitForLoadState('load');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "That passkey didn't work." })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('a passkey that does not verify the person is refused', async ({ page }) => {
  const { cdp, id } = await virtualAuthenticator(page);
  const staff = await twoFactorStaff(page);
  await passwordAndCode(page, staff.email, staff.setupKey);
  await page.goto('/security');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Passkey added.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.waitForLoadState('load');
  // The device can no longer check a PIN or fingerprint.
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId: id, isUserVerified: false });
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "That passkey didn't work." })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});
