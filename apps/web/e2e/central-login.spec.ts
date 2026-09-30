import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { codeForKey, devPassword, expectAccessible, newUser, ownClientIp } from './helpers.ts';

/**
 * Central login (M1.2d): tenant sites never sign anyone in themselves. "Sign in" there goes to
 * the app host's sign-in (in these tests the dev host, localhost), which sends the person back
 * with a 60-second, single-use code bound to that tenant host and browser; the tenant host
 * redeems it for its own host-only session cookie.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const APP = `http://localhost:${PORT}`;
const HARBOR_HOST = 'harbor-arts.yayatoh.events';
const HARBOR = `http://${HARBOR_HOST}:${PORT}`;
const LAKESIDE_HOST = 'lakeside-events.yayatoh.events';
const LAKESIDE = `http://${LAKESIDE_HOST}:${PORT}`;

const signInLink = (page: Page) => page.getByRole('link', { name: 'Sign in', exact: true });
const errorHeading = (page: Page) => page.getByRole('heading', { name: "This sign-in link can't be used" });
const isHandoff = (url: URL) => url.pathname.endsWith('/auth/handoff');

async function passwordForm(page: Page, email: string) {
  // The app host's sign-in page, fully loaded (a click before hydration would post the form natively).
  await expect(page).toHaveURL(new RegExp(`^${APP}/(ar/)?sign-in`));
  await page.waitForLoadState('load');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(devPassword());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** A throwaway person (no organization), not signed in anywhere, acting as their own client. */
async function person(page: Page, context: BrowserContext, opts: { twoFactor?: boolean } = {}) {
  await ownClientIp(context);
  const name = `Tess ${test.info().project.name.split('-')[0]} ${Date.now()}`;
  const user = await newUser(page, { signIn: false, name, ...opts });
  return { ...user, name };
}

/** From the tenant home, through the app host, back signed in (password only). */
async function signInOnHarbor(page: Page, email: string, name: string) {
  await page.goto(`${HARBOR}/`);
  await signInLink(page).click();
  await expect(page).toHaveURL(new RegExp(`^${APP}/sign-in\\?return=`));
  await passwordForm(page, email);
  await expect(page).toHaveURL(`${HARBOR}/`);
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();
}

test.describe('central login on tenant sites', () => {
  test('signing in on a tenant site goes through the app host and lands back signed in (keyboard only)', async ({
    page,
    context,
  }) => {
    const user = await person(page, context);
    await page.goto(`${HARBOR}/`);
    await expect(signInLink(page)).toBeVisible();
    await expectAccessible(page);
    await signInLink(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`^${APP}/sign-in\\?return=`));
    await expect(
      page.getByText(`Sign in with your Yayatoh account to continue to ${HARBOR_HOST}.`),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByLabel('Email', { exact: true }).focus();
    await page.keyboard.type(user.email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(devPassword());
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${HARBOR}/`);
    await expect(page.getByText(`Signed in as ${user.name}`)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Arts Collective');
    await expectAccessible(page);
    // It survives a reload: the tenant host has its own session now.
    await page.reload();
    await expect(page.getByText(`Signed in as ${user.name}`)).toBeVisible();
  });

  test('with two-step verification, the challenge happens on the app host first', async ({
    page,
    context,
  }) => {
    const user = await person(page, context, { twoFactor: true });
    await page.goto(`${HARBOR}/`);
    await signInLink(page).click();
    await passwordForm(page, user.email);
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await page.getByLabel('6-digit code').fill(codeForKey(user.setupKey ?? ''));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(`${HARBOR}/`);
    await expect(page.getByText(`Signed in as ${user.name}`)).toBeVisible();
  });

  test('already signed in on the app host: continue as that account, or use another one; signing out here keeps the app host', async ({
    page,
    context,
  }) => {
    const user = await person(page, context);
    // Signed in on the app host first.
    await page.goto(`${APP}/sign-in`);
    await passwordForm(page, user.email);
    await expect(page).toHaveURL(/\/o$/);

    await page.goto(`${HARBOR}/`);
    await signInLink(page).click();
    await expect(page.getByRole('heading', { name: `Continue to ${HARBOR_HOST}` })).toBeVisible();
    await expect(page.getByText(`You're signed in as ${user.name} (${user.email}).`)).toBeVisible();
    await expectAccessible(page);
    const go = page.getByRole('button', { name: `Continue to ${HARBOR_HOST}` });
    await go.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${HARBOR}/`);
    await expect(page.getByText(`Signed in as ${user.name}`)).toBeVisible();

    // Signing out on the tenant site ends only its own session.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(signInLink(page)).toBeVisible();
    await page.goto(`${APP}/account/security`);
    await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();

    // "Use a different account" signs out on the app host and shows the form.
    await page.goto(`${HARBOR}/`);
    await signInLink(page).click();
    await page.getByRole('button', { name: 'Use a different account' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(
      page.getByText(`Sign in with your Yayatoh account to continue to ${HARBOR_HOST}.`),
    ).toBeVisible();
  });

  test('a replayed handoff code is refused', async ({ page, context }) => {
    const user = await person(page, context);
    await page.goto(`${HARBOR}/`);
    await signInLink(page).click();
    const [request] = await Promise.all([
      page.waitForRequest((r) => isHandoff(new URL(r.url()))),
      passwordForm(page, user.email),
    ]);
    await expect(page).toHaveURL(`${HARBOR}/`);
    await expect(page.getByText(`Signed in as ${user.name}`)).toBeVisible();
    // The same link again: spent.
    await page.goto(request.url());
    await expect(page).toHaveURL(`${HARBOR}/auth/error`);
    await expect(errorHeading(page)).toBeVisible();
    await expect(
      page.getByText(
        'It may have expired, been used already, or be meant for another site. Sign in again to continue.',
      ),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('a code for another site is refused there, and is then spent for its own site too', async ({
    page,
    context,
  }) => {
    const user = await person(page, context);
    let handoff = '';
    await page.route(isHandoff, (route) => {
      handoff = route.request().url();
      return route.abort();
    });
    await page.goto(`${HARBOR}/`);
    await signInLink(page).click();
    await passwordForm(page, user.email);
    await expect.poll(() => handoff).toContain('code=');
    await page.unroute(isHandoff);
    const code = new URL(handoff).searchParams.get('code') ?? '';
    expect(new URL(handoff).host).toBe(`${HARBOR_HOST}:${PORT}`);

    await page.goto(`${LAKESIDE}/auth/handoff?code=${encodeURIComponent(code)}`);
    await expect(page).toHaveURL(`${LAKESIDE}/auth/error`);
    await expect(errorHeading(page)).toBeVisible();
    await page.goto(`${LAKESIDE}/`);
    await expect(signInLink(page)).toBeVisible();

    await page.goto(`${HARBOR}/auth/handoff?code=${encodeURIComponent(code)}`);
    await expect(errorHeading(page)).toBeVisible();
    await page.goto(`${HARBOR}/`);
    await expect(signInLink(page)).toBeVisible();
  });

  test('a code only works in the browser that asked to sign in', async ({ page, context, browser }) => {
    const user = await person(page, context);
    let handoff = '';
    await page.route(isHandoff, (route) => {
      handoff = route.request().url();
      return route.abort();
    });
    await page.goto(`${HARBOR}/`);
    await signInLink(page).click();
    await passwordForm(page, user.email);
    await expect.poll(() => handoff).toContain('code=');
    // Someone else's browser (no sign-in state from this site) can't use it.
    const other = await browser.newContext();
    const stranger = await other.newPage();
    await stranger.goto(handoff);
    await expect(errorHeading(stranger)).toBeVisible();
    await stranger.goto(`${HARBOR}/`);
    await expect(signInLink(stranger)).toBeVisible();
    await other.close();
  });

  test('a tenant session cookie is valid only on its host', async ({ page, context }) => {
    const user = await person(page, context);
    await signInOnHarbor(page, user.email, user.name);
    const cookie = (await context.cookies(HARBOR)).find((c) => c.name === 'yy.session');
    expect(cookie).toBeTruthy();
    // Host-only (no Domain attribute), HttpOnly, SameSite=Lax (on HTTPS it is also `__Host-` and Secure).
    expect(cookie?.domain).toBe(HARBOR_HOST);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    // The browser doesn't send it to another tenant host…
    expect((await context.cookies(LAKESIDE)).find((c) => c.name === 'yy.session')).toBeUndefined();
    await page.goto(`${LAKESIDE}/`);
    await expect(signInLink(page)).toBeVisible();
    // …and copied there by hand, the server refuses it: the session belongs to the harbor host.
    await context.addCookies([
      { ...cookie, name: 'yy.session', value: cookie?.value ?? '', domain: LAKESIDE_HOST, path: '/' },
    ]);
    await page.goto(`${LAKESIDE}/`);
    await expect(signInLink(page)).toBeVisible();
    await expect(page.getByText(`Signed in as ${user.name}`)).toHaveCount(0);
    // Copied onto the app host, it opens nothing there either.
    await context.clearCookies({ domain: 'localhost' });
    await context.addCookies([
      { name: 'yy.session', value: cookie?.value ?? '', domain: 'localhost', path: '/' },
    ]);
    await page.goto(`${APP}/account/security`);
    await expect(page).toHaveURL(/\/sign-in/);
    // On its own host it still works.
    await page.goto(`${HARBOR}/`);
    await expect(page.getByText(`Signed in as ${user.name}`)).toBeVisible();
  });

  test('sign out everywhere ends the app host and tenant site sessions (asks first; Escape cancels)', async ({
    page,
    context,
  }) => {
    const user = await person(page, context);
    await signInOnHarbor(page, user.email, user.name);
    await page.goto(`${APP}/account/security`);
    const card = page.getByRole('region', { name: 'Sign out everywhere' });
    await expect(card.getByText(/Ends every session you have/)).toBeVisible();
    const open = card.getByRole('button', { name: 'Sign out everywhere' });
    await open.click();
    const yes = card.getByRole('button', { name: 'Yes, sign out everywhere' });
    await expect(yes).toBeFocused();
    await expect(card.getByText('Sign out of every device and site now?')).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(yes).toHaveCount(0);
    await expect(open).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(yes).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sign-in\?signedOut=everywhere$/);
    await expect(page.getByRole('status').filter({ hasText: "You're signed out everywhere." })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`${HARBOR}/`);
    await expect(signInLink(page)).toBeVisible();
    await page.goto(`${APP}/account/security`);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('only a verified tenant host can be returned to', async ({ page }) => {
    const state = 'A'.repeat(43);
    for (const back of [
      'https://evil.example/',
      `http://nobody-${Date.now()}.yayatoh.events:${PORT}/`,
      `${APP}/o`,
      `http://yayatoh.localhost:${PORT}/`,
    ]) {
      await page.goto(`${APP}/sign-in?return=${encodeURIComponent(back)}&state=${state}`);
      await expect(page.getByRole('heading', { name: 'Sign in to Yayatoh' })).toBeVisible();
      await expect(page.getByText(/to continue to/)).toHaveCount(0);
    }
  });

  test('Arabic: the tenant sign-in, the app host page and the signed-in site render right to left', async ({
    page,
    context,
  }) => {
    const user = await person(page, context);
    await page.goto(`${HARBOR}/ar`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('link', { name: 'تسجيل الدخول', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`^${APP}/ar/sign-in\\?return=`));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText(`سجّل الدخول بحسابك في Yayatoh للمتابعة إلى ${HARBOR_HOST}.`)).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(user.email);
    await page.getByLabel('كلمة المرور', { exact: true }).fill(devPassword());
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
    await expect(page).toHaveURL(`${HARBOR}/ar`);
    await expect(page.getByText(`مسجّل الدخول باسم ${user.name}`)).toBeVisible();
    await expectAccessible(page);
    await page.goto(`${HARBOR}/ar/auth/error`);
    await expect(page.getByRole('heading', { name: 'لا يمكن استخدام رابط تسجيل الدخول هذا' })).toBeVisible();
    await expectAccessible(page);
  });
});
