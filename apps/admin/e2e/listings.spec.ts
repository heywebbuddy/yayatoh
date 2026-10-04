import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  MARKET,
  makeStaff,
  replayForm,
  serverForm,
  signInStaff,
  WEB,
  webPage,
  webUser,
} from './helpers.ts';

/**
 * M6.14a marketplace listing moderation: staff find a live listing, hide it with a reason (a reason
 * is required), it leaves the marketplace search on the next event, the Hidden tab shows it with
 * the reason, and showing it again brings it back. Keyboard only, axe in both themes, finance
 * staff neither see nor use it. Each test makes its own org (one published, listed event).
 */

/** A fresh org with one listed event; its name is "Test Show {stamp}". */
async function listedEvent(browser: Browser) {
  const owner = await webPage(browser);
  const user = await webUser(owner, { org: true, event: true, signIn: false });
  await owner.close();
  const slug = user.eventSlug ?? '';
  const stamp = slug.replace(/^test-show-/, '');
  return { orgSlug: user.orgSlug ?? '', slug, stamp, name: `Test Show ${stamp}` };
}

/** What the worker does after a listing change: run the search indexer (the web's dev drain). */
async function drainSearch(page: Page, orgSlug: string) {
  const res = await page.request.post(`${WEB}/api/dev/search/run`, { form: { org: orgSlug } });
  expect(res.status()).toBe(200);
}

async function inSearch(page: Page, stamp: string, name: string, visible: boolean) {
  const market = await (await page.context().browser()?.newContext())?.newPage();
  if (!market) throw new Error('no browser');
  await market.goto(`${MARKET}/search?q=${stamp}`);
  const link = market.getByRole('link', { name, exact: true });
  if (visible) await expect(link).toBeVisible();
  else {
    await expect(market.getByText('No events match these filters')).toBeVisible();
    await expect(link).toHaveCount(0);
  }
  await market.context().close();
}

async function bothThemes(page: Page) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await expectAccessible(page);
  }
}

test.describe('marketplace listing moderation (M6.14a)', () => {
  test('staff hide a listing with a reason; it leaves search; showing it again brings it back', async ({
    page,
    browser,
  }) => {
    const e = await listedEvent(browser);
    await drainSearch(page, e.orgSlug);
    await inSearch(page, e.stamp, e.name, true);

    await signInStaff(page);
    await page
      .getByRole('navigation', { name: 'Staff console' })
      .getByRole('link', { name: 'Marketplace listings' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Marketplace listings' })).toBeVisible();
    await page.getByLabel('Event or organizer').fill(e.stamp);
    await page.getByRole('button', { name: 'Find' }).click();
    const card = page.getByRole('article', { name: e.name });
    await expect(card).toBeVisible();
    await expect(card.getByText('Listed', { exact: true })).toBeVisible();
    await bothThemes(page);

    // A reason is required.
    await card.getByRole('button', { name: 'Hide from marketplace' }).click();
    const again = page.getByRole('article', { name: e.name });
    await expect(again.getByText('Give a reason.')).toBeVisible();
    await expect(again.getByLabel('Reason')).toHaveAttribute('aria-invalid', 'true');

    await again.getByLabel('Reason').fill('Misleading ticket prices');
    await again.getByRole('button', { name: 'Hide from marketplace' }).click();
    await expect(
      page.getByText('Hidden from the marketplace. Search drops it within seconds.'),
    ).toBeVisible();

    // The Hidden tab shows it with the reason; it is gone from search after the indexer runs.
    await page.getByRole('link', { name: 'Hidden', exact: true }).click();
    await page.getByLabel('Event or organizer').fill(e.stamp);
    await page.getByRole('button', { name: 'Find' }).click();
    const hidden = page.getByRole('article', { name: e.name });
    await expect(hidden.getByText('Misleading ticket prices')).toBeVisible();
    await expect(hidden.getByText('Hidden', { exact: true })).toBeVisible();
    await bothThemes(page);
    await drainSearch(page, e.orgSlug);
    await inSearch(page, e.stamp, e.name, false);
    // The persisted state survives a reload.
    await page.reload();
    await expect(page.getByRole('article', { name: e.name })).toBeVisible();

    // Show it again (reason required too).
    await hidden.getByLabel('Reason').fill('Organizer corrected the prices');
    await hidden.getByRole('button', { name: 'Show on marketplace' }).click();
    await expect(
      page.getByText('Back on the marketplace. Search shows it again within seconds.'),
    ).toBeVisible();
    await drainSearch(page, e.orgSlug);
    await inSearch(page, e.stamp, e.name, true);
  });

  test('keyboard only: find, give a reason and hide', async ({ page, browser }) => {
    const e = await listedEvent(browser);
    await signInStaff(page);
    await page.goto(`/listings?q=${e.stamp}`);
    const card = page.getByRole('article', { name: e.name });
    await card.getByLabel('Reason').focus();
    await page.keyboard.type('Spam listing');
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Hide from marketplace' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Hidden from the marketplace. Search drops it within seconds.'),
    ).toBeVisible();
    await page.goto(`/listings?state=hidden&q=${e.stamp}`);
    await expect(page.getByRole('article', { name: e.name }).getByText('Spam listing')).toBeVisible();
    // An empty search says so.
    await page.goto(`/listings?q=${e.stamp}zzz`);
    await expect(page.getByText('No listings match that search')).toBeVisible();
  });

  test('finance staff neither see nor use listing moderation', async ({ page, browser }) => {
    const e = await listedEvent(browser);
    await signInStaff(page);
    await page.goto(`/listings?q=${e.stamp}`);
    const form = await serverForm(page, `Hide ${e.name}`);
    const finance = await webPage(browser);
    const user = await webUser(finance, { signIn: false });
    makeStaff(user.email, 'finance');
    const other = await (await browser.newContext({ baseURL: new URL(page.url()).origin })).newPage();
    await signInStaff(other, user.email);
    await expect(other.getByRole('link', { name: 'Marketplace listings' })).toHaveCount(0);
    await other.goto('/listings');
    await expect(other).toHaveURL(/\/not-staff$/);
    // A crafted submission of an admin's form changes nothing.
    await replayForm(other, form, { reason: 'Finance tries' });
    await expect(other).toHaveURL(/\/not-staff$/);
    await page.goto(`/listings?q=${e.stamp}`);
    await expect(
      page.getByRole('article', { name: e.name }).getByText('Listed', { exact: true }),
    ).toBeVisible();
  });
});
