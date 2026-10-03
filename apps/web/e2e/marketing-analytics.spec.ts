import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type MarketingScenario, marketingScenario } from '@yayatoh/testing';
import { expectAccessible, newUser, pickOption } from './helpers.ts';

// Tickets are signed with the org's keys: seal them under the web server's key vault.
const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

/**
 * M3.8b marketing analytics, end to end: a fresh org holding the shared fixture (a messaging
 * campaign with 120 emails, 8 bounced; an Instagram link; three orders credited first and last
 * touch; a UTM-only podcast order), read by the marketing role, the owner, a viewer, a scanner and
 * door staff.
 */
async function orgWithCampaigns(page: Page): Promise<{ slug: string; s: MarketingScenario }> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  return { slug, s: await marketingScenario(org.orgId) };
}

async function member(browser: Browser, slug: string, role: string, name?: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await newUser(page, { join: [`${slug}:${role}`], ...(name ? { name } : {}) });
  return page;
}

const shown = (page: Page) =>
  page
    .getByTestId('command-center')
    .locator('[data-testid^="cc-widget-"]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').replace('cc-widget-', '')));

const CSV_HEADER =
  'Name,Event,Source,Medium,Campaign,Link code,Sent,Delivered,Clicks,Unique clickers,First-touch orders,First-touch revenue (minor units),Last-touch orders,Last-touch revenue (minor units),Orders in other currencies,Conversion (%),Currency';

test.describe('marketing analytics (M3.8b)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the marketing layout shows the campaign revenue tiles with the exact fixture numbers; drill into the campaign by keyboard', async ({
    page,
    browser,
  }) => {
    const { slug, s } = await orgWithCampaigns(page);
    const marketer = await member(browser, slug, 'marketing');
    await marketer.goto(`/o/${slug}/e/${s.eventSlug}/command-center`);
    const cc = marketer.getByTestId('command-center');
    await expect(cc).toHaveAttribute('data-role', 'marketing');
    const widgets = await shown(marketer);
    expect(widgets[0]).toBe('campaigns');
    expect(widgets).toContain('deliverability');
    expect(widgets).not.toContain('sales');

    const tile = marketer.getByTestId('cc-widget-campaigns');
    await expect(tile.getByTestId('cc-campaigns-revenue')).toHaveText('$100.00');
    await expect(tile.getByTestId('cc-campaigns-summary')).toHaveText('3 orders · 6 clicks · 50% conversion');
    await expect(tile).toContainText('First touch: 3 orders, $100.00');
    // The chart's table: every campaign's figures.
    const rows = tile.getByTestId('cc-campaigns-table').locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveText(/Spring launch\s*4\s*1\s*\$50\.00/);
    await expect(rows.nth(1)).toHaveText(/spring-social\s*2\s*1\s*\$25\.00/);
    await expect(rows.nth(2)).toHaveText(/spring-podcast\s*0\s*1\s*\$25\.00/);

    const mail = marketer.getByTestId('cc-widget-deliverability');
    await expect(mail).toContainText('Needs attention');
    await expect(mail.getByTestId('cc-deliverability-rates')).toHaveText('Bounces 2.5% · complaints 0%');
    await expect(mail).toContainText('320 emails in the last 7 days');
    await expect(mail).toContainText('1 sending domain and 1 campaign over the thresholds');
    await expectAccessible(marketer);

    // Keyboard: focus the campaign's link and open its drill-down.
    const link = tile.getByRole('link', { name: 'Spring launch' });
    await link.focus();
    await marketer.keyboard.press('Enter');
    await expect(marketer.getByRole('heading', { level: 1, name: 'Spring launch' })).toBeVisible();
    await expect(marketer.getByText('Messaging campaign').first()).toBeVisible();
    await expect(marketer.getByTestId('figure-sends')).toContainText('120');
    await expect(marketer.getByTestId('figure-deliveries')).toContainText('112');
    await expect(marketer.getByTestId('figure-clicks')).toContainText('4');
    await expect(marketer.getByTestId('figure-uniqueClickers')).toContainText('3');
    await expect(marketer.getByTestId('figure-lastRevenue')).toContainText('$50.00');
    await expect(marketer.getByTestId('figure-firstRevenue')).toContainText('$75.00');
    await expect(marketer.getByTestId('figure-conversion')).toContainText('25%');
    const delivery = marketer.getByTestId('campaign-delivery');
    await expect(delivery).toContainText('Bounced8');
    await expect(delivery).toContainText('Bounce rate6.66%');
    const orders = marketer.getByRole('region', { name: 'Orders it led to' }).locator('tbody tr');
    await expect(orders).toHaveCount(2);
    await expect(orders.filter({ hasText: 'First and last touch' })).toContainText('$50.00');
    await expect(orders.filter({ hasText: /^(?!.*last).*First touch/ })).toContainText('$25.00');
    // The marketing role doesn't read orders: no order links.
    await expect(marketer.getByRole('region', { name: 'Orders it led to' }).getByRole('link')).toHaveCount(0);
    await expectAccessible(marketer);
    await marketer.reload();
    await expect(marketer.getByTestId('figure-lastRevenue')).toContainText('$50.00');
  });

  test('analytics by campaign, channel and link; the date range (validation, empty); CSV export; Arabic RTL', async ({
    page,
  }) => {
    const { slug, s } = await orgWithCampaigns(page);
    await page.goto(`/o/${slug}`);
    await expect(page.locator(`nav a[href$="/${slug}/marketing-analytics"]`).first()).toBeAttached();
    await page.goto(`/o/${slug}/marketing-analytics`);
    await expect(page.getByRole('heading', { level: 1, name: 'Marketing analytics' })).toBeVisible();
    await expect(page.getByTestId('figure-sends')).toContainText('120');
    await expect(page.getByTestId('figure-deliveries')).toContainText('112');
    await expect(page.getByTestId('figure-clicks')).toContainText('6');
    await expect(page.getByTestId('figure-uniqueClickers')).toContainText('4');
    await expect(page.getByTestId('figure-lastOrders')).toContainText('3');
    await expect(page.getByTestId('figure-lastRevenue')).toContainText('$100.00');
    await expect(page.getByTestId('figure-conversion')).toContainText('50%');
    const table = page.getByRole('region', { name: 'Campaigns: sends, clicks, orders and revenue' });
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('tbody tr').first()).toContainText('Spring launch');
    await expect(table.locator('tbody tr').first()).toContainText('$75.00');
    // The chart's data behind its disclosure (keyboard).
    await page.getByText('Show the data').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('table', { name: 'Last-touch revenue by campaign' })).toBeVisible();
    await expectAccessible(page);

    // Channels, then links, by keyboard.
    await page.getByRole('link', { name: 'Channels' }).focus();
    await page.keyboard.press('Enter');
    const channels = page.getByRole('region', { name: 'Channels: sends, clicks, orders and revenue' });
    await expect(channels.locator('tbody tr')).toHaveCount(3);
    await expect(channels.locator('tbody tr').first()).toContainText('email');
    await page.getByRole('link', { name: 'Links', exact: true }).focus();
    await page.keyboard.press('Enter');
    const links = page.getByRole('region', { name: 'Tracked links: clicks, orders and revenue' });
    await expect(links.locator('tbody tr')).toHaveCount(2);
    await expect(links.locator('tbody tr').filter({ hasText: 'Instagram bio' })).toContainText(s.eventName);
    await expectAccessible(page);

    // A range that ends before it starts: the error, the dates kept.
    await page.getByLabel('From', { exact: true }).fill('2026-03-02');
    await page.getByLabel('To', { exact: true }).fill('2026-03-01');
    await page.getByRole('button', { name: 'Apply' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#range-error')).toHaveText(
      'The start date must be on or before the end date.',
    );
    await expect(page.locator('#range-error')).toHaveAttribute('role', 'alert');
    await expect(page.getByLabel('From', { exact: true })).toHaveAttribute('data-value', '2026-03-02');
    await expect(page.getByLabel('From', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    // A past range: nothing sent, clicked or sold; the links still listed with zeros.
    await page.getByLabel('From', { exact: true }).fill('2025-01-01');
    await page.getByLabel('To', { exact: true }).fill('2025-01-31');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('figure-lastRevenue')).toContainText('$0.00');
    await expect(page.getByTestId('figure-sends')).toContainText('—');
    await expect(page).toHaveURL(/from=2025-01-01/);

    // CSV export (campaign view, default range): header, the rows, the totals.
    await page.goto(`/o/${slug}/marketing-analytics`);
    const download = page.waitForEvent('download');
    await page.getByTestId('analytics-export').focus();
    await page.keyboard.press('Enter');
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^marketing-campaign-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
    const res = await page.request.get(`/o/${slug}/marketing-analytics/export?view=campaign`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    const lines = (await res.text()).replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines[1]).toBe('Spring launch,,,,,,120,112,4,3,2,7500,1,5000,0,25.00,USD');
    expect(lines.at(-1)).toBe('Total,,,,,,120,112,6,4,3,10000,3,10000,0,50.00,USD');
    expect(await res.text()).not.toMatch(/buyers\.test/);
    expect(
      (
        await page.request.get(`/o/${slug}/marketing-analytics/export?from=2026-03-02&to=2026-03-01`)
      ).status(),
    ).toBe(400);

    // Arabic, right to left.
    await page.goto(`/ar/o/${slug}/marketing-analytics`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'تحليلات التسويق' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${slug}/marketing-analytics/deliverability`);
    await expect(page.getByRole('heading', { level: 1, name: 'قابلية تسليم البريد' })).toBeVisible();
    await expectAccessible(page);
  });

  test('deliverability: rates per org, domain and campaign; the alert appears and links to the suppression list', async ({
    page,
  }) => {
    const { slug, s } = await orgWithCampaigns(page);
    await page.goto(`/o/${slug}/alerts`);
    const alert = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'Email deliverability needs attention' }) });
    await expect(alert).toBeVisible();
    const fix = alert.getByRole('link', { name: 'Open the suppression list' });
    await fix.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/messaging#suppressions$`));
    await expect(page.getByRole('heading', { level: 2, name: /suppress/i })).toBeVisible();

    await page.goto(`/o/${slug}/marketing-analytics/deliverability`);
    await expect(page.getByRole('heading', { level: 1, name: 'Email deliverability' })).toBeVisible();
    await expect(page.getByTestId('deliverability-alert')).toContainText('Deliverability alert: open');
    await expect(page.getByTestId('deliverability-alert')).toContainText(
      '1 sending domain and 1 campaign over the thresholds.',
    );
    const org = page.getByRole('region', { name: 'Your organization' });
    await expect(org.locator('tbody tr')).toContainText('320');
    await expect(org.locator('tbody tr')).toContainText('2.5% (8)');
    await expect(org.locator('tbody tr')).toContainText('Within the thresholds');
    const domains = page.getByRole('region', { name: 'Sending domains' });
    await expect(domains.locator('tbody tr').filter({ hasText: s.senderDomain })).toContainText('6.66% (8)');
    await expect(domains.locator('tbody tr').filter({ hasText: s.senderDomain })).toContainText(
      'Over a threshold',
    );
    await expect(domains.locator('tbody tr').filter({ hasText: 'Yayatoh shared sender' })).toContainText(
      'Within the thresholds',
    );
    const campaigns = page.getByRole('region', { name: 'Campaigns' });
    await expect(campaigns.locator('tbody tr')).toHaveCount(1);
    await expect(campaigns.locator('tbody tr')).toContainText('Spring launch');
    await expect(campaigns.locator('tbody tr')).toContainText('Over a threshold');
    await expect(page.getByText('Messaging is paused')).toHaveCount(0);
    await expectAccessible(page);
    const link = page.getByTestId('suppressions-link');
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/o/${slug}/messaging#suppressions$`));
  });

  test('the door gets no revenue; a viewer reads analytics but not deliverability; a scanner nothing', async ({
    page,
    browser,
  }) => {
    const { slug, s } = await orgWithCampaigns(page);
    const stamp = `${Date.now()}${test.info().project.name.split('-')[0]}`;
    const doorName = `Dee Door ${stamp}`;
    const door = await member(browser, slug, 'viewer', doorName);
    await page.goto(`/o/${slug}/e/${s.eventSlug}/onsite/staff`);
    const add = page.getByRole('region', { name: 'Add door staff' });
    await pickOption(add.getByLabel('Team member'), { label: doorName });
    await add.getByRole('button', { name: 'Add door staff' }).click();
    await expect(add.getByRole('status')).toHaveText('Saved.');

    await door.goto(`/o/${slug}/e/${s.eventSlug}/command-center`);
    const cc = door.getByTestId('command-center');
    await expect(cc).toHaveAttribute('data-role', 'door');
    expect(await shown(door)).not.toContain('campaigns');
    await expect(door.getByTestId('cc-widget-campaigns')).toHaveCount(0);
    await expect(cc).not.toContainText('$');
    await door.getByRole('button', { name: 'Customize layout' }).click();
    await expect(door.getByRole('button', { name: /Show Campaign results/ })).toHaveCount(0);
    const refused = await door.request.get(`/api/command-center/${slug}/${s.eventSlug}/campaigns`);
    expect(refused.status()).toBe(403);
    expect(await refused.text()).not.toContain('revenueMinor');
    expect(
      (await door.request.get(`/api/command-center/${slug}/${s.eventSlug}/deliverability`)).status(),
    ).toBe(403);
    await expectAccessible(door);
    // The owner gets the tile's data.
    const ok = await page.request.get(`/api/command-center/${slug}/${s.eventSlug}/campaigns`);
    expect(ok.status()).toBe(200);
    expect((await ok.json()).data.totals.revenueMinor).toBe(10_000);

    // A viewer (door staff here is a viewer org-wide) reads the analytics, not deliverability.
    await door.goto(`/o/${slug}/marketing-analytics`);
    await expect(door.getByTestId('figure-lastRevenue')).toContainText('$100.00');
    await expect(door.getByRole('heading', { name: 'Email deliverability' })).toHaveCount(0);
    const blocked = await door.goto(`/o/${slug}/marketing-analytics/deliverability`);
    expect(blocked?.status()).toBe(404);

    // A scanner: no nav item, the pages and the export are a 404.
    const scanner = await member(browser, slug, 'scanner');
    for (const path of [
      'marketing-analytics',
      'marketing-analytics/deliverability',
      'marketing-analytics/campaign?key=u.spring-social',
    ]) {
      const r = await scanner.goto(`/o/${slug}/${path}`);
      expect(r?.status()).toBe(404);
    }
    expect((await scanner.request.get(`/o/${slug}/marketing-analytics/export`)).status()).toBe(404);
    // An unknown campaign is a 404 for the owner too.
    const unknown = await page.goto(`/o/${slug}/marketing-analytics/campaign?key=u.never-used`);
    expect(unknown?.status()).toBe(404);
  });
});
