import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { formatMoney, money } from '@yayatoh/kernel';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { warehouseScenario } from '@yayatoh/testing';
import { expectAccessibleBothModes, expectPicked, newUser } from './helpers.ts';

// Tickets are signed with the org's keys: seal them under the web server's key vault.
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

/**
 * M6.2a org analytics, end to end: a fresh org with the warehouse scenario (USD sales, a comp, a
 * refund, a check-in; a EUR sale and refund; an ended event with two no-shows), read by the owner
 * (with money), a viewer (counts only) and a scanner (refused). Filters, the period switch, the
 * empty state, validation, the rebuild, keyboard-only use, axe in both themes and Arabic RTL.
 */
type Scenario = Awaited<ReturnType<typeof warehouseScenario>>;

async function orgWithData(page: Page): Promise<{ slug: string; s: Scenario }> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return { slug, s: await warehouseScenario(org.orgId) };
}

async function member(browser: Browser, slug: string, role: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await newUser(page, { join: [`${slug}:${role}`] });
  return page;
}

/** The org navigation's Analytics item (behind "Open menu" on narrow screens). */
async function openAnalyticsFromNav(page: Page) {
  const nav = page.getByRole('link', { name: 'Analytics', exact: true }).first();
  if (!(await nav.isVisible())) await page.locator('summary').filter({ hasText: 'Open menu' }).click();
  await nav.click();
}

const usd = (minor: number) => formatMoney(money(minor, 'USD'), 'en');
const eur = (minor: number) => formatMoney(money(minor, 'EUR'), 'en');

test.describe('org analytics (M6.2a)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the owner sees every figure, revenue per currency, top events and the period switch', async ({
    page,
  }) => {
    const { slug, s } = await orgWithData(page);
    await page.goto(`/o/${slug}`);
    await openAnalyticsFromNav(page);
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/analytics`));
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await expect(page.getByTestId('analytics-registrations')).toContainText(String(s.expected.registrations));
    await expect(page.getByTestId('analytics-tickets')).toContainText(String(s.expected.tickets));
    await expect(page.getByTestId('analytics-compTickets')).toContainText(String(s.expected.compTickets));
    await expect(page.getByTestId('analytics-checkins')).toContainText(String(s.expected.checkins));
    await expect(page.getByTestId('analytics-noShows')).toContainText(String(s.expected.noShows));
    // Money per currency, never added together.
    await expect(page.getByTestId('analytics-revenue-USD')).toContainText(usd(s.expected.net.USD ?? 0));
    await expect(page.getByTestId('analytics-revenue-EUR')).toContainText(eur(s.expected.net.EUR ?? 0));
    await expect(page.getByTestId('analytics-revenue-EUR')).toContainText(`${eur(500)} refunded`);
    // Top events: the live event leads (2 net tickets, 3 registrations) and links to its home.
    const top = page.getByRole('region', { name: 'Top events', exact: true });
    await expect(top.getByRole('link', { name: 'Harbour Lights' })).toBeVisible();
    await expect(top.locator('tbody tr')).toHaveCount(3);
    // The period switch: Day is current; Month shows one or two rows (the default 30 days).
    await expect(page.getByTestId('analytics-view-day')).toHaveAttribute('aria-current', 'page');
    const days = page.getByRole('region', { name: 'Figures by period' }).locator('tbody tr');
    await expect(days).toHaveCount(30);
    await page.getByTestId('analytics-view-month').click();
    await expect(page).toHaveURL(/view=month/);
    await expect(page.getByTestId('analytics-view-month')).toHaveAttribute('aria-current', 'page');
    expect(await days.count()).toBeLessThanOrEqual(2);
    await page.getByTestId('analytics-view-week').click();
    await expect(page.getByTestId('analytics-view-week')).toHaveAttribute('aria-current', 'page');
    await expect(days.first()).toContainText('Week of');
    // The same figures survive a reload (the URL holds the filters).
    await page.reload();
    await expect(page.getByTestId('analytics-view-week')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('analytics-registrations')).toContainText(String(s.expected.registrations));
    await expectAccessibleBothModes(page);
  });

  test('keyboard only: filter to one event and switch the period', async ({ page }) => {
    const { slug, s } = await orgWithData(page);
    await page.goto(`/o/${slug}/analytics`);
    await page.getByLabel('Event', { exact: true }).focus();
    await page.keyboard.type('Harbour');
    await expectPicked(page.getByLabel('Event', { exact: true }), s.events.live.id);
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('analytics-apply')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`event=${s.events.live.id}`));
    await expect(page.getByTestId('analytics-registrations')).toContainText(
      String(s.expected.liveRegistrations),
    );
    await expect(page.getByTestId('analytics-noShows')).toContainText('0');
    // The EUR event is filtered out: no EUR revenue tile.
    await expect(page.getByTestId('analytics-revenue-EUR')).toHaveCount(0);
    await page.getByTestId('analytics-view-month').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('analytics-view-month')).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(new RegExp(`event=${s.events.live.id}`));
  });

  test('says what is wrong with a period, and what to do when there is nothing yet', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const slug = owner.orgSlug as string;
    await page.goto(`/o/${slug}/analytics`);
    await expect(page.getByText('Nothing in this period yet')).toBeVisible();
    await expect(page.getByText('Try a longer period or another event')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.getByRole('link', { name: 'Show the last 12 months' }).click();
    await expect(page).toHaveURL(/view=month/);
    await expect(page.getByTestId('analytics-view-month')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Nothing in this period yet')).toBeVisible();

    await page.getByLabel('From').fill('2027-03-10');
    await page.getByLabel('To').fill('2027-03-01');
    await page.getByTestId('analytics-apply').click();
    await expect(page.getByText('The end date is before the start date.')).toBeVisible();
    await expect(page.getByLabel('To')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('From')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('From').fill('2023-01-01');
    await page.getByLabel('To').fill('2026-01-01');
    await page.getByTestId('analytics-apply').click();
    await expect(page.getByText('Choose a period of two years or less.')).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test('a viewer sees the counts but no money and no rebuild; a scanner is refused', async ({
    page,
    browser,
  }) => {
    const { slug, s } = await orgWithData(page);
    const viewer = await member(browser, slug, 'viewer');
    await viewer.goto(`/o/${slug}`);
    await openAnalyticsFromNav(viewer);
    await expect(viewer).toHaveURL(new RegExp(`/o/${slug}/analytics`));
    await expect(viewer.getByTestId('analytics-registrations')).toContainText(
      String(s.expected.registrations),
    );
    await expect(viewer.getByRole('heading', { name: 'Revenue' })).toHaveCount(0);
    await expect(viewer.locator('[data-testid^="analytics-revenue-"]')).toHaveCount(0);
    const main = await viewer.locator('main').innerText();
    expect(main).not.toMatch(/\$|€|USD|EUR/);
    await expect(viewer.getByTestId('analytics-rebuild-card')).toHaveCount(0);
    await expect(viewer.getByText('before platform fees')).toHaveCount(0);

    const scanner = await member(browser, slug, 'scanner');
    const res = await scanner.goto(`/o/${slug}/analytics`);
    expect(res?.status()).toBe(404);
  });

  test('the owner rebuilds the analytics: started, then done, with the same figures', async ({ page }) => {
    const { slug, s } = await orgWithData(page);
    await page.goto(`/o/${slug}/analytics`);
    const card = page.getByTestId('analytics-rebuild-card');
    await expect(card).not.toContainText('Running');
    await card.getByTestId('analytics-rebuild').click();
    await expect(card.getByText('Rebuild started')).toBeVisible();
    await expect(card.getByTestId('analytics-rebuild-status')).toContainText('Running');
    await expect(card.getByTestId('analytics-rebuild')).toBeDisabled();
    // The worker's job, as dev runs it.
    const res = await page.request.post('/api/dev/analytics/backfill', { form: { org: slug } });
    expect(res.ok()).toBe(true);
    await page.reload();
    await expect(card.getByTestId('analytics-rebuild-status')).toContainText('Done');
    await expect(card.getByTestId('analytics-rebuild-status')).toContainText('4 events checked, 0 updated');
    await expect(page.getByTestId('analytics-registrations')).toContainText(String(s.expected.registrations));
    await expect(card.getByTestId('analytics-rebuild')).toBeEnabled();
  });

  test('Arabic: right to left, translated, with the same figures', async ({ page }) => {
    const { slug, s } = await orgWithData(page);
    await page.goto(`/ar/o/${slug}/analytics`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'التحليلات' })).toBeVisible();
    const n = new Intl.NumberFormat('ar').format(s.expected.registrations);
    await expect(page.getByTestId('analytics-registrations')).toContainText(n);
    await expect(page.getByRole('navigation', { name: 'العرض حسب' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
