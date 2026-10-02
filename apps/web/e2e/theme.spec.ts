import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  codeForKey,
  devPassword,
  EVENT,
  expectAccessibleBothModes,
  newUser,
  ownClientIp,
  signIn,
  WEDDING,
  WEDDING_OWNER,
} from './helpers.ts';

/** The canvas colours of ADR 0022 (light #F2F1F6, dark #0A0812). */
const LIGHT_CANVAS = 'rgb(242, 241, 246)';
const DARK_CANVAS = 'rgb(10, 8, 18)';

const canvas = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** The first HTML the server sends (before any script runs) carries the theme. */
async function servedTheme(page: Page, path: string): Promise<string | null> {
  const res = await page.request.get(path);
  expect(res.status()).toBe(200);
  return /<html[^>]*\sdata-theme="([a-z]+)"/.exec(await res.text())?.[1] ?? null;
}

const themeButton = (page: Page) => page.getByRole('button', { name: /^Colour theme: / }).first();

async function choose(page: Page, theme: 'Light' | 'Dark' | 'System') {
  await themeButton(page).click();
  await page.getByRole('menuitemradio', { name: theme }).click();
}

async function anonymous(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test.describe('theme (design system v2)', () => {
  test('light is the default for everyone, in the first HTML and on screen', async ({ browser }) => {
    const page = await anonymous(browser);
    expect(await servedTheme(page, '/events')).toBe('light');
    await page.goto('/events');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await canvas(page)).toBe(LIGHT_CANVAS);
    await expect(themeButton(page)).toHaveAccessibleName('Colour theme: Light');
  });

  test('dark persists across reload with no flash; public pages follow', async ({ browser }) => {
    const page = await anonymous(browser);
    await page.goto('/events/midwest-leadership-summit-2027');
    await choose(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await canvas(page)).toBe(DARK_CANVAS);
    // The cookie is read on the server: the very first HTML of the next request is already dark.
    await expect.poll(() => servedTheme(page, '/events/midwest-leadership-summit-2027')).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await servedTheme(page, '/events')).toBe('dark');
    expect(await servedTheme(page, '/sign-in')).toBe('dark');
    await expect(themeButton(page)).toHaveAccessibleName('Colour theme: Dark');
    // And back to light.
    await choose(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => servedTheme(page, '/events')).toBe('light');
  });

  test('"System" follows the emulated prefers-color-scheme', async ({ browser }) => {
    const page = await anonymous(browser);
    await page.goto('/events');
    await choose(page, 'System');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => canvas(page)).toBe(DARK_CANVAS);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => canvas(page)).toBe(LIGHT_CANVAS);
    await expect.poll(() => servedTheme(page, '/events')).toBe('system');
    await page.reload();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => canvas(page)).toBe(DARK_CANVAS);
  });

  test('the switch works from the keyboard (menu: arrows, Enter, Esc)', async ({ browser }) => {
    const page = await anonymous(browser);
    await page.goto('/events');
    await themeButton(page).focus();
    await page.keyboard.press('Enter');
    const light = page.getByRole('menuitemradio', { name: 'Light' });
    await expect(light).toBeFocused();
    await expect(light).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(themeButton(page)).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('a signed-in choice is saved to the profile and follows the person to a new browser', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // An owner needs two-step verification to open the console.
    const user = await newUser(page, { org: true, event: 'published', twoFactor: true });
    await page.goto(`/o/${user.orgSlug}`);
    await choose(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => servedTheme(page, `/o/${user.orgSlug}`)).toBe('dark');
    // A second browser with no theme cookie: signing in brings the saved choice.
    const ctx2 = await browser.newContext();
    await ownClientIp(ctx2);
    const other = await ctx2.newPage();
    await other.goto('/sign-in');
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
    await other.getByLabel('Email', { exact: true }).fill(user.email);
    await other.getByLabel('Password', { exact: true }).fill(devPassword());
    await other.getByRole('button', { name: 'Sign in', exact: true }).click();
    await other.getByLabel('6-digit code').fill(codeForKey(user.setupKey ?? ''));
    await other.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(other).toHaveURL(new RegExp(`/o/${user.orgSlug}$`));
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await servedTheme(other, `/o/${user.orgSlug}`)).toBe('dark');
    await ctx2.close();
    await ctx.close();
  });
});

test.describe('shells and reference screens pass axe in light and dark', () => {
  // axe runs twice per page (light, then dark) on the heaviest screens.
  test.slow();
  const SCREENS = [
    { name: 'console home', path: '/o/lakeside-events', who: 'owner' },
    { name: 'Command Center', path: `${EVENT}/command-center`, who: 'owner' },
    { name: 'event Guests tab', path: `${WEDDING}/guests`, who: 'wedding' },
    { name: 'public event page', path: '/events/midwest-leadership-summit-2027', who: null },
    { name: 'marketplace', path: '/events', who: null },
    { name: 'sign-in', path: '/sign-in', who: null },
    { name: 'Scan PWA', path: '/scan', who: null },
    { name: 'style guide', path: '/dev/design', who: null },
  ] as const;
  for (const s of SCREENS) {
    test(`${s.name}`, async ({ page }) => {
      if (s.who === 'owner') await signIn(page);
      if (s.who === 'wedding') await signIn(page, WEDDING_OWNER);
      const res = await page.goto(s.path);
      expect(res?.status()).toBe(200);
      // No horizontal page scroll at any breakpoint.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await expectAccessibleBothModes(page);
    });
  }
});

test.describe('the console shell in Arabic (RTL)', () => {
  test.slow();
  test('mirrors: the sidebar on the right, the drawer from the right, axe in both modes', async ({
    page,
  }) => {
    await signIn(page);
    const res = await page.goto('/ar/o/lakeside-events');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    const width = page.viewportSize()?.width ?? 0;
    const sidebar = page.locator('nav[aria-label]').first();
    if (width >= 1024) {
      const box = await sidebar.boundingBox();
      expect(box?.x ?? 0).toBeGreaterThan(width / 2);
    } else {
      await page.locator('summary').filter({ hasText: 'فتح القائمة' }).click();
      const drawer = page.locator('details[open] nav').first();
      await expect(drawer).toBeVisible();
      const box = await drawer.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(width - 20);
      await page.keyboard.press('Escape');
    }
    // The theme switch is there in Arabic too.
    await expect(page.getByRole('button', { name: /^سمة الألوان: / })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
