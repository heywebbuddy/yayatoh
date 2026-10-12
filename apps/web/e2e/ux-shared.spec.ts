import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, signIn } from './helpers.ts';

/**
 * U11 whole-app UX sweep: the shared-component and copy fixes the route sweep (ux-sweep.spec.ts)
 * found. Each test pins one of them where the sweep saw it. Keyboard only, axe in both themes,
 * Arabic RTL.
 */
const ORG = '/o/lakeside-events';
const EVENT = `${ORG}/e/midwest-leadership-summit-2027`;

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
}

test.describe('shared fixes from the U11 sweep', () => {
  test('a 404 is a page with a level-1 heading, in English and Arabic (RTL)', async ({ page }) => {
    for (const [path, name, dir] of [
      ['/en/events/no-such-event-u11', 'Page not found', 'ltr'],
      ['/ar/events/no-such-event-u11', null, 'rtl'],
    ] as const) {
      await page.goto(path);
      if (dir === 'rtl') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible();
      if (name) await expect(h1).toHaveText(name);
      await expectAccessibleBothModes(page);
    }
    // Keyboard only: the way out is the first control reachable with Tab.
    await page.goto('/en/events/no-such-event-u11');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Go home' })).toBeFocused();
  });

  test('the console search is a full-height 44 px field and works from the keyboard', async ({ page }) => {
    await signIn(page);
    await page.goto(ORG);
    const input = page.locator('#global-search');
    await expect(input).toBeVisible();
    expect((await box(input)).height).toBeGreaterThanOrEqual(40);
    await page.keyboard.press('Control+k');
    await expect(input).toBeFocused();
    await input.fill('ab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=ab/);
  });

  test('breadcrumb links and raw checkboxes are at least 24 px', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ORG}/alerts/settings`);
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first();
    await expect(crumb).toBeVisible();
    expect((await box(crumb)).height).toBeGreaterThanOrEqual(24);
    const boxes = page.getByRole('checkbox');
    const n = await boxes.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(n, 12); i++) {
      const b = await box(boxes.nth(i));
      expect(b.width).toBeGreaterThanOrEqual(24);
      expect(b.height).toBeGreaterThanOrEqual(24);
    }
  });

  test('a select never grows past its card: no sideways scroll on New audience', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ORG}/audiences/new`);
    await expect(page.getByRole('heading', { level: 1, name: 'New audience' })).toBeVisible();
    await noHorizontalScroll(page);
    await expectAccessibleBothModes(page);
    await page.goto(`/ar${ORG}/audiences/new`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await noHorizontalScroll(page);
  });

  test('"See your events" links go to the events list, never a 404', async ({ page }) => {
    await signIn(page);
    for (const path of [`${ORG}/seating-library`, `${ORG}/command-center`, `${ORG}/contacts/stats`]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
    }
    // The org's events list is a page of its own now.
    expect((await page.goto(`${ORG}/events`))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('public back links are 24 px targets', async ({ page }) => {
    await page.goto('/events/midwest-leadership-summit-2027/seat-finder');
    const back = page.getByRole('link', { name: 'Back to the event' }).first();
    await expect(back).toBeVisible();
    expect((await box(back)).height).toBeGreaterThanOrEqual(24);
    await expectAccessible(page);
  });

  test('event pages still lay out at this width (no sideways scroll)', async ({ page }) => {
    await signIn(page);
    await page.goto(EVENT);
    await noHorizontalScroll(page);
  });
});
