import { expect, type Locator, type Page, test } from '@playwright/test';
import { base32Decode, totp } from '@yayatoh/auth/totp';
import {
  ageSession,
  codeForKey,
  confirmStepUp,
  devPassword,
  expectAccessible,
  lastEmailedCode,
  newUser,
  OWNER,
  ownClientIp,
  passHumanCheck,
  personaCode,
  signIn,
  stepUpDialog,
  wrongCode,
} from './helpers.ts';

/**
 * Two-step verification (M1.2c): set up with an authenticator app, backup codes, the sign-in
 * challenge, the rule for owners/admins/finance, and turning it off. Every journey uses its own
 * throwaway account (`/api/dev/user`), so projects and reruns never share state; the seeded owners
 * are only signed in (their codes come from the dev-only persona secret).
 */

const SECURITY = '/account/security';
const card = (page: Page) => page.getByRole('region', { name: 'Authenticator app' });
const wrongFor = (setupKey: string) => wrongCode((at) => totp(base32Decode(setupKey), at));

/** Press Tab until `target` has focus (keyboard-only journeys); fails if it never does. */
async function tabTo(page: Page, target: Locator, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Starts set-up and returns the setup key shown under the QR code. */
async function startSetup(page: Page): Promise<string> {
  await card(page).getByRole('button', { name: 'Set up authenticator app' }).click();
  await expect(page.getByRole('img', { name: /^QR code for your authenticator app/ })).toBeVisible();
  const key = (await page.getByTestId('setup-key').textContent()) ?? '';
  expect(key).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/);
  return key;
}

async function signInWithPassword(page: Page, email: string, locale = '') {
  await ownClientIp(page.context());
  await page.goto(`${locale}/sign-in`);
  await page.getByLabel(locale ? 'البريد الإلكتروني' : 'Email').fill(email);
  await page.getByLabel(locale ? 'كلمة المرور' : 'Password').fill(devPassword());
  await page.getByRole('button', { name: locale ? 'تسجيل الدخول' : 'Sign in', exact: true }).click();
}

test.describe('two-step verification: set up', () => {
  test('QR code and setup key, a wrong code is refused, the right one turns it on with ten backup codes shown once', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await newUser(page);
    await page.goto(SECURITY);
    await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
    await expect(card(page).getByText('Off', { exact: true })).toBeVisible();
    // Optional for this person: no "required" notice.
    await expect(page.getByRole('heading', { name: 'Two-step verification is required' })).toHaveCount(0);
    await expectAccessible(page);

    const key = await startSetup(page);
    // The QR code's text alternative points at the setup key, which can be copied.
    await expect(page.getByRole('img', { name: /QR code/ })).toHaveAttribute('aria-describedby', /.+/);
    await page.getByRole('button', { name: 'Copy setup key' }).click();
    await expect(page.getByText('Copied.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key.replace(/ /g, ''));
    await expectAccessible(page);

    // Validation: nothing typed, then a wrong code.
    const code = page.getByLabel('6-digit code');
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    const error = page.getByRole('alert').filter({ hasText: "That code didn't work." });
    await expect(error).toBeVisible();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await code.fill(wrongFor(key));
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    await expect(error).toBeVisible();
    await expectAccessible(page);

    await code.fill(codeForKey(key));
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Two-step verification is on.' })).toBeVisible();
    const codes = page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem');
    await expect(codes).toHaveCount(10);
    const shown = (await codes.allTextContents()).map((c) => c.trim());
    for (const c of shown) expect(c).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);
    expect(new Set(shown).size).toBe(10);
    await page.getByRole('button', { name: 'Copy codes' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown.join('\n'));
    const download = page.getByRole('link', { name: 'Download codes' });
    await expect(download).toHaveAttribute('download', 'yayatoh-backup-codes.txt');
    expect(decodeURIComponent((await download.getAttribute('href')) ?? '')).toContain(shown[0]);
    await expectAccessible(page);

    await page.getByRole('button', { name: "I've saved my codes" }).click();
    await expect(card(page).getByText('On', { exact: true })).toBeVisible();
    await expect(page.getByText('10 backup codes left')).toBeVisible();
    // Persisted, and the codes are never shown again.
    await page.reload();
    await expect(card(page).getByText('On', { exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Backup codes' })).toHaveCount(0);
    expect(await page.content()).not.toContain(shown[0]);
    await expectAccessible(page);
  });

  test('set up works with the keyboard alone', async ({ page }) => {
    await newUser(page);
    await page.goto(SECURITY);
    const setUp = card(page).getByRole('button', { name: 'Set up authenticator app' });
    await tabTo(page, setUp);
    await page.keyboard.press('Enter');
    const key = (await page.getByTestId('setup-key').textContent()) ?? '';
    // The code field takes focus; Enter submits.
    await expect(page.getByLabel('6-digit code')).toBeFocused();
    await page.keyboard.type(codeForKey(key));
    await page.keyboard.press('Enter');
    const saved = page.getByRole('button', { name: "I've saved my codes" });
    await expect(saved).toBeVisible();
    await tabTo(page, saved);
    await page.keyboard.press('Enter');
    await expect(card(page).getByText('On', { exact: true })).toBeVisible();
  });

  test('cancelling set up leaves it off', async ({ page }) => {
    await newUser(page);
    await page.goto(SECURITY);
    await startSetup(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(card(page).getByRole('button', { name: 'Set up authenticator app' })).toBeVisible();
    await page.reload();
    await expect(card(page).getByText('Off', { exact: true })).toBeVisible();
  });

  test('signed out, the page asks you to sign in first', async ({ page }) => {
    await page.goto(SECURITY);
    await expect(page).toHaveURL(
      /\/sign-in\?next=%2Faccount%2Fsecurity$|\/sign-in\?next=\/account\/security$/,
    );
  });
});

test.describe('two-step verification: the way in', () => {
  // The sidebar is a menu on narrow screens; this checks the link itself.
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the console sidebar links to account security', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events');
    await page.getByRole('link', { name: 'Account security' }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
    await expect(card(page).getByText('On', { exact: true })).toBeVisible();
  });
});

test.describe('two-step verification: the sign-in challenge', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('sign out, then in: a wrong code is refused, the right code opens the console', async ({ page }) => {
    const user = await newUser(page, { org: true, twoFactor: true });
    const key = user.setupKey ?? '';
    await page.goto(`/o/${user.orgSlug}`);
    await expect(page).toHaveURL(new RegExp(`/o/${user.orgSlug}$`));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    await signInWithPassword(page, user.email);
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await expect(page.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();
    // No session yet: the console still sends us to sign in.
    const probe = await page.request.get(`/o/${user.orgSlug}`, { maxRedirects: 0 });
    expect(probe.status()).toBe(307);
    await expectAccessible(page);

    const code = page.getByLabel('6-digit code');
    await expect(code).toBeFocused();
    await code.fill(wrongFor(key));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "That code didn't work. Try again." }),
    ).toBeVisible();
    await expectAccessible(page);
    await code.fill(codeForKey(key));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/o/${user.orgSlug}$`));
  });

  test('a backup code signs in once; new backup codes replace the old ones', async ({ page, context }) => {
    const user = await newUser(page, { twoFactor: true, signIn: false });
    const [first, second, third] = user.backupCodes;
    await signInWithPassword(page, user.email);
    await page.getByRole('button', { name: 'Use a backup code instead' }).click();
    await expect(page.getByText('Enter one of your backup codes. Each code works once.')).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Backup code').fill(first ?? '');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);

    // Spent: the same code is refused next time; another one works.
    await context.clearCookies();
    await signInWithPassword(page, user.email);
    await page.getByRole('button', { name: 'Use a backup code instead' }).click();
    await page.getByLabel('Backup code').fill(first ?? '');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "That code didn't work. Try again." }),
    ).toBeVisible();
    // Typed as people do: spaces and without the dash.
    await page.getByLabel('Backup code').fill(` ${(second ?? '').replace('-', ' ')} `);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);

    await page.goto(SECURITY);
    await expect(page.getByText('8 backup codes left')).toBeVisible();
    // A fresh sign-in needs no confirmation: replace the codes; they are shown once.
    await page.getByRole('button', { name: 'Get new backup codes' }).click();
    await expect(page.getByText('Your current backup codes will stop working.')).toBeVisible();
    await page.getByRole('button', { name: 'Replace my codes' }).click();
    const fresh = page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem');
    await expect(fresh).toHaveCount(10);
    const replaced = (await fresh.allTextContents()).map((c) => c.trim());
    expect(replaced).not.toContain(third);
    await expectAccessible(page);
    await page.getByRole('button', { name: "I've saved my codes" }).click();
    await expect(page.getByText('10 backup codes left')).toBeVisible();

    // An old, unused code no longer works; a new one does.
    await context.clearCookies();
    await signInWithPassword(page, user.email);
    await page.getByRole('button', { name: 'Use a backup code instead' }).click();
    await page.getByLabel('Backup code').fill(third ?? '');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "That code didn't work. Try again." }),
    ).toBeVisible();
    await page.getByLabel('Backup code').fill(replaced[0] ?? '');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);
  });

  test('wrong codes are limited: after five, the sign-in starts again', async ({ page }) => {
    const user = await newUser(page, { twoFactor: true, signIn: false });
    const key = user.setupKey ?? '';
    await signInWithPassword(page, user.email);
    const code = page.getByLabel('6-digit code');
    const wrong = page.getByRole('alert').filter({ hasText: "That code didn't work. Try again." });
    for (let i = 0; i < 5; i++) {
      await code.fill(wrongFor(key));
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
      await expect(wrong).toBeVisible();
    }
    // Even the right code is refused now: this challenge is spent.
    await code.fill(codeForKey(key));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Too many wrong codes. Sign in again to get another try.' }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page.getByLabel('Password')).toBeVisible();
    // A new sign-in gets a new challenge.
    await signInWithPassword(page, user.email);
    await page.getByLabel('6-digit code').fill(codeForKey(key));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);
  });

  test('an emailed sign-in code is one factor: the authenticator code still follows', async ({ page }) => {
    const user = await newUser(page, { twoFactor: true, signIn: false });
    await ownClientIp(page.context());
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Use a one-time code instead' }).click();
    await page.getByLabel('Email').fill(user.email);
    // M1.2f: an emailed code (which can create an account) needs the human check.
    await passHumanCheck(page);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await page.getByLabel('6-digit code').fill(await lastEmailedCode(page, user.email));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    const probe = await page.request.get('/o', { maxRedirects: 0 });
    expect(probe.status()).toBe(307);
    await page.getByLabel('6-digit code').fill(codeForKey(user.setupKey ?? ''));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);
  });

  test('a seeded owner signs in with the password and the authenticator code', async ({ page }) => {
    await signInWithPassword(page, OWNER);
    await page.getByLabel('6-digit code').fill(personaCode(OWNER));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events$/);
  });
});

test.describe('two-step verification: required for owners, admins and finance', () => {
  test('an owner without it is sent to set it up; every console waits until it is on', async ({ page }) => {
    const user = await newUser(page, { org: true, join: ['lakeside-events:viewer'] });
    await page.goto(`/o/${user.orgSlug}`);
    await expect(page).toHaveURL(/\/account\/security\?required=1$/);
    const notice = page.getByRole('region', { name: 'Two-step verification is required' });
    await expect(notice).toContainText('People who can move money');
    await expect(notice.getByRole('listitem')).toHaveText([`Owner at Test Org ${user.orgSlug?.slice(4)}`]);
    // No way around it: no link back, and the org where they are a viewer is closed too.
    await expect(page.getByRole('link', { name: 'Back to your console' })).toHaveCount(0);
    await expectAccessible(page);
    await page.goto('/o/lakeside-events/team');
    await expect(page).toHaveURL(/\/account\/security\?required=1$/);

    const key = await startSetup(page);
    await page.getByLabel('6-digit code').fill(codeForKey(key));
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    await expect(page.getByRole('list', { name: 'Backup codes' })).toBeVisible();
    // Every console opens now: the first of their organizations, their own, and the other one.
    await page.getByRole('link', { name: 'Continue to your console' }).click();
    await expect(page).toHaveURL(/\/o\/[a-z0-9-]+$/);
    await page.goto(`/o/${user.orgSlug}`);
    await expect(page).toHaveURL(new RegExp(`/o/${user.orgSlug}$`));
    await page.goto('/o/lakeside-events');
    await expect(page).toHaveURL(/\/o\/lakeside-events$/);
    // On now, and it can't be turned off while the role needs it.
    await page.goto(SECURITY);
    await expect(page.getByRole('heading', { name: 'Two-step verification is required' })).toHaveCount(0);
    await expect(
      page.getByText(
        `Your role requires two-step verification, so it can't be turned off: Owner at Test Org ${user.orgSlug?.slice(4)}.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn off two-step verification' })).toHaveCount(0);
  });

  for (const role of ['admin', 'finance'] as const)
    test(`${role}s are sent to set it up too`, async ({ page }) => {
      await newUser(page, { join: [`rosewood-weddings:${role}`] });
      await page.goto('/o/rosewood-weddings');
      await expect(page).toHaveURL(/\/account\/security\?required=1$/);
      await expect(page.getByRole('region', { name: 'Two-step verification is required' })).toContainText(
        `${role === 'admin' ? 'Admin' : 'Finance'} at Rosewood Weddings`,
      );
    });

  test('viewers and managers are not forced; for them it is optional', async ({ page }) => {
    await newUser(page, { join: ['lakeside-events:viewer', 'rosewood-weddings:manager'] });
    await page.goto('/o/lakeside-events');
    await expect(page).toHaveURL(/\/o\/lakeside-events$/);
    await page.goto('/o/rosewood-weddings');
    await expect(page).toHaveURL(/\/o\/rosewood-weddings$/);
    await page.goto(SECURITY);
    await expect(page.getByRole('heading', { name: 'Two-step verification is required' })).toHaveCount(0);
    await expect(card(page).getByRole('button', { name: 'Set up authenticator app' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to your console' })).toBeVisible();
  });

  test('the seeded owners have it on and cannot turn it off', async ({ page }) => {
    await signIn(page);
    await page.goto(SECURITY);
    await expect(card(page).getByText('On', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Your role requires two-step verification, so it can't be turned off: Owner at Lakeside Events.",
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn off two-step verification' })).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe('two-step verification: turning it off', () => {
  test('needs a current code: empty and wrong codes are refused, the right one turns it off', async ({
    page,
  }) => {
    const user = await newUser(page, { twoFactor: true });
    const key = user.setupKey ?? '';
    await page.goto(SECURITY);
    await expect(card(page).getByText('On', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Turn off two-step verification' }).click();
    await expect(
      page.getByText('Enter a code from your authenticator app, or a backup code, to turn it off.'),
    ).toBeVisible();
    await expectAccessible(page);
    const field = page.getByLabel('Code', { exact: true });
    await expect(field).toBeFocused();
    const error = page.getByRole('alert').filter({ hasText: "That code didn't work." });
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect(error).toBeVisible();
    await field.fill(wrongFor(key));
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect(error).toBeVisible();
    await expect(card(page).getByText('On', { exact: true })).toBeVisible();
    await expectAccessible(page);
    await field.fill(codeForKey(key));
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect(card(page).getByText('Off', { exact: true })).toBeVisible();
    await page.reload();
    await expect(card(page).getByText('Off', { exact: true })).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Set up authenticator app' })).toBeVisible();
  });

  test('a backup code turns it off too; cancel closes the form', async ({ page }) => {
    const user = await newUser(page, { twoFactor: true });
    await page.goto(SECURITY);
    await page.getByRole('button', { name: 'Turn off two-step verification' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Code', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Turn off two-step verification' }).click();
    await page.getByLabel('Code', { exact: true }).fill(user.backupCodes[0] ?? '');
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect(card(page).getByText('Off', { exact: true })).toBeVisible();
  });

  test('the server refuses to turn it off for a role that requires it, even when asked directly', async ({
    page,
    browser,
  }) => {
    // Record the "turn off" request from someone allowed to make it (a wrong code: nothing changes)…
    const allowed = await newUser(page, { twoFactor: true });
    await page.goto(SECURITY);
    await page.getByRole('button', { name: 'Turn off two-step verification' }).click();
    await page.getByLabel('Code', { exact: true }).fill(wrongFor(allowed.setupKey ?? ''));
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && Boolean(r.headers()['next-action'])),
      page.getByRole('button', { name: 'Turn off', exact: true }).click(),
    ]);
    const body = request.postData() ?? '';
    const wrong = wrongFor(allowed.setupKey ?? '');
    expect(body).toContain(wrong);

    // …and replay it as an owner, with their right code: refused, and it stays on.
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const ownerUser = await newUser(owner, { org: true, twoFactor: true });
    const res = await owner.request.post(SECURITY, {
      headers: {
        'next-action': request.headers()['next-action'] ?? '',
        'content-type': request.headers()['content-type'] ?? '',
        accept: 'text/x-component',
      },
      data: body.replace(wrong, codeForKey(ownerUser.setupKey ?? '')),
    });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('"required"');
    await owner.goto(SECURITY);
    await expect(card(owner).getByText('On', { exact: true })).toBeVisible();
    await ownerContext.close();
  });
});

test.describe('two-step verification: step-up on this page', () => {
  test('replacing backup codes after the fresh window asks "Confirm it\'s you"; a backup code confirms', async ({
    page,
  }) => {
    const user = await newUser(page, { twoFactor: true });
    await page.goto(SECURITY);
    await ageSession(page);
    await page.getByRole('button', { name: 'Get new backup codes' }).click();
    await page.getByRole('button', { name: 'Replace my codes' }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await expect(
      stepUpDialog(page).getByText('Enter the 6-digit code from your authenticator app, or a backup code.'),
    ).toBeVisible();
    await expectAccessible(page);
    await confirmStepUp(page, user.backupCodes[0] ?? '');
    await expect(page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem')).toHaveCount(10);
  });
});

test.describe('two-step verification: Arabic (right to left)', () => {
  test('the security page and set up render right to left', async ({ page }) => {
    await newUser(page);
    await page.goto(`/ar${SECURITY}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { name: 'الأمان', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'إعداد تطبيق المصادقة' }).click();
    await expect(page.getByRole('img', { name: /^رمز QR لتطبيق المصادقة/ })).toBeVisible();
    // The key reads left to right inside the right-to-left page.
    await expect(page.getByTestId('setup-key')).toHaveAttribute('dir', 'ltr');
    await expectAccessible(page);
  });

  test('the sign-in challenge renders right to left', async ({ page }) => {
    const user = await newUser(page, { twoFactor: true, signIn: false });
    await signInWithPassword(page, user.email, '/ar');
    await expect(page.getByRole('heading', { name: 'التحقق بخطوتين' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
    await page.getByLabel('رمز من 6 أرقام').fill(codeForKey(user.setupKey ?? ''));
    await page.getByRole('button', { name: 'تحقّق وسجّل الدخول' }).click();
    await expect(page).toHaveURL(/\/ar\/o$/);
  });
});

test.describe('two-step verification: each code works once (M1.2c leftover)', () => {
  test('a code that signed in is refused for the next sign-in within its window; a backup code still works', async ({
    page,
  }) => {
    const user = await newUser(page, { twoFactor: true, signIn: false });
    const code = codeForKey(user.setupKey ?? '');
    await signInWithPassword(page, user.email);
    await page.getByLabel('6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);

    // Signed out, and the same code again (still inside its 90-second window): refused.
    await page.context().clearCookies();
    await signInWithPassword(page, user.email);
    await page.getByLabel('6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "That code didn't work. Try again." }),
    ).toBeVisible();
    const probe = await page.request.get('/account/security', { maxRedirects: 0 });
    expect(probe.status()).toBe(307);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Use a backup code instead' }).click();
    await page.getByLabel('Backup code').fill(user.backupCodes[0] ?? '');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);
  });
});
