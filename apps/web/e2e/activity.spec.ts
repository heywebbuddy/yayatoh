import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectPicked,
  OWNER,
  pickOption,
  signIn,
  stepOption,
  WEDDING_OWNER,
} from './helpers.ts';

/**
 * M1.14b Settings → Activity: the org's audit log for owners and admins, with the hash-chain
 * check, filters, paging, CSV export, and refusals for other roles. Changes are made in Rosewood
 * (its own org), so parallel specs on Lakeside are never disturbed.
 */
const ROSEWOOD = '/o/rosewood-weddings';
const VIEWER = 'jordan@lakeside.test';

async function saveBrand(page: Page, hex: string) {
  await page.goto(`${ROSEWOOD}/settings`);
  const brand = page.getByRole('region', { name: 'Brand' });
  await brand.getByLabel('Brand colour', { exact: true }).fill(hex);
  await brand.getByRole('button', { name: 'Save' }).click();
  await expect(brand.getByText('Saved.')).toBeVisible();
}

test.describe('Activity (audit log)', () => {
  test('an owner opens Activity from Settings, sees a verified log and their own change on top', async ({
    page,
  }) => {
    await signIn(page, WEDDING_OWNER);
    await saveBrand(page, '#7a2e4d');
    await page.getByRole('link', { name: 'Activity log' }).click();
    await expect(page).toHaveURL(/\/o\/rosewood-weddings\/activity$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(page.getByTestId('audit-integrity')).toContainText('Verified');
    await expect(page.getByTestId('audit-integrity')).toContainText(/\d+ entries, hash chain intact/);
    const table = page.getByRole('table', { name: 'Activity log, newest first' });
    const first = table.getByRole('row').nth(1);
    await expect(first).toContainText('organization.update');
    await expect(first).toContainText('Maya');
    // Times are shown in the org's timezone (named in the description).
    await expect(page.getByText(/Times are in [A-Za-z_]+\/[A-Za-z_]+\./)).toBeVisible();
    // The nav item is there for owners.
    await expect(page.locator('nav a[href$="/rosewood-weddings/activity"]').first()).toBeAttached();
    await expectAccessible(page);
  });

  test('filters by action and person, validates dates, and shows the empty state', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await saveBrand(page, '#2e4d7a');
    await page.goto(`${ROSEWOOD}/activity`);
    await pickOption(page.getByLabel('What'), 'organization.update');
    await pickOption(page.getByLabel('Who'), { label: 'Maya Chen' });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/action=organization\.update/);
    const rows = page.getByRole('table', { name: 'Activity log, newest first' }).getByRole('row');
    await expect(rows.nth(1)).toBeVisible();
    for (const text of (await rows.allInnerTexts()).slice(1)) expect(text).toContain('organization.update');
    for (const text of (await rows.allInnerTexts()).slice(1)) expect(text).toContain('Maya Chen');
    // Survives a reload (the filters live in the URL).
    await page.reload();
    await expectPicked(page.getByLabel('What'), 'organization.update');

    // A date range in the future: nothing matches.
    await page.getByLabel('From').fill('2099-01-01');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByText('Nothing matches these filters')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/activity$/);

    // Backwards and malformed ranges are refused with a message.
    await page.goto(`${ROSEWOOD}/activity?from=2026-05-02&to=2026-05-01`);
    await expect(
      page.getByRole('alert').filter({ hasText: 'The start date is after the end date' }),
    ).toBeVisible();
    await page.goto(`${ROSEWOOD}/activity?from=2026-13-45`);
    await expect(page.getByRole('alert').filter({ hasText: 'Enter dates as YYYY-MM-DD.' })).toBeVisible();
  });

  test('pages through older entries and back to the newest', async ({ page }) => {
    // Filling a second page on a fresh shard database can take up to 30 saves.
    test.setTimeout(90_000);
    await signIn(page, WEDDING_OWNER);
    await page.goto(`${ROSEWOOD}/activity`);
    // Make sure there is more than one page (a fresh database has few entries).
    for (let i = 0; i < 30 && !(await page.getByRole('link', { name: 'Older entries' }).isVisible()); i++) {
      await saveBrand(page, `#${(0x300000 + i * 4099).toString(16)}`);
      await page.goto(`${ROSEWOOD}/activity`);
    }
    const seqOf = async () =>
      Number(
        (
          await page
            .getByRole('table', { name: 'Activity log, newest first' })
            .getByRole('row')
            .nth(1)
            .getByRole('cell')
            .first()
            .innerText()
        ).replace(/\D/g, ''),
      );
    await expect(page.getByText('25 entries on this page')).toBeVisible();
    const top = await seqOf();
    await page.getByRole('link', { name: 'Older entries' }).click();
    await expect(page).toHaveURL(/before=\d+/);
    expect(await seqOf()).toBeLessThan(top - 24);
    await page.getByRole('link', { name: 'Newest' }).click();
    await expect(page).not.toHaveURL(/before=/);
    expect(await seqOf()).toBeGreaterThanOrEqual(top);
  });

  test('keyboard only: filter and export', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await page.goto(`${ROSEWOOD}/activity`);
    // Choose an action with the arrow keys, then Tab (through the date fields) to Filter.
    await stepOption(page.getByLabel('What'));
    const filter = page.getByRole('button', { name: 'Filter' });
    for (let i = 0; i < 12 && !(await filter.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Filter' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/action=/);
    await page.getByRole('button', { name: 'Export CSV' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Activity export' })).toBeVisible();
  });

  test('exports the filtered log as CSV and downloads it', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await saveBrand(page, '#4d7a2e');
    await page.goto(`${ROSEWOOD}/activity?action=organization.update`);
    await page.getByRole('button', { name: 'Export CSV' }).click();
    await expect(page.getByRole('heading', { name: 'Activity export' })).toBeVisible();
    await expect(page.getByText(/Ready: \d+ rows exported\./)).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^activity-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path()) as string, 'utf8').replace(/^﻿/, '');
    const [header, ...lines] = csv.trim().split(/\r?\n/);
    expect(header).toBe('#,When,Who,Action,Target type,Target,Details');
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines)
      expect(l).toMatch(/^\d+,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},.*,organization\.update,/);
    await expectAccessible(page);
  });

  test('viewers get no nav item, a refusal on the URL, and cannot download an owner’s export', async ({
    page,
    browser,
  }) => {
    // The owner exports first.
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner, OWNER);
    await owner.goto('/o/lakeside-events/activity');
    await owner.getByRole('button', { name: 'Export CSV' }).click();
    const link = owner.getByRole('link', { name: 'Download CSV' });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href')) as string;
    expect((await owner.request.get(href)).status()).toBe(200);

    await signIn(page, VIEWER);
    await page.goto('/o/lakeside-events');
    await expect(page.locator('nav a[href$="/lakeside-events/activity"]')).toHaveCount(0);
    await expect(page.locator('nav a[href$="/lakeside-events/team"]').first()).toBeAttached();
    await page.goto('/o/lakeside-events/activity');
    await expect(page.getByText('Only owners and admins can see activity')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expectAccessible(page);
    expect((await page.request.get(href)).status()).toBe(404);
    // Settings has no Activity link for them either.
    await page.goto('/o/lakeside-events/settings');
    await expect(page.getByRole('link', { name: 'Activity log' })).toHaveCount(0);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    await signIn(page, WEDDING_OWNER);
    await page.goto(`/ar${ROSEWOOD}/activity`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'النشاط' })).toBeVisible();
    await expect(page.getByTestId('audit-integrity')).toContainText('تم التحقق');
    await expectAccessible(page);
  });
});
