import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, newUser, signIn } from './helpers.ts';

/**
 * U2 (UX review 1): the org console's grouped, collapsible sidebar, the Create menu, the Help
 * entry, the breadcrumb trail, the "How it works" panels and empty states with a next step.
 */
const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const SECTIONS = ['Events', 'Audience & marketing', 'Money', 'Site & content', 'Settings'];

/** The sidebar (below 1024 px it is a drawer behind the menu button). */
async function openNav(page: Page): Promise<Locator> {
  const width = page.viewportSize()?.width ?? 1280;
  const drawer = page.locator('header details').first();
  if (width < 1024 && !(await drawer.evaluate((d: HTMLDetailsElement) => d.open)))
    await drawer.locator('> summary').click();
  // Any locale: the visible navigation holding the grouped sections.
  const nav = page
    .getByRole('navigation')
    .filter({ has: page.locator('details[data-nav-section]') })
    .filter({ visible: true });
  await expect(nav).toBeVisible();
  return nav;
}

const section = (nav: Locator, name: string) =>
  nav.locator('details[data-nav-section]').filter({
    has: nav.page().locator('summary', { hasText: name }),
  });

test.describe('grouped sidebar', () => {
  test('five sections in order; every group navigates; the trail names the section', async ({ page }) => {
    await signIn(page);
    await page.goto(ORG);
    const nav = await openNav(page);
    await expect(nav.locator('details[data-nav-section] > summary')).toHaveText(SECTIONS);
    // One page from each group, with the breadcrumb organization › section › page.
    const visits: [string, string, RegExp][] = [
      ['Events', 'Venues', /\/venues$/],
      ['Audience & marketing', 'Campaigns', /\/campaigns$/],
      ['Money', 'Payouts', /\/payouts$/],
      ['Site & content', 'Domains', /\/domains$/],
      ['Settings', 'Team', /\/team$/],
    ];
    for (const [group, item, url] of visits) {
      const n = await openNav(page);
      await section(n, group).getByRole('link', { name: item, exact: true }).click();
      await expect(page).toHaveURL(url);
      const trail = page.getByTestId('org-trail');
      await expect(trail.getByRole('link', { name: 'Lakeside Events' })).toBeVisible();
      await expect(trail).toContainText(group);
      await expect(trail.locator('[aria-current="page"]')).toHaveText(item);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    await expectAccessibleBothModes(page);
  });

  test('sections collapse by keyboard and stay as left after a reload', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ORG}/venues`);
    let nav = await openNav(page);
    const money = section(nav, 'Money');
    await expect(money).toHaveAttribute('open', '');
    await expect(money.getByRole('link', { name: 'Payouts', exact: true })).toBeVisible();
    await money.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(money).not.toHaveAttribute('open', '');
    await expect(money.getByRole('link', { name: 'Payouts', exact: true })).toBeHidden();
    await page.reload();
    nav = await openNav(page);
    await expect(section(nav, 'Money')).not.toHaveAttribute('open', '');
    await expect(section(nav, 'Events')).toHaveAttribute('open', '');
    // The section holding the current page always opens, whatever was saved.
    await page.goto(`${ORG}/payouts`);
    nav = await openNav(page);
    await expect(section(nav, 'Money')).toHaveAttribute('open', '');
    await expect(section(nav, 'Money').getByRole('link', { name: 'Payouts' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Opening it again by keyboard is remembered too.
    await page.goto(`${ORG}/venues`);
    nav = await openNav(page);
    await section(nav, 'Money').locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(section(nav, 'Money')).toHaveAttribute('open', '');
    await page.reload();
    nav = await openNav(page);
    await expect(section(nav, 'Money')).toHaveAttribute('open', '');
  });

  test('the viewer sees only the groups their role allows', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(ORG);
    const nav = await openNav(page);
    await expect(nav.getByRole('link', { name: 'Venues', exact: true })).toBeVisible();
    for (const hidden of ['Payouts', 'Finance', 'Domains', 'Settings', 'API keys', 'Public site']) {
      await expect(nav.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
    // No Create menu for a read-only role; the refused pages stay refused by URL.
    await expect(page.getByTestId('create-menu')).toHaveCount(0);
    const res = await page.goto(`${ORG}/finance`);
    expect(res?.status()).toBe(404);
  });

  test('the door role (scanner) sees only the home and their notifications', async ({ page }) => {
    await newUser(page, { join: ['lakeside-events:scanner'] });
    await page.goto(ORG);
    const nav = await openNav(page);
    await expect(nav.locator('details[data-nav-section] > summary')).toHaveText(['Events', 'Settings']);
    await expect(nav.locator('details[data-nav-section] a')).toHaveText(['Home', 'Notifications']);
    await expect(page.getByTestId('create-menu')).toHaveCount(0);
    // Their home sends them to the Scan app instead of an event list they can't read.
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Open the Scan app' }).click();
    await expect(page).toHaveURL(/\/scan/);
    const res = await page.goto(`${ORG}/finance`);
    expect(res?.status()).toBe(404);
  });

  test('Arabic: the grouped sidebar renders right to left', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${ORG}/venues`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const nav = await openNav(page);
    await expect(nav.locator('details[data-nav-section] > summary').first()).toHaveText('الفعاليات');
    await expect(page.getByTestId('org-trail')).toContainText('الفعاليات');
    await expectAccessible(page);
  });
});

test.describe('Create menu and Help', () => {
  test('keyboard: open the menu, see every entry, go to a new venue', async ({ page }) => {
    await signIn(page);
    await page.goto(ORG);
    const trigger = page.getByRole('button', { name: 'Create', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Create' });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Event',
      'Series',
      'Template',
      'Venue',
      'Coupon',
      'Page or blog post',
    ]);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Venue' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/venues#new-venue$/);
    await expect(page.locator('#new-venue')).toBeInViewport();
  });

  test('each entry opens its page', async ({ page }) => {
    await signIn(page);
    const targets: [string, RegExp][] = [
      ['Event', /\/events\/new\/guided$/],
      ['Series', /\/series#new-series$/],
      ['Template', /\/templates#new-template$/],
      ['Coupon', /\/coupons$/],
      ['Page or blog post', /\/content\/new$/],
    ];
    for (const [name, url] of targets) {
      await page.goto(ORG);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
    // Create › Template lands on the open "How templates work" panel.
    await page.goto(`${ORG}/templates#new-template`);
    await expect(page.locator('#new-template')).toHaveAttribute('open', '');
  });

  test('Help opens the platform help center', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ORG}/venues`);
    await page.getByRole('link', { name: 'Help', exact: true }).click();
    await expect(page).toHaveURL(/\/help$/);
  });
});

test.describe('How it works panels', () => {
  test('collapse, remembered after a reload, with a guide link', async ({ page }) => {
    await signIn(page);
    await page.goto(`${ORG}/domains`);
    const panel = page.locator('details[data-help-topic="domains"]');
    const summary = panel.locator('summary');
    await expect(summary).toContainText('How custom domains work');
    await expect(panel).toHaveAttribute('open', '');
    await expect(panel.getByRole('listitem')).toHaveCount(4);
    await expect(panel.getByRole('link', { name: 'Read the guide' })).toHaveAttribute(
      'href',
      '/help/search?q=custom%20domain',
    );
    await expectAccessibleBothModes(page);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(panel).not.toHaveAttribute('open', '');
    await page.reload();
    await expect(page.locator('details[data-help-topic="domains"]')).not.toHaveAttribute('open', '');
    // Other pages' panels are unaffected.
    await page.goto(`${ORG}/payouts`);
    await expect(page.locator('details[data-help-topic="payouts"]')).toHaveAttribute('open', '');
    await page.goto(`${ORG}/domains`);
    await page.locator('details[data-help-topic="domains"] summary').click();
    await expect(page.locator('details[data-help-topic="domains"]')).toHaveAttribute('open', '');
  });

  test('every page named in the review has its panel', async ({ page }) => {
    await signIn(page);
    const pages: [string, string][] = [
      [`${ORG}/domains`, 'domains'],
      [`${ORG}/templates`, 'templates'],
      [`${ORG}/series`, 'series'],
      [`${ORG}/payouts`, 'payouts'],
      [`${ORG}/sending`, 'sending'],
      [`${ORG}/coupons`, 'coupons'],
      [`${ORG}/events/new`, 'eventType'],
      [`${ORG}/e/lakeside-open-house/details`, 'eventType'],
    ];
    for (const [url, topic] of pages) {
      await page.goto(url);
      await expect(page.locator(`details[data-help-topic="${topic}"]`)).toBeVisible();
    }
  });

  test('Arabic panel', async ({ page }) => {
    await signIn(page);
    await page.goto(`/ar${ORG}/series`);
    await expect(page.locator('details[data-help-topic="series"] summary')).toContainText('كيف تعمل السلاسل');
    await expectAccessible(page);
  });
});

test.describe('empty states lead somewhere', () => {
  test('a new organization: venues and coupons offer the next step', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const base = `/o/${owner.orgSlug}`;

    await page.goto(`${base}/venues`);
    const add = page.getByRole('link', { name: 'Add your first venue' });
    await expect(add).toBeVisible();
    await expectAccessible(page);
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/venues#new-venue$/);

    await page.goto(`${base}/coupons`);
    await expect(page.getByText('No events to add codes to')).toBeVisible();
    await page.getByRole('link', { name: 'Create an event' }).click();
    await expect(page).toHaveURL(/\/events\/new\/guided$/);

    await page.goto(`${base}/series`);
    await page.getByRole('link', { name: 'Start your first series' }).click();
    await expect(page).toHaveURL(/\/series#new-series$/);
    await expect(page.getByRole('heading', { name: 'New series' })).toBeInViewport();
  });
});
