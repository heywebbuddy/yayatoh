import { expect, type Page, test } from '@playwright/test';
import {
  devPassword,
  expectAccessible,
  lastEmailedCode,
  newUser,
  ownClientIp,
  passHumanCheck,
} from './helpers.ts';

/**
 * "Are you a person?" (M1.2f): Turnstile with the owner's keys, a fake checkbox in dev and CI
 * whose token passes and whose always-fail token doesn't. Asked before an emailed sign-in code
 * (it can create an account), for password sign-ins after three failures, before a password
 * reset link and on the venue quote form; always verified on the server.
 */
const FAIL_TOKEN = 'fake-human-fail';
const check = (page: Page) => page.getByRole('checkbox', { name: "I'm a person (test check)" });

/** Tick the fake check but make it post the always-fail token (as a refused Turnstile answer would). */
async function failingCheck(page: Page) {
  const setFail = () =>
    check(page).evaluate((el, token) => {
      (el as HTMLInputElement).value = token;
    }, FAIL_TOKEN);
  // Before ticking (script-sent forms read it on change) and after (a re-render restores the
  // rendered value; plain forms read it on submit).
  await setFail();
  await check(page).check();
  await setFail();
}

async function passwordAttempt(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('human check (Turnstile) on sign-in, sign-up codes and resets', () => {
  test.beforeEach(async ({ context }) => ownClientIp(context));

  test('an emailed sign-in code needs the check: missing and failed are refused, a solved one sends the code', async ({
    page,
  }) => {
    const email = `code-${test.info().project.name}-${Date.now()}@example.test`;
    await page.goto('/sign-in');
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: 'Use a one-time code instead' }).click();
    await expect(page.getByRole('group', { name: 'Security check' })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Complete the security check, then try again.' }),
    ).toBeVisible();

    await failingCheck(page);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "The security check didn't work. Try it again." }),
    ).toBeVisible();
    // The server refused it: no code was sent.
    const none = await page.request.get(`/api/dev/last-code?to=${encodeURIComponent(email)}`);
    expect(((await none.json()) as { code: string | null }).code).toBeNull();
    await expectAccessible(page);

    // Keyboard only: tick with Space, send with Enter.
    await check(page).focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Email me a code' }).focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('6-digit code').fill(await lastEmailedCode(page, email));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    // A first code creates the account (sign-up).
    await expect(page).toHaveURL(/\/o$/);
  });

  test('the API route refuses a code request without a solved check (no bypass around the form)', async ({
    page,
  }) => {
    const email = `api-${Date.now()}@example.test`;
    const res = await page.request.post('/api/auth/email-otp/send-verification-otp', {
      data: { email, type: 'sign-in' },
    });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('HUMAN_CHECK_REQUIRED');
    const failed = await page.request.post('/api/auth/email-otp/send-verification-otp', {
      data: { email, type: 'sign-in' },
      headers: { 'x-human-check': FAIL_TOKEN },
    });
    expect(((await failed.json()) as { code: string }).code).toBe('HUMAN_CHECK_FAILED');
    // Password resets are only requested through the app's own page.
    const reset = await page.request.post('/api/auth/request-password-reset', { data: { email } });
    expect(reset.status()).toBe(403);
  });

  test('after three wrong passwords the check appears; with it the right password signs in', async ({
    page,
  }) => {
    const user = await newUser(page, { signIn: false });
    await page.goto('/sign-in');
    await page.waitForLoadState('load');
    for (let i = 0; i < 3; i++) {
      await passwordAttempt(page, user.email, `wrong-password-${i}`);
      await expect(
        page.getByRole('alert').filter({ hasText: "That email and password don't match." }),
      ).toBeVisible();
    }
    // The third failure turned the check on.
    await expect(page.getByRole('group', { name: 'Security check' })).toBeVisible();
    await expectAccessible(page);
    // Without it, even the right password is refused.
    await page.getByLabel('Password', { exact: true }).fill(devPassword());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Complete the security check, then try again.' }),
    ).toBeVisible();
    await failingCheck(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "The security check didn't work." }),
    ).toBeVisible();
    await passHumanCheck(page);
    await page.getByLabel('Password', { exact: true }).fill(devPassword());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/o$/);
  });

  test('the check in Arabic reads right to left', async ({ page }) => {
    await page.goto('/ar/sign-in');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.waitForLoadState('load');
    await page.getByRole('button', { name: 'استخدم رمزًا لمرة واحدة بدلًا من ذلك' }).click();
    await expect(page.getByRole('group', { name: 'فحص الأمان' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'أنا إنسان (فحص تجريبي)' })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('forgot password (M1.2f)', () => {
  test.beforeEach(async ({ context }) => ownClientIp(context));

  test('asks for the check, sends a link, sets a new password (validation), and the old one stops working', async ({
    page,
    context,
  }) => {
    const user = await newUser(page, { signIn: false });
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Email', { exact: true }).fill('not-an-email');
    await page.getByRole('button', { name: 'Send me a link' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a valid email address.' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByRole('button', { name: 'Send me a link' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Complete the security check first.' }),
    ).toBeVisible();
    await failingCheck(page);
    await page.getByRole('button', { name: 'Send me a link' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "The security check didn't work." }),
    ).toBeVisible();
    await passHumanCheck(page);
    await page.getByRole('button', { name: 'Send me a link' }).click();
    await expect(page.getByText("If an account uses that email, we've sent a link")).toBeVisible();
    await expectAccessible(page);

    let link = '';
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/dev/last-link?to=${encodeURIComponent(user.email)}`);
        link = ((await res.json()) as { url: string | null }).url ?? '';
        return link;
      })
      .toContain('/reset-password/');
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expectAccessible(page);
    const next = `new-password-${Date.now()}`;
    await page.getByLabel('New password').fill('short');
    await page.getByLabel('Type it again').fill('short');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Use at least 8 characters.' })).toBeVisible();
    await page.getByLabel('New password').fill(next);
    await page.getByLabel('Type it again').fill(`${next}x`);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "The two passwords don't match." })).toBeVisible();
    await page.getByLabel('New password').fill(next);
    await page.getByLabel('Type it again').fill(next);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page).toHaveURL(/\/sign-in\?reset=done/);
    await expect(page.getByText('Your password was changed. Sign in with your new password.')).toBeVisible();

    // The link works once.
    await page.goto(link);
    await expect(
      page.getByText('This link has expired or was already used. Ask for a new one.'),
    ).toBeVisible();

    // The old password no longer works; the new one does.
    await context.clearCookies();
    await ownClientIp(context);
    await page.goto('/sign-in');
    await page.waitForLoadState('load');
    await passwordAttempt(page, user.email, devPassword());
    await expect(
      page.getByRole('alert').filter({ hasText: "That email and password don't match." }),
    ).toBeVisible();
    await passwordAttempt(page, user.email, next);
    await expect(page).toHaveURL(/\/o$/);
  });

  test('the reset pages in Arabic read right to left', async ({ page }) => {
    await page.goto('/ar/forgot-password');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'إعادة تعيين كلمة المرور' })).toBeVisible();
    await expectAccessible(page);
    await page.goto('/ar/reset-password?token=nope&error=INVALID_TOKEN');
    await expect(page.getByText('انتهت صلاحية هذا الرابط أو استُخدم من قبل. اطلب رابطًا جديدًا.')).toBeVisible();
  });
});

test.describe('venue quote form (M1.2f)', () => {
  test('a quote needs the check: missing and failed answers are refused, nothing is sent', async ({
    browser,
  }) => {
    // A fresh visitor (own device cookie and IP), on the seeded listed venue.
    const context = await browser.newContext();
    await ownClientIp(context);
    const page = await context.newPage();
    await page.goto('/venues/lakeside-pavilion');
    await expect(page.getByRole('group', { name: 'Security check' })).toBeVisible();
    await page.getByLabel('Your name').fill('Quinn Check');
    await page.getByLabel('Email').fill(`quinn.${Date.now()}@example.test`);
    await page.getByLabel('About your event').fill('A spring gala for about eighty guests.');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Complete the security check first.' }),
    ).toBeVisible();
    await failingCheck(page);
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: "The security check didn't work." }),
    ).toBeVisible();
    await expect(page.getByText('Thanks! Your request was sent to the venue.')).toHaveCount(0);
    await expectAccessible(page);
    await context.close();
  });
});
