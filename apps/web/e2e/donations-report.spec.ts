import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  ageSession,
  codeForKey,
  confirmStepUp,
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  stepUpDialog,
} from './helpers.ts';

// Long journeys (two browsers, provider pages, axe in light and dark).
test.describe.configure({ timeout: 240_000 });

/**
 * M4.8g reporting, exports and reconciliation: the gala's donations report (totals, ledger check,
 * per source/level/donor with the anonymous flag), the donor CRM export (CSV and Excel, behind a
 * fresh step-up), and reconciliation with the connected Stripe account (a clean run, an amount
 * mismatch resolved with a note, payouts); empty states, validation, viewers refused, the keyboard
 * and Arabic RTL. Each test makes its own org (projects run in parallel on one database).
 */

const stamp = () => `${Date.now().toString(36)}${test.info().project.name.split('-')[0]}`;

interface Gala {
  readonly org: string;
  readonly slug: string;
  readonly donations: string;
  readonly report: string;
  readonly recon: string;
  readonly setupKey: string;
}

async function gala(page: Page): Promise<Gala> {
  const user = await newUser(page, {
    org: true,
    twoFactor: true,
    event: 'published',
    profile: 'gala',
    payouts: 'active',
  });
  const org = user.orgSlug ?? '';
  const slug = user.eventSlug ?? '';
  const donations = `/o/${org}/e/${slug}/donations`;
  return {
    org,
    slug,
    donations,
    report: `${donations}/report`,
    recon: `${donations}/reconciliation`,
    setupKey: user.setupKey ?? '',
  };
}

async function addCampaign(page: Page, g: Gala, name: string) {
  await page.goto(g.donations);
  const form = page.getByRole('region', { name: 'Add campaign' });
  await form.getByLabel('Campaign name').fill(name);
  await form.getByLabel('Goal (USD)').fill('100000');
  await form.getByRole('button', { name: 'Add campaign' }).click();
  await expect(form.getByText('Campaign added.')).toBeVisible();
}

/** A donor gives an own amount on the giving page and pays on the fake provider's page. */
async function give(
  browser: Browser,
  g: Gala,
  amount: string,
  name: string,
  display: 'Show my full name' | 'Give anonymously' = 'Show my full name',
) {
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(`/events/${g.slug}/give`);
  await guest.getByLabel('Amount (USD)').fill(amount);
  await guest.getByRole('textbox', { name: 'Full name' }).fill(name);
  await guest.getByLabel('Email').fill(`${name.split(' ')[0]?.toLowerCase()}+${stamp()}@example.test`);
  await guest.getByRole('radio', { name: display }).check();
  await guest.getByRole('button', { name: /^Give \$/ }).click();
  await expect(guest).toHaveURL(/\/checkout\/fake\?/);
  await guest.getByRole('button', { name: /^Pay/ }).click();
  await expect(guest.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  await ctx.close();
}

async function devProvider(page: Page, g: Gala, data: Record<string, string>) {
  const res = await page.request.post('/api/dev/donations/provider', {
    form: { org: g.org, ...data },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe('donations report and reconciliation (M4.8g)', () => {
  test('report totals, the ledger check, donors with the anonymous flag, and reconciliation to the cent', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    // Empty states first.
    await page.goto(g.report);
    await expect(page.getByRole('heading', { name: 'Donations report', level: 1 })).toBeVisible();
    await expect(page.getByText('No donations yet')).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.getByRole('link', { name: 'Go to Donations' }).click();
    await expect(page.getByRole('heading', { name: 'Donations', level: 1 })).toBeVisible();

    await addCampaign(page, g, 'Gala Fund');
    await give(browser, g, '250', 'Ada Giver');
    await give(browser, g, '100', 'Ben Quiet', 'Give anonymously');

    // The Donations tab links to the report.
    await page.goto(g.donations);
    await page.getByTestId('report-card').getByRole('link', { name: 'Open the report' }).click();
    await expect(page).toHaveURL(new RegExp(`${g.report}$`));
    await expect(page.getByTestId('stat-raised')).toContainText('$350.00');
    await expect(page.getByTestId('stat-raised')).toContainText('2 gifts and payments from 2 donors');
    await expect(page.getByTestId('stat-online')).toContainText('$350.00');
    await expect(page.getByTestId('ledger-check')).toContainText('Not reconciled yet');
    await expect(page.getByTestId('ledger-check')).toContainText('$350.00');
    const donors = page.getByRole('table', { name: 'By donor' });
    await expect(donors.getByRole('row', { name: /Ada Giver/ })).toContainText('$250.00');
    const ben = donors.getByRole('row', { name: /Ben Quiet/ });
    await expect(ben).toContainText('Anonymous');
    await expect(ben).toContainText('$100.00');
    await expect(
      page.getByRole('table', { name: 'By source' }).getByRole('row', { name: /Giving page/ }),
    ).toContainText('$350.00');
    await expectAccessibleBothModes(page);

    // Reconciliation: never run, then a clean run.
    await page.getByRole('link', { name: 'Reconciliation' }).click();
    await expect(page.getByRole('heading', { name: 'Donations reconciliation', level: 1 })).toBeVisible();
    await expect(
      page.getByText('Not reconciled yet. Reconcile now to compare the ledger with Stripe.'),
    ).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.getByRole('button', { name: 'Reconcile now' }).click();
    await expect(page.getByText('Reconciled.')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('last-run')).toContainText('2 ledger entries against 2 Stripe movements');
    await expect(page.getByText('Everything matches')).toBeVisible();
    await expect(page.getByTestId('recon-ledger')).toContainText('$350.00');
    await expect(page.getByTestId('recon-provider')).toContainText('$350.00');
    await expect(page.getByText('No payouts yet.')).toBeVisible();
    await page.goto(g.report);
    await expect(page.getByTestId('ledger-check')).toContainText('Matches to the cent');

    // Stripe reports a different amount: the difference is listed and resolved with a note.
    await devProvider(page, g, { op: 'drift', amount: '125' });
    await page.goto(g.recon);
    await page.getByRole('button', { name: 'Reconcile now' }).click();
    await expect(page.getByText('Reconciled.')).toBeVisible();
    await page.reload();
    const item = page.getByTestId('recon-items').getByRole('listitem').first();
    await expect(item.getByRole('heading', { name: 'Amounts differ' })).toBeVisible();
    await expect(item).toContainText('Open');
    await expect(item).toContainText('$1.25');
    await expectAccessibleBothModes(page);
    const resolve = item.getByRole('button', { name: /^Resolve order:/ });
    await resolve.click();
    await expect(item.getByText('Say what you found (3 to 500 characters).')).toBeVisible();
    await expect(item.getByLabel('What you found')).toHaveAttribute('aria-invalid', 'true');
    await item.getByLabel('What you found').fill('Stripe adjustment, confirmed');
    await resolve.click();
    // The card itself confirms it: resolved, with the note, and no form left.
    await expect(item.getByText('Resolved: Stripe adjustment, confirmed')).toBeVisible();
    await expect(item.getByRole('button', { name: /^Resolve/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Resolved: Stripe adjustment, confirmed')).toBeVisible();
    await expect(page.getByText('No open differences: every one is resolved or cleared.')).toBeVisible();
    await page.goto(g.report);
    await expect(page.getByTestId('ledger-check')).toContainText('Differs by $1.25');

    // Days later the fake's payouts have been made: the payouts table lists them.
    await devProvider(page, g, { op: 'age', days: '4' });
    await page.goto(g.recon);
    await page.getByRole('button', { name: 'Reconcile now' }).click();
    await expect(page.getByText('Reconciled.')).toBeVisible();
    await page.reload();
    const payouts = page.getByRole('table', { name: 'Payouts' });
    await expect(payouts.getByRole('row', { name: /Paid/ }).first()).toBeVisible();
    await expect(page.getByTestId('recon-unpaid')).toContainText('Everything has been paid out');
    await expectAccessibleBothModes(page);
  });

  test('donor CRM exports: CSV and Excel behind a fresh step-up, the anonymous flag kept', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await addCampaign(page, g, 'Export Fund');
    await give(browser, g, '75', 'Cleo Park', 'Give anonymously');
    await ageSession(page);
    await page.goto(g.report);
    const exporter = page.getByRole('region', { name: 'Export for your donor CRM' });
    await exporter.getByLabel('Columns for').selectOption('salesforce_npsp');
    await exporter.getByRole('button', { name: 'Export donors' }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await confirmStepUp(page, codeForKey(g.setupKey));
    const download = page.getByRole('link', { name: 'Download' });
    await expect(download).toBeVisible();
    await expect(page.getByText('Donor export (CSV)')).toBeVisible();
    const csv = await page.request.get((await download.getAttribute('href')) ?? '');
    expect(csv.status()).toBe(200);
    const text = (await csv.text()).replace(/^﻿/, '');
    const [header, row] = text.split(/\r?\n/);
    expect(header).toBe(
      'Contact1 First Name,Contact1 Last Name,Contact1 Personal Email,Donation Amount,Donation Date,Donation Campaign Name,Payment Method,Donation Description,Anonymous,Contact1 Employer,Honoree Name,Donation Import Reference',
    );
    expect(row).toMatch(/^Cleo,Park,cleo\+[^,]+,75\.00,\d{4}-\d{2}-\d{2},Export Fund,Credit Card,,TRUE,,,/);
    await expectAccessibleBothModes(page);

    // The same export as an Excel workbook, in this language's columns.
    await exporter.getByLabel('Columns for').selectOption('generic');
    await exporter.getByLabel('File type').selectOption('xlsx');
    await exporter.getByRole('button', { name: 'Export donors' }).click();
    await expect(page.getByText('Donor export (Excel)')).toBeVisible();
    const xlsx = await page.request.get(
      (await page.getByRole('link', { name: 'Download' }).getAttribute('href')) ?? '',
    );
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(xlsx.headers()['content-disposition']).toMatch(/donations-generic-\d{4}-\d{2}-\d{2}\.xlsx/);
    const bytes = await xlsx.body();
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
  });

  test('a viewer gets neither the report nor its exports; keyboard only; Arabic RTL', async ({
    page,
    browser,
  }) => {
    const g = await gala(page);
    await addCampaign(page, g, 'Keys Fund');
    await give(browser, g, '40', 'Dee Keys');

    // Keyboard only: reach "Reconcile now" and press Enter.
    await page.goto(g.recon);
    const run = page.getByRole('button', { name: 'Reconcile now' });
    for (let i = 0; i < 60 && !(await run.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(run).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Reconciled.')).toBeVisible();

    // Arabic: right to left, translated, accessible.
    await page.goto(`/ar${g.report}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'تقرير التبرعات', level: 1 })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${g.recon}`);
    await expect(page.getByRole('heading', { name: 'مطابقة التبرعات', level: 1 })).toBeVisible();
    await expectAccessible(page);

    // A viewer of the org: no report card, and the pages refuse.
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await newUser(viewer, { join: [`${g.org}:viewer`] });
    await viewer.goto(g.donations);
    await expect(viewer.getByRole('heading', { name: 'Donations', level: 1 })).toBeVisible();
    await expect(viewer.getByTestId('report-card')).toHaveCount(0);
    await viewer.goto(g.report);
    await expect(viewer.getByText('Finance access needed')).toBeVisible();
    await expect(viewer.getByText('Dee Keys')).toHaveCount(0);
    await viewer.goto(g.recon);
    await expect(viewer.getByText('Finance access needed')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Reconcile now' })).toHaveCount(0);
    await expectAccessible(viewer);
    await ctx.close();
  });
});
