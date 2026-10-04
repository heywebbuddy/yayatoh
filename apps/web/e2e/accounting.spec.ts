import { expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  expectPicked,
  newUser,
  pickOption,
  pickWithKeyboard,
  signIn,
} from './helpers.ts';

/**
 * M6.5d accounting, through the real UI against the fake QuickBooks Online and Xero: connect
 * (fake consent), map the chart of accounts (validation, versions, reload), post a fixture day,
 * correct it with a late refund and see the reversal and the next revision; a provider-side
 * revoke stops posting; viewers are refused; keyboard only; axe in both themes; Arabic RTL.
 */

/** A fresh org whose owner is signed in on `page`. */
async function ownOrg(page: Page): Promise<string> {
  const owner = await newUser(page, { org: true, twoFactor: true });
  return owner.orgSlug as string;
}

/** Book the fixture day (two sales, a refund, a payout) or a late refund on it, `daysAgo` days back. */
async function ledgerFixture(page: Page, org: string, action: 'day' | 'late_refund', daysAgo = 3) {
  const res = await page.request.post('/api/dev/accounting/fixture', {
    form: { org, action, daysAgo: String(daysAgo) },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { day: string }).day;
}

/** Run the org's due syncs now (what the worker does). */
async function runSyncs(page: Page, org: string) {
  const res = await page.request.post('/api/dev/integrations/run', { form: { org } });
  expect(res.ok()).toBe(true);
}

async function connect(page: Page, org: string, name: 'QuickBooks Online' | 'Xero'): Promise<string> {
  await page.goto(`/o/${org}/integrations`);
  await page.getByRole('button', { name: `Connect ${name}` }).click();
  await expect(page.getByRole('heading', { name: `Connect ${name} to Yayatoh?` })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText(`${name} is connected. The first sync starts shortly.`)).toBeVisible();
  const id = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id as string;
}

const mapForm = (page: Page) => page.getByRole('form', { name: 'Chart of accounts' });
const journals = (page: Page) =>
  page.getByRole('table', { name: 'Daily summary journals sent to your books' });
const showDay = (day: string) =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

/** The QuickBooks fake's accounts, by category. */
const QBO = {
  'Ticket sales': '4000 · Ticket Sales',
  Donations: '4100 · Donations Received',
  Refunds: '4900 · Refunds to Customers',
  'Yayatoh fees': '6100 · Platform Fees',
  Payouts: '1000 · Business Checking',
  'Clearing account': '1250 · Yayatoh Clearing',
} as const;

async function mapAll(page: Page, day: string) {
  const form = mapForm(page);
  for (const [label, account] of Object.entries(QBO))
    await pickOption(form.getByLabel(label, { exact: true }), account);
  await form.getByRole('textbox', { name: 'Post days from' }).fill(day);
}

test.describe('accounting (M6.5d)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('connect, map accounts, post a day, correct it and see the repost', async ({ page }) => {
    const org = await ownOrg(page);
    const day = await ledgerFixture(page, org, 'day');
    await page.goto(`/o/${org}/integrations`);
    await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Xero' })).toBeVisible();
    await connect(page, org, 'QuickBooks Online');
    await expect(page.getByRole('heading', { level: 1, name: 'QuickBooks Online' })).toBeVisible();
    await expect(page.getByText('Sandbox Company (QuickBooks)')).toBeVisible();
    // Nothing is mapped yet: the page says what to do next.
    await expect(page.getByText('Map your accounts to start posting daily journals.')).toBeVisible();
    await expect(page.getByText('No journals yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Map accounts' })).toBeVisible();
    await expectAccessibleBothModes(page);

    // Validation: everything is required, and the clearing account stands alone.
    const form = mapForm(page);
    await form.getByRole('button', { name: 'Save account mapping' }).click();
    await expect(
      page.getByText("This mapping can't be saved yet. Check the fields marked below."),
    ).toBeVisible();
    await expect(form.getByText('Choose an account for Ticket sales.')).toBeVisible();
    await expect(form.getByText('Choose an account for Clearing account.')).toBeVisible();
    await expectAccessible(page);
    await mapAll(page, day);
    await pickOption(form.getByLabel('Payouts', { exact: true }), QBO['Clearing account']);
    await form.getByRole('button', { name: 'Save account mapping' }).click();
    await expect(form.getByText("The clearing account can't also be used for Payouts.")).toBeVisible();
    // A day in the future is refused.
    await pickOption(form.getByLabel('Payouts', { exact: true }), QBO.Payouts);
    await form.getByRole('textbox', { name: 'Post days from' }).fill('2099-01-01');
    await form.getByRole('button', { name: 'Save account mapping' }).click();
    await expect(form.getByText('Choose today or an earlier day.')).toBeVisible();
    // Valid: saved as version 1, kept after a reload.
    await form.getByRole('textbox', { name: 'Post days from' }).fill(day);
    await form.getByRole('button', { name: 'Save account mapping' }).click();
    await expect(
      page.getByText('Account mapping saved as version 1. The next sync posts with it.'),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Version 1 · posting days from ${showDay(day)}`)).toBeVisible();
    await expectPicked(mapForm(page).getByLabel('Clearing account', { exact: true }), '36');
    await expect(mapForm(page).getByRole('textbox', { name: 'Post days from' })).toHaveValue(/./);

    // Post the day.
    await runSyncs(page, org);
    await page.reload();
    const table = journals(page);
    const first = table.getByRole('row').filter({ hasText: showDay(day) });
    await expect(first).toHaveCount(1);
    await expect(first).toContainText('Journal · revision 1');
    await expect(first).toContainText('Posted');
    // Debits (refund 20.00, fees 9.00, payout 50.00, clearing 121.00) equal the day's sales.
    await expect(first).toContainText('$200.00');
    await expect(first).toContainText('1001');
    await expectAccessibleBothModes(page);

    // A late refund on that day: the next sync reverses revision 1 and posts revision 2.
    await ledgerFixture(page, org, 'late_refund');
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText('Sync started. Refresh in a moment to see the result.')).toBeVisible();
    await runSyncs(page, org);
    await page.reload();
    const rows = journals(page)
      .getByRole('row')
      .filter({ hasText: showDay(day) });
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Reversal of revision 1' })).toContainText('$200.00');
    await expect(rows.filter({ hasText: 'Journal · revision 2' })).toContainText('Posted');
    // Running again posts nothing new.
    await runSyncs(page, org);
    await page.reload();
    await expect(
      journals(page)
        .getByRole('row')
        .filter({ hasText: showDay(day) }),
    ).toHaveCount(3);
    await expectAccessible(page);
  });

  test('revoked at the provider: posting stops and the connection shows it', async ({ page }) => {
    const org = await ownOrg(page);
    const day = await ledgerFixture(page, org, 'day', 2);
    const connection = await connect(page, org, 'Xero');
    const form = mapForm(page);
    const XERO = {
      'Ticket sales': '200 · Sales',
      Donations: '260 · Donations',
      Refunds: '210 · Refunds',
      'Yayatoh fees': '404 · Bank Fees',
      Payouts: '090 · Business Bank Account',
      'Clearing account': '610 · Yayatoh Clearing',
    };
    for (const [label, account] of Object.entries(XERO))
      await pickOption(form.getByLabel(label, { exact: true }), account);
    // Xero accounts without a code can't take journal lines: they are not offered.
    await pickOption(form.getByLabel('Payouts', { exact: true }), XERO.Payouts);
    await form.getByRole('textbox', { name: 'Post days from' }).fill(day);
    await form.getByRole('button', { name: 'Save account mapping' }).click();
    await expect(
      page.getByText('Account mapping saved as version 1. The next sync posts with it.'),
    ).toBeVisible();
    const res = await page.request.post('/api/dev/integrations/fake', {
      form: { connection, action: 'revoke' },
    });
    expect(res.ok()).toBe(true);
    await runSyncs(page, org);
    await page.reload();
    await expect(page.getByText('Disconnected').first()).toBeVisible();
    await expect(page.getByText('No journals yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to integrations' })).toBeVisible();
    await expectAccessible(page);
  });

  test('keyboard only: connect, map and save', async ({ page }) => {
    const org = await ownOrg(page);
    const day = await ledgerFixture(page, org, 'day', 4);
    await page.goto(`/o/${org}/integrations`);
    const connectButton = page.getByRole('button', { name: 'Connect QuickBooks Online' });
    await connectButton.focus();
    await page.keyboard.press('Enter');
    const allow = page.getByRole('button', { name: 'Allow' });
    await expect(allow).toBeVisible();
    await allow.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('QuickBooks Online is connected. The first sync starts shortly.'),
    ).toBeVisible();
    const form = mapForm(page);
    for (const [label, account] of Object.entries(QBO))
      await pickWithKeyboard(form.getByLabel(label, { exact: true }), { label: account });
    const date = form.getByRole('textbox', { name: 'Post days from' });
    await date.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(day);
    await form.getByRole('button', { name: 'Save account mapping' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Account mapping saved as version 1. The next sync posts with it.'),
    ).toBeVisible();
    await runSyncs(page, org);
    await page.reload();
    await expect(
      journals(page)
        .getByRole('row')
        .filter({ hasText: showDay(day) }),
    ).toContainText('Posted');
  });

  test('a viewer cannot open an accounting connection', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    const res = await page.goto('/o/lakeside-events/integrations/01999999-0000-7000-8000-000000000002');
    expect(res?.status()).toBe(404);
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const org = await ownOrg(page);
    const day = await ledgerFixture(page, org, 'day', 5);
    const connection = await connect(page, org, 'QuickBooks Online');
    await mapAll(page, day);
    await mapForm(page).getByRole('button', { name: 'Save account mapping' }).click();
    await expect(
      page.getByText('Account mapping saved as version 1. The next sync posts with it.'),
    ).toBeVisible();
    await runSyncs(page, org);
    await page.goto(`/ar/o/${org}/integrations/${connection}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'دليل الحسابات' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'القيود اليومية' })).toBeVisible();
    await expect(page.getByText('مُرحَّل').first()).toBeVisible();
    await expectAccessible(page);
  });
});
