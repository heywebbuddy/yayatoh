import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  ageSession,
  codeForKey,
  devPassword,
  expectAccessible,
  lastEmailedCode,
  newUser,
  ownClientIp,
  stepUpDialog,
} from './helpers.ts';

/**
 * Google and Apple sign-in (M1.2f) through the fake provider's consent page (the real adapters
 * need the owner's OAuth clients). An existing account is never linked on the provider's word:
 * the email must be proved with a code first (no pre-hijack takeover).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const APP = `http://localhost:${PORT}`;
const HARBOR_HOST = 'harbor-arts.yayatoh.events';
const HARBOR = `http://${HARBOR_HOST}:${PORT}`;

const unique = (label: string) =>
  `${label}-${test.info().project.name.split('-')[0]}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

/** The fake consent page: who the provider says is signing in. */
async function consent(
  page: Page,
  opts: {
    email?: string;
    name?: string;
    verified?: boolean;
    hide?: boolean;
    provider?: 'Google' | 'Apple';
  } = {},
) {
  await expect(page).toHaveURL(/\/auth\/social\/fake\?/);
  await expect(
    page.getByRole('heading', { name: `Sign in with ${opts.provider ?? 'Google'}` }),
  ).toBeVisible();
  await page.waitForLoadState('load');
  if (opts.email !== undefined) await page.getByLabel('Email', { exact: true }).fill(opts.email);
  if (opts.name) await page.getByLabel('Name', { exact: true }).fill(opts.name);
  if (opts.verified === false)
    await page.getByRole('checkbox', { name: 'The provider has verified this email' }).uncheck();
  if (opts.hide) await page.getByRole('checkbox', { name: 'Hide my email (private relay address)' }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

async function fresh(context: BrowserContext) {
  await context.clearCookies();
  await ownClientIp(context);
}

const methods = (page: Page) => page.getByRole('region', { name: 'Sign-in methods' });

test.describe('Google and Apple sign-in (M1.2f)', () => {
  test.beforeEach(async ({ context }) => ownClientIp(context));

  test('a first Google sign-in creates the account; the next one signs into the same account (keyboard only)', async ({
    page,
    context,
  }) => {
    const email = unique('google-new');
    const name = `Gwen ${Date.now()}`;
    await page.goto('/sign-in');
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue with Apple' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Continue with Google' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/auth\/social\/fake\?/);
    await expectAccessible(page);
    await page.getByLabel('Email', { exact: true }).focus();
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    // A new account without organizations lands on the empty org picker.
    await expect(page).toHaveURL(/\/o$/);
    await page.goto('/account/security');
    await expect(methods(page)).toContainText('Google');
    await expect(methods(page)).toContainText('Linked on');
    await expect(page.getByText(email).first()).toBeVisible();
    await expectAccessible(page);

    // Signed out, the same Google identity signs into the same account (persistence, no duplicate).
    await fresh(context);
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await consent(page, { email });
    await expect(page).toHaveURL(/\/o$/);
    await page.goto('/account/security');
    await expect(page.getByText(email).first()).toBeVisible();
    await expect(methods(page).getByText('Linked on')).toHaveCount(1);
  });

  test('an existing password account is not taken over: the email is proved with a code first', async ({
    page,
    context,
  }) => {
    const user = await newUser(page, { signIn: false });
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await consent(page, { email: user.email });
    await expect(page).toHaveURL(/\/sign-in\/link\?/);
    await expect(page.getByRole('heading', { name: 'Link your Google account' })).toBeVisible();
    await expect(page.getByText(`A Yayatoh account already uses ${user.email}.`)).toBeVisible();
    await expectAccessible(page);
    // Nothing is signed in (or linked) yet.
    const security = await page.request.get('/account/security', { maxRedirects: 0 });
    expect([303, 307]).toContain(security.status());

    const code = await lastEmailedCode(page, user.email);
    await page.getByLabel('6-digit code').fill(code === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Confirm and sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "That code didn't work." })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('6-digit code').fill(code);
    await page.getByLabel('6-digit code').press('Enter');
    await expect(page).toHaveURL(/\/o$/);
    await page.goto('/account/security');
    await expect(methods(page)).toContainText('Linked on');

    // From now on Google signs in directly, and the password still works too.
    await fresh(context);
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await consent(page, { email: user.email });
    await expect(page).toHaveURL(/\/o$/);
    await fresh(context);
    await page.goto('/sign-in');
    await page.waitForLoadState('load');
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(devPassword());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/o$/);
  });

  test('the proof page in Arabic reads right to left', async ({ page }) => {
    const user = await newUser(page, { signIn: false });
    await page.goto('/ar/sign-in');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: 'المتابعة باستخدام Google' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'المتابعة باستخدام Google' }).click();
    await expect(page).toHaveURL(/\/auth\/social\/fake\?/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(user.email);
    await page.getByRole('button', { name: 'متابعة', exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/sign-in\/link\?/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'اربط حسابك في Google' })).toBeVisible();
    await expectAccessible(page);
  });

  test('refused and cancelled provider sign-ins say why and create nothing', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    // An empty email on the provider page.
    await consent(page, { email: '' });
    await expect(page.getByText('Enter an email address.').first()).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(unique('unverified'));
    await page.getByRole('checkbox', { name: 'The provider has verified this email' }).uncheck();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?social=email_unverified/);
    await expect(
      page.getByRole('alert').filter({ hasText: "isn't verified with the provider" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('link', { name: 'Continue with Apple' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in with Apple' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/sign-in\?social=cancelled/);
    await expect(page.getByRole('alert').filter({ hasText: 'Signing in was cancelled.' })).toBeVisible();

    // A replayed callback (its state is single use) is refused.
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await page.getByLabel('Email', { exact: true }).fill(unique('replay'));
    const [callback] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/auth/social/google/callback')),
      page.getByRole('button', { name: 'Continue', exact: true }).click(),
    ]);
    await expect(page).toHaveURL(/\/o$/);
    await page.goto(callback.url());
    await expect(page).toHaveURL(/\/sign-in\?social=failed/);
  });

  test('Apple “Hide my email” creates an account on the relay address; it can’t be unlinked while it is the only way in', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Continue with Apple' }).click();
    await consent(page, { provider: 'Apple', email: unique('apple'), name: 'Ada Apple', hide: true });
    await expect(page).toHaveURL(/\/o$/);
    await page.goto('/account/security');
    await expect(page.getByText(/@privaterelay\.appleid\.com/).first()).toBeVisible();
    await expect(methods(page)).toContainText('Apple');
    await methods(page).getByRole('button', { name: 'Unlink Apple' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You can't unlink it" })).toBeVisible();
    await expect(methods(page).getByRole('button', { name: 'Unlink Apple' })).toBeVisible();
  });

  test('link and unlink from account security need a step-up; one Google identity belongs to one account', async ({
    page,
    browser,
  }) => {
    const user = await newUser(page);
    const googleEmail = unique('linked');
    await ageSession(page);
    await page.goto('/account/security');
    await expect(methods(page).getByText('Not linked')).toHaveCount(2);
    await methods(page).getByRole('button', { name: 'Link Google' }).click();
    const dialog = stepUpDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Password').fill(devPassword());
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await consent(page, { email: googleEmail });
    await expect(page).toHaveURL(/\/account\/security\?social=linked/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Linked. You can now sign in with it.' }),
    ).toBeVisible();
    await expect(methods(page)).toContainText('Linked on');
    await expectAccessible(page);

    // Another person can't take the same Google identity.
    const other = await (await browser.newContext()).newPage();
    await ownClientIp(other.context());
    await newUser(other);
    await other.goto('/account/security');
    await methods(other).getByRole('button', { name: 'Link Google' }).click();
    await consent(other, { email: googleEmail });
    await expect(
      other.getByRole('alert').filter({ hasText: 'That account is linked to another Yayatoh account.' }),
    ).toBeVisible();
    await other.context().close();

    // Unlink (the step-up is still fresh), with the keyboard.
    await methods(page).getByRole('button', { name: 'Unlink Google' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Unlinked.' })).toBeVisible();
    await page.reload();
    await expect(methods(page).getByText('Not linked')).toHaveCount(2);
    expect(user.email).toContain('@');
  });

  test('a stale session must confirm before unlinking; cancelling changes nothing', async ({ page }) => {
    await newUser(page);
    await page.goto('/account/security');
    await methods(page).getByRole('button', { name: 'Link Google' }).click();
    await consent(page, { email: unique('stale') });
    await expect(methods(page)).toContainText('Linked on');
    await ageSession(page);
    await page.reload();
    await methods(page).getByRole('button', { name: 'Unlink Google' }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(stepUpDialog(page)).toHaveCount(0);
    await page.reload();
    await expect(methods(page)).toContainText('Linked on');
  });

  test('signing in with Google for a tenant site goes back there through the handoff', async ({ page }) => {
    const name = `Hana ${Date.now()}`;
    await page.goto(`${HARBOR}/`);
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${APP}/sign-in\\?return=`));
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await consent(page, { email: unique('tenant'), name });
    await expect(page).toHaveURL(`${HARBOR}/`);
    await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();
  });

  test('with two-step verification, a provider sign-in still asks for the authenticator code', async ({
    page,
  }) => {
    const user = await newUser(page, { twoFactor: true, signIn: false });
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await consent(page, { email: user.email });
    await page.getByLabel('6-digit code').fill(await lastEmailedCode(page, user.email));
    await page.getByRole('button', { name: 'Confirm and sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('6-digit code').fill(codeForKey(user.setupKey ?? ''));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/o$/);
  });
});
