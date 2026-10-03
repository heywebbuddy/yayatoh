import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type ContactStatsScenario, contactStatsScenario } from '@yayatoh/testing';
import { expectAccessible, newUser } from './helpers.ts';

// Tickets are signed with the org's keys: seal them under the web server's key vault.
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

/** A fresh org (its owner signed in on `page`) holding the M6.1b John Doe scenario. */
async function orgWithJohn(page: Page): Promise<{ slug: string; s: ContactStatsScenario }> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return { slug, s: await contactStatsScenario(org.orgId) };
}

/** Another member of the org, signed in in their own browser context. */
async function member(browser: Browser, slug: string, role: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await newUser(page, { join: [`${slug}:${role}`] });
  return { page, close: () => ctx.close() };
}

const count = (page: Page) => page.getByTestId('audience-count');
const previewNames = async (page: Page) =>
  (await page.getByRole('table').locator('tbody tr td:first-child').allInnerTexts()).sort();

test.describe('contact stats (M6.1b)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the contact page shows John Doe exactly, and survives a reload', async ({ page }) => {
    const { slug, s } = await orgWithJohn(page);
    await page.goto(`/o/${slug}/contacts/${s.people.john.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'John Doe' })).toBeVisible();
    await expect(page.getByText(s.people.john.email)).toBeVisible();
    const check = async () => {
      await expect(page.getByTestId('stat-events')).toHaveText('3');
      await expect(page.getByTestId('stat-attended')).toHaveText('2');
      await expect(page.getByTestId('stat-sessions')).toHaveText('4');
      await expect(page.getByTestId('stat-campaigns')).toHaveText('2');
      await expect(page.getByTestId('stat-ltv')).toContainText('$1,800.00');
      await expect(page.getByTestId('stat-ltv')).toContainText('3 paid orders');
      await expect(page.getByTestId('stat-engagement')).toHaveText('64 / 100');
      await expect(page.getByTestId('stat-no-show')).toHaveText('14.3%');
      // The formulas are written out next to the numbers.
      await expect(
        page.getByText('10 × 2 events attended + 5 × 4 sessions + 2 × 2 campaigns opened = 44 points.'),
      ).toBeVisible();
      await expect(
        page.getByText('(0 no-shows + 1) ÷ (2 past registrations + 5) = 14.3%.', { exact: false }),
      ).toBeVisible();
      const rfm = page.getByTestId('stat-rfm');
      await expect(rfm.getByText('Frequency')).toBeVisible();
      await expect(rfm.getByText('Monetary')).toBeVisible();
      await expect(rfm).toContainText('4 of 5');
    };
    await check();
    await expectAccessible(page);
    await page.reload();
    await check();
  });

  test('contact insights: totals, distributions with their tables, keyboard only', async ({ page }) => {
    const { slug } = await orgWithJohn(page);
    await page.goto(`/o/${slug}/audiences`);
    // Keyboard: the secondary action leads to the insights.
    const insights = page.getByRole('link', { name: 'Contact insights' });
    await insights.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Contact insights' })).toBeVisible();
    await expect(page.getByTestId('org-contacts')).toHaveText('4');
    await expect(page.getByTestId('org-participants')).toHaveText('4');
    await expect(page.getByTestId('org-attendedAny')).toHaveText('2');
    await expect(page.getByTestId('org-averageEngagement')).toHaveText('23');
    await expect(page.getByTestId('org-noShowRate')).toHaveText('40.0%');
    // The engagement chart's data table, opened with the keyboard.
    const summary = page.locator('summary', { hasText: 'Show the data' }).first();
    await summary.focus();
    await page.keyboard.press('Enter');
    const table = page.locator('details[open] table').first();
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(5);
    await expect(table.locator('tbody tr').first()).toContainText('0–19');
    await expect(table.locator('tbody tr').first()).toContainText('2');
    // Lifetime value per currency (the owner can read finance).
    const value = page.getByRole('region', { name: 'Lifetime value' });
    await expect(value.getByRole('table')).toContainText('$4,000.00');
    await expect(value.getByRole('table')).toContainText('$1,800.00');
    await expectAccessible(page);
  });

  test('the timeline header on the attendee page shows the stats and links to the contact', async ({
    page,
  }) => {
    const { slug, s } = await orgWithJohn(page);
    await page.goto(`/o/${slug}/e/${s.eventSlugs.b}/attendees?a=${s.johnAttendeeAtB}`);
    const header = page.getByTestId('timeline-stats');
    await expect(header).toContainText('Engagement 64 · No-show 14.3% · Lifetime $1,800.00');
    await expectAccessible(page);
    const link = header.getByRole('link', { name: 'View contact' });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'John Doe' })).toBeVisible();
  });

  test('a segment "LTV > $1,000 and no-show propensity < 20 %", built with the keyboard', async ({
    page,
  }) => {
    const { slug } = await orgWithJohn(page);
    await page.goto(`/o/${slug}/audiences/new`);
    await expect(count(page)).toHaveText('4 people match');
    // Lifetime value: choose the condition type and add it with the keyboard.
    const type = page.getByLabel('New condition').first();
    await type.focus();
    await type.selectOption('ltv');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Add condition' }).first()).toBeFocused();
    await page.keyboard.press('Enter');
    const ltv = page.getByRole('group', { name: 'Condition 1: Lifetime value' });
    await expect(ltv).toBeVisible();
    await expect(ltv.getByLabel('Comparison')).toHaveValue('gt');
    await ltv.getByLabel('Amount').fill('500');
    await expect(count(page)).toHaveText('3 people match');
    await expect.poll(() => previewNames(page)).toEqual(['John Doe', 'Mia Lane', 'Ray Park']);
    await ltv.getByLabel('Amount').fill('1000');
    await expect(count(page)).toHaveText('2 people match');

    // No-show propensity under 20 %.
    await type.selectOption('stats');
    await page.getByRole('button', { name: 'Add condition' }).first().click();
    const stats = page.getByRole('group', { name: 'Condition 2: Contact stats' });
    await stats.getByLabel('Stat').selectOption('noShowPct');
    await stats.getByLabel('Comparison').selectOption('lt');
    // Validation: a percentage over 100 is not a condition yet.
    await stats.getByLabel('Percent').fill('120');
    await expect(page.getByText('Finish the highlighted conditions to see who matches.')).toBeVisible();
    await stats.getByLabel('Percent').fill('20');
    await expect(page.getByText('Finish the highlighted conditions to see who matches.')).toHaveCount(0);
    await expect(count(page)).toHaveText('2 people match');
    await expect.poll(() => previewNames(page)).toEqual(['John Doe', 'Ray Park']);
    // Lower the amount again: Mia (two no-shows, 42.9 %) stays out.
    await ltv.getByLabel('Amount').fill('500');
    await expect(count(page)).toHaveText('2 people match');
    await expectAccessible(page);

    await page.getByLabel('Audience name').fill('Valuable and reliable');
    await page.getByRole('button', { name: 'Save audience' }).click();
    await expect(page.getByText('Audience saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Valuable and reliable' })).toBeVisible();
    await expect(count(page)).toHaveText('2 people match');
    // A preview name opens the contact page.
    await page.getByRole('table').getByRole('link', { name: 'Ray Park' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ray Park' })).toBeVisible();
    await expect(page.getByTestId('stat-no-show')).toHaveText('16.7%');
  });

  test('a role without finance sees no money anywhere, and money audiences are refused', async ({
    page,
    browser,
  }) => {
    const { slug, s } = await orgWithJohn(page);
    // The owner saves an audience on lifetime value.
    await page.goto(`/o/${slug}/audiences/new`);
    await page.getByLabel('New condition').first().selectOption('ltv');
    await page.getByRole('button', { name: 'Add condition' }).first().click();
    await page.getByRole('group', { name: 'Condition 1: Lifetime value' }).getByLabel('Amount').fill('1000');
    await expect(count(page)).toHaveText('2 people match');
    await page.getByLabel('Audience name').fill('Big spenders');
    await page.getByRole('button', { name: 'Save audience' }).click();
    await expect(page.getByText('Audience saved.')).toBeVisible();
    const savedUrl = page.url();

    const marketer = await member(browser, slug, 'marketing');
    const m = marketer.page;
    await m.goto(`/o/${slug}/contacts/${s.people.john.id}`);
    await expect(m.getByRole('heading', { level: 1, name: 'John Doe' })).toBeVisible();
    await expect(m.getByTestId('stat-engagement')).toHaveText('64 / 100');
    await expect(m.getByTestId('stat-ltv')).toHaveCount(0);
    await expect(m.getByRole('heading', { name: 'Lifetime value' })).toHaveCount(0);
    await expect(m.getByTestId('stat-rfm').getByText('Monetary')).toHaveCount(0);
    await expect(m.locator('main')).not.toContainText('$');
    await expectAccessible(m);
    await m.goto(`/o/${slug}/contacts/stats`);
    await expect(m.getByRole('heading', { level: 1, name: 'Contact insights' })).toBeVisible();
    await expect(m.getByRole('heading', { name: 'Lifetime value' })).toHaveCount(0);
    await expect(m.locator('main')).not.toContainText('$');
    // The builder offers no money conditions…
    await m.goto(`/o/${slug}/audiences/new`);
    const types = m.getByLabel('New condition').first();
    await expect(types.locator('option[value="ltv"]')).toHaveCount(0);
    await types.selectOption('stats');
    await m.getByRole('button', { name: 'Add condition' }).first().click();
    await expect(m.getByLabel('Stat').locator('option[value="rfmMonetary"]')).toHaveCount(0);
    // …and the saved money audience is refused when opened directly.
    await m.goto(savedUrl.replace(/^https?:\/\/[^/]+/, ''));
    await expect(count(m)).toHaveText("You don't have access to this.");
    await expect(m.getByRole('table')).toHaveCount(0);
    await marketer.close();

    // A viewer has no contacts permission: the pages are not found.
    const viewer = await member(browser, slug, 'viewer');
    for (const path of [`contacts/${s.people.john.id}`, 'contacts/stats']) {
      const res = await viewer.page.goto(`/o/${slug}/${path}`);
      expect(res?.status()).toBe(404);
    }
    await viewer.close();
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const { slug, s } = await orgWithJohn(page);
    await page.goto(`/ar/o/${slug}/contacts/${s.people.john.id}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'John Doe' })).toBeVisible();
    await expect(page.getByText('درجة التفاعل').first()).toBeVisible();
    await expect(page.getByTestId('stat-engagement')).toHaveText(/64|٦٤/);
    await expectAccessible(page);
    await page.goto(`/ar/o/${slug}/contacts/stats`);
    await expect(page.getByRole('heading', { level: 1, name: 'رؤى جهات الاتصال' })).toBeVisible();
    await expectAccessible(page);
  });

  test('an unknown or other org’s contact is not found', async ({ page }) => {
    const { slug } = await orgWithJohn(page);
    const other = await newUser(page, { org: true, twoFactor: true, event: 'published' });
    const otherOrg = await resolveOrgSlug(other.orgSlug as string);
    if (!otherOrg) throw new Error('no org');
    const theirs = await contactStatsScenario(otherOrg.orgId);
    // Signed in as the second owner now; the first org's page isn't theirs at all.
    let res = await page.goto(`/o/${slug}/contacts/${theirs.people.john.id}`);
    expect(res?.status()).toBe(404);
    // In their own org, another org's contact id is simply not found.
    res = await page.goto(`/o/${other.orgSlug}/contacts/00000000-0000-7000-8000-000000000000`);
    expect(res?.status()).toBe(404);
    await page.goto(`/o/${other.orgSlug}/contacts/${theirs.people.john.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'John Doe' })).toBeVisible();
  });
});
