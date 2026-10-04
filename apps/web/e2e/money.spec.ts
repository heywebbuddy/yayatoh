import { readFileSync } from 'node:fs';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import {
  continueToPayment,
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  pickOption,
  pickWithKeyboard,
  signIn,
} from './helpers.ts';

/**
 * U5 Money dashboards: overview with a period change, payouts as a timeline with a drill-down to
 * exactly the payout's orders, sales by event, fees, CSV exports; finance permission enforced
 * (hidden in the nav and refused by URL); keyboard only; axe in both themes; Arabic RTL.
 * Each test sells in an org of its own (fake provider), so projects and reruns never collide.
 */

async function buy(browser: Browser, slug: string, buyer: string, quantity: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await pickOption(guest.getByLabel('Quantity — Supporter'), quantity);
  const email = `${buyer.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.test`;
  await guest.getByLabel('Full name').fill(buyer);
  await guest.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(guest, email);
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest).toHaveURL(/\/orders\/[A-Za-z0-9_-]{43}$/);
  await guest.context().close();
}

/** The sidebar (below 1024 px a drawer behind the menu button), as in console-nav.spec. */
async function openNav(page: Page): Promise<Locator> {
  const width = page.viewportSize()?.width ?? 1280;
  const drawer = page.locator('header details').first();
  if (width < 1024 && !(await drawer.evaluate((d: HTMLDetailsElement) => d.open)))
    await drawer.locator('> summary').click();
  const nav = page
    .getByRole('navigation')
    .filter({ has: page.locator('details[data-nav-section]') })
    .filter({ visible: true });
  await expect(nav).toBeVisible();
  return nav;
}

const moneySection = (nav: Locator) =>
  nav
    .locator('details[data-nav-section]')
    .filter({ has: nav.page().locator('summary', { hasText: 'Money' }) });

async function download(page: Page, link: ReturnType<Page['getByRole']>) {
  const [file] = await Promise.all([page.waitForEvent('download'), link.click()]);
  return readFileSync((await file.path()) ?? '', 'utf8');
}

test.describe('Money dashboards (U5)', () => {
  test('overview, a payout down to its orders, sales by event, fees and CSV exports', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const stamp = `${Date.now()}${test.info().project.name.slice(0, 1)}`;
    const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const org = owner.orgSlug ?? '';
    const slug = owner.eventSlug ?? '';
    const ada = `Ada Money ${stamp}`;
    const bo = `Bo Money ${stamp}`;

    // Empty states first: nothing sold yet, each says what to do next.
    await page.goto(`/o/${org}/money`);
    await expect(page.getByRole('heading', { name: 'Money overview', level: 1 })).toBeVisible();
    await expect(page.getByText('No money moved in this period')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show all time' })).toBeVisible();
    await expectAccessible(page);

    await buy(browser, slug, ada, '2');
    await buy(browser, slug, bo, '1');

    // Overview, reached from the sidebar's Money group.
    await page.goto(`/o/${org}`);
    const money = moneySection(await openNav(page));
    for (const item of ['Overview', 'Payouts', 'Sales by event', 'Fees'])
      await expect(money.getByRole('link', { name: item, exact: true })).toBeVisible();
    await money.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${org}/money$`));
    const gross = page.getByTestId('money-grossMinor-USD');
    await expect(gross).toContainText('$45.00');
    await expect(page.getByTestId('money-net-USD')).toHaveText('$45.00');
    await expect(page.getByRole('img', { name: 'Gross sales per day' })).toBeVisible();
    await page.getByText('Show the data').click();
    await expect(page.getByRole('table', { name: 'Gross sales per day' })).toBeVisible();
    await expectAccessibleBothModes(page);

    // Period change: by month, all time; the URL keeps it and the figures stay.
    await pickOption(page.getByLabel('Period', { exact: true }), 'all');
    await pickOption(page.getByLabel('Chart by', { exact: true }), 'month');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/period=all/);
    await expect(page).toHaveURL(/grain=month/);
    await expect(page.locator('p', { hasText: /^All time$/ })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Gross sales per month' })).toBeVisible();
    await expect(page.getByTestId('money-grossMinor-USD')).toContainText('$45.00');
    // A bad custom range says how to fix it.
    await pickOption(page.getByLabel('Period', { exact: true }), 'custom');
    await page.getByLabel('From', { exact: true }).fill('2026-12-31');
    await page.getByLabel('To', { exact: true }).fill('2026-01-01');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('The end date is before the start date.')).toBeVisible();

    const overviewCsv = await download(page, page.getByRole('link', { name: 'Export CSV' }));
    expect(overviewCsv.split('\r\n')[0]).toBe('Period starting,Currency,Gross,Refunds,Fees');

    // Before the release: the payout is upcoming, with its date.
    await page.goto(`/o/${org}/payouts`);
    const upcoming = page.getByRole('region', { name: 'Upcoming payouts' });
    await expect(upcoming.getByText(/Test Show .*: about \$42\.75/)).toBeVisible();
    await expect(upcoming.getByText('Held until release').first()).toBeVisible();
    await expect(page.getByTestId('payouts-next')).toContainText('$42.75');

    // The release job after the event (dev route; the worker runs it every 10 minutes).
    const res = await page.request.post('/api/dev/payments/settle', {
      form: { org, now: '2035-01-01T00:00:00Z' },
    });
    expect(res.status()).toBe(200);
    await page.reload();
    const settlements = page.getByRole('region', { name: 'Settlements' });
    await expect(settlements.getByRole('table')).toBeVisible();
    const after = page.getByRole('region', { name: 'Upcoming payouts' });
    await expect(after.getByText(/^Reserve comes back · Test Show .*: up to \$2\.25$/)).toBeVisible();
    await expect(after.getByText('Waiting for your payout account')).toBeVisible();
    await expectAccessibleBothModes(page);
    const payoutsCsv = await download(page, page.getByRole('link', { name: 'Export CSV' }));
    expect(payoutsCsv).toContain('Waiting for your payout account');

    // Drill down: exactly the two orders, adding up to what was released.
    await settlements
      .getByRole('link', { name: /Test Show/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/o/${org}/payouts/[0-9a-f-]{36}$`));
    await expect(page.getByRole('heading', { name: /^Payout for Test Show/, level: 1 })).toBeVisible();
    const lines = page.getByRole('region', { name: 'Orders in this payout' });
    await expect(lines.getByRole('row').filter({ hasText: ada })).toHaveCount(1);
    await expect(lines.getByRole('row').filter({ hasText: bo })).toHaveCount(1);
    await expect(lines.getByRole('table').getByRole('row')).toHaveCount(3); // header + 2 orders
    await expect(page.getByTestId('payout-lines-total')).toHaveText('$45.00');
    await expect(page.getByTestId('payout-amount')).toHaveText('$42.75');
    await expectAccessibleBothModes(page);
    const payoutCsv = await download(page, page.getByRole('link', { name: 'Export orders (CSV)' }));
    expect(payoutCsv).toContain(ada);
    expect(payoutCsv).toContain(bo);
    expect(payoutCsv.trim().split('\r\n')).toHaveLength(3);
    // The order link opens the order.
    await lines.getByRole('link', { name: new RegExp(`· ${ada}$`) }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${org}/e/${slug}/orders/[0-9a-f-]{36}$`));

    // Sales by event: the event with gross and net, linking to its finance analysis.
    await page.goto(`/o/${org}/sales-by-event`);
    const row = page.getByRole('row').filter({ hasText: 'Test Show' });
    await expect(row).toContainText('$45.00');
    await expect(page.getByRole('columnheader', { name: 'Net' })).toBeVisible();
    await expectAccessibleBothModes(page);
    const eventsCsv = await download(page, page.getByRole('link', { name: 'Export CSV' }));
    expect(eventsCsv.split('\r\n')[0]).toBe(
      'Event,Currency,Orders,Tickets,Gross,Refunds,Lost disputes,Fees,Net',
    );
    expect(eventsCsv).toContain('45.00');
    await row.getByRole('link', { name: /Test Show/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${org}/e/${slug}/analysis/finance$`));

    // Fees: the plan's rate (set by staff) and the payout's fee.
    await page.goto(`/o/${org}/fees`);
    await expect(page.getByRole('heading', { name: 'Fees', level: 1 })).toBeVisible();
    await expect(page.getByTestId('fee-rate-USD')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Fees per payout' }).getByRole('row')).toHaveCount(2);
    await expectAccessibleBothModes(page);
  });

  test('keyboard only: change the period and reach the export on the overview', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/money');
    await expect(page.getByRole('heading', { name: 'Money overview', level: 1 })).toBeVisible();
    await pickWithKeyboard(page.getByLabel('Period', { exact: true }), '90d');
    await pickWithKeyboard(page.getByLabel('Chart by', { exact: true }), 'week');
    await page.getByRole('button', { name: 'Apply' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/period=90d/);
    await expect(page).toHaveURL(/grain=week/);
    // The Money tabs are links in the tab order.
    const tabs = page.getByRole('navigation', { name: 'Money pages' });
    await tabs.getByRole('link', { name: 'Payouts' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/o\/lakeside-events\/payouts$/);
    await expect(page.getByRole('heading', { name: 'Payouts', level: 1 })).toBeVisible();
  });

  test('roles without finance access see no money pages, by nav or by URL', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    await page.goto('/o/lakeside-events');
    const money = moneySection(await openNav(page));
    await expect(money.getByRole('link', { name: 'Sales by event', exact: true })).toBeVisible();
    await expect(money.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
    await expect(money.getByRole('link', { name: 'Fees', exact: true })).toHaveCount(0);
    await expect(money.getByRole('link', { name: 'Payouts', exact: true })).toHaveCount(0);
    for (const path of ['money', 'fees', `payouts/${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}`]) {
      const r = await page.goto(`/o/lakeside-events/${path}`);
      expect(r?.status(), path).toBe(404);
    }
    for (const view of ['overview', 'payouts', 'fees', 'payout']) {
      const r = await page.request.get(`/o/lakeside-events/money/export?view=${view}`);
      expect(r.status(), view).toBe(404);
    }
    // Sales by event: counts and gross only, and its export leaves the money columns empty.
    await page.goto('/o/lakeside-events/sales-by-event');
    await expect(page.getByRole('heading', { name: 'Sales by event', level: 1 })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Net' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Money pages' })).toHaveCount(0);
    const csv = await page.request.get('/o/lakeside-events/money/export?view=events&period=all');
    expect(csv.status()).toBe(200);
    for (const line of (await csv.text()).trim().split('\r\n').slice(1)) expect(line).toMatch(/,,,,$/);
    await expectAccessible(page);
  });

  test('renders right to left in Arabic', async ({ page }) => {
    await signIn(page);
    for (const path of ['money', 'payouts', 'sales-by-event', 'fees']) {
      await page.goto(`/ar/o/lakeside-events/${path}`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    }
    await page.goto('/ar/o/lakeside-events/money');
    await expect(page.getByRole('heading', { name: 'نظرة عامة على الأموال', level: 1 })).toBeVisible();
  });
});
