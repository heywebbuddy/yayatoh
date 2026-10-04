import { expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  newUser,
  pickOption,
  signIn,
  stepOption,
} from './helpers.ts';

/**
 * M6.4b through the real UI against the recorded fakes (fake IntegrationAuth, fake Eventbrite
 * account, fake Sheets API): the Eventbrite import wizard (connect, preview, import, result; a
 * re-run writes nothing; an imported order is marked imported and offers no refund), Google
 * Sheets (link with inline validation, a round trip without duplicates, a deleted row flagged in
 * the inbox and dismissed, a conflict showing the kept and lost values, unlink with
 * confirmation), keyboard only, axe in both themes, Arabic RTL, and viewers refused.
 */

async function ownOrg(page: Page): Promise<string> {
  const owner = await newUser(page, { org: true, twoFactor: true });
  return owner.orgSlug as string;
}

/** Run the org's due syncs now (what the worker does). */
async function runSyncs(page: Page, org: string) {
  const res = await page.request.post('/api/dev/integrations/run', { form: { org } });
  expect(res.ok()).toBe(true);
}

/** Act at the fake provider (the organizer in Eventbrite or in their sheet). */
async function atProvider(page: Page, connection: string, form: Record<string, string>) {
  const res = await page.request.post('/api/dev/integrations/fake', { form: { connection, ...form } });
  expect(res.ok()).toBe(true);
}

async function sheetRows(page: Page, connection: string) {
  const res = await page.request.get(`/api/dev/integrations/fake?connection=${connection}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    sheets: { title: string; headers: string[]; rows: { values: Record<string, string> }[] }[];
  };
  return body.sheets.at(-1) ?? { title: '', headers: [], rows: [] };
}

/** Sync now from the connection page (the organizer's button), then let the worker run it. */
async function syncNow(page: Page, org: string, connection: string) {
  await page.goto(`/o/${org}/integrations/${connection}`);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Sync started. Refresh in a moment to see the result.')).toBeVisible();
  await runSyncs(page, org);
}

const connectionOf = (page: Page) => /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;

/** Connect Eventbrite through the fake consent screen: lands on the import wizard. */
async function connectEventbrite(page: Page, org: string): Promise<string> {
  await page.goto(`/o/${org}/integrations`);
  await page.getByRole('button', { name: 'Connect Eventbrite' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Eventbrite to Yayatoh?' })).toBeVisible();
  await expect(
    page.getByText("Eventbrite is a test provider. Allowing lets Yayatoh read your account's data"),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(
    page.getByText('Eventbrite is connected. Check what will come over, then import.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Import from Eventbrite' })).toBeVisible();
  return connectionOf(page);
}

/** Connect, import and run the import (the start of the Sheets journeys). */
async function importEventbrite(page: Page, org: string): Promise<string> {
  const connection = await connectEventbrite(page, org);
  await page.getByRole('button', { name: 'Import 18 new records' }).click();
  await expect(page.getByText('Import started.', { exact: false })).toBeVisible();
  await runSyncs(page, org);
  return connection;
}

async function connectSheets(page: Page, org: string): Promise<string> {
  await page.goto(`/o/${org}/integrations`);
  await page.getByRole('button', { name: 'Connect Google Sheets' }).click();
  await expect(page.getByRole('heading', { name: 'Connect Google Sheets to Yayatoh?' })).toBeVisible();
  await expect(page.getByText('https://www.googleapis.com/auth/drive.file')).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText('Google Sheets is connected. The first sync starts shortly.')).toBeVisible();
  return connectionOf(page);
}

/** The imported jazz night's console path. */
async function jazzPath(page: Page, org: string): Promise<string> {
  await page.goto(`/o/${org}`);
  const href = await page.locator(`a[href^="/o/${org}/e/summer-jazz-night-"]`).first().getAttribute('href');
  expect(href).toBeTruthy();
  return href as string;
}

test.describe('Eventbrite importer and Google Sheets (M6.4b)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('import wizard: connect, preview, import, result; a re-run writes nothing', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Eventbrite' }) });
    await expect(card).toContainText(
      'Bring your events, ticket types, orders and attendees over from Eventbrite.',
    );
    await expect(card.getByText('Not connected')).toBeVisible();

    const connection = await connectEventbrite(page, org);
    const steps = page.getByRole('navigation', { name: 'Import steps' });
    await expect(steps.locator('[aria-current="step"]')).toContainText('Preview');
    // The dry run: what Eventbrite holds and what is new; nothing written yet.
    const preview = page.getByRole('table', { name: 'What the import brings over' });
    await expect(preview.getByRole('row').filter({ hasText: 'Events' })).toContainText('3');
    await expect(preview.getByRole('row').filter({ hasText: 'Ticket types' })).toContainText('6');
    await expect(preview.getByRole('row').filter({ hasText: 'Orders' })).toContainText('9');
    await expect(preview.getByRole('row').filter({ hasText: 'Attendees' })).toContainText('15');
    await expect(page.getByTestId('preview-revenue')).toContainText('€89.80');
    await expect(page.getByTestId('preview-revenue')).toContainText('$552.59');
    await expect(page.getByText('1 order, imported as refunded with no revenue')).toBeVisible();
    await expect(
      page.getByText(
        'Imported orders are marked as imported: nobody is charged and no receipts or ticket emails go out.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Nothing imported yet.')).toBeVisible();
    await expectAccessibleBothModes(page);

    await page.getByRole('button', { name: 'Import 18 new records' }).click();
    await expect(
      page.getByText('Import started. It runs in the background: refresh in a moment to see the result.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import running…' })).toBeDisabled();
    await expect(steps.locator('[aria-current="step"]')).toContainText('Import');

    await runSyncs(page, org);
    await page.goto(`/o/${org}/integrations/${connection}/import`);
    await expect(steps.locator('[aria-current="step"]')).toContainText('Result');
    await expect(page.getByTestId('import-run')).toContainText('Synced');
    await expect(page.getByText('18 imported or updated · 0 unchanged · 0 with errors')).toBeVisible();
    const result = page.getByRole('table', { name: 'What Yayatoh holds from Eventbrite now' });
    await expect(result.getByRole('row').filter({ hasText: 'Events' })).toContainText('3');
    await expect(result.getByRole('row').filter({ hasText: 'Ticket types' })).toContainText('6');
    await expect(result.getByRole('row').filter({ hasText: 'Orders' })).toContainText('9 (8 paid)');
    await expect(result.getByRole('row').filter({ hasText: 'Attendees' })).toContainText('15 (14 active)');
    await expect(result.getByRole('row').filter({ hasText: 'Revenue' })).toContainText('€89.80');
    await expect(result.getByRole('row').filter({ hasText: 'Revenue' })).toContainText('$552.59');
    // Nothing is new any more.
    const preview2 = page.getByRole('table', { name: 'What the import brings over' });
    await expect(preview2.getByRole('row').filter({ hasText: 'Orders' })).toContainText('0');
    await expectAccessibleBothModes(page);

    // A re-run picks up changes only: nothing doubles.
    await page.getByRole('button', { name: 'Import again to pick up changes' }).click();
    await expect(page.getByText('Import started.', { exact: false })).toBeVisible();
    await runSyncs(page, org);
    await page.goto(`/o/${org}/integrations/${connection}/import`);
    await expect(page.getByText('0 imported or updated · 9 unchanged · 0 with errors')).toBeVisible();
    await expect(result.getByRole('row').filter({ hasText: 'Orders' })).toContainText('9 (8 paid)');

    // A refund at Eventbrite comes over on the next run.
    await atProvider(page, connection, { action: 'eb-refund', order: '5550008' });
    await page.getByRole('button', { name: 'Import again to pick up changes' }).click();
    await expect(page.getByText('Import started.', { exact: false })).toBeVisible();
    await runSyncs(page, org);
    await page.goto(`/o/${org}/integrations/${connection}/import`);
    await expect(result.getByRole('row').filter({ hasText: 'Orders' })).toContainText('9 (7 paid)');
    await expect(result.getByRole('row').filter({ hasText: 'Revenue' })).toContainText('$418.47');

    // The connection page sends people to the wizard: no schedule for an importer.
    await page.goto(`/o/${org}/integrations/${connection}`);
    await expect(page.getByRole('link', { name: 'Open import' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
    await expect(page.getByLabel('Sync every')).toHaveCount(0);

    // An imported order says so and offers no refund here.
    const jazz = await jazzPath(page, org);
    await page.goto(`${jazz}/analysis/bookings`);
    await page.getByRole('link', { name: 'Ada Lovelace' }).click();
    await expect(page.getByText('Imported from Eventbrite · order 5550001')).toBeVisible();
    await expect(page.getByRole('button', { name: /Refund/ })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('Google Sheets: link, round trip, a deleted row, a conflict, unlink', async ({ page }) => {
    const org = await ownOrg(page);
    await importEventbrite(page, org);
    const sheets = await connectSheets(page, org);
    const section = page.getByRole('region', { name: 'Linked events' });
    await expect(section.getByText('No events linked yet')).toBeVisible();
    // Inline validation: an event must be chosen.
    await section.getByRole('button', { name: 'Create sheet and link' }).click();
    await expect(section.getByText('Choose the event whose attendees go in the sheet.')).toBeVisible();
    await expectAccessibleBothModes(page);
    await pickOption(section.getByLabel('Event', { exact: true }), 'Summer Jazz Night');
    await section.getByRole('button', { name: 'Create sheet and link' }).click();
    await expect(page.getByText('Sheet created and linked. It fills on the next sync.')).toBeVisible();
    const links = page.getByRole('table', { name: 'Events linked to Google Sheets' });
    await expect(links.getByRole('row').filter({ hasText: 'Summer Jazz Night' })).toContainText('Syncing');
    await expect(
      links.getByRole('link', { name: 'Open Summer Jazz Night · attendees in Google Sheets' }),
    ).toHaveAttribute('href', /^https:\/\/docs\.google\.com\/spreadsheets\/d\/fakesheet_/);

    await runSyncs(page, org);
    let sheet = await sheetRows(page, sheets);
    expect(sheet.headers).toEqual(['Name', 'Email', 'Labels', 'Status']);
    expect(sheet.rows).toHaveLength(8);

    // The organizer fixes a name in the sheet and types in a walk-in guest.
    await atProvider(page, sheets, {
      action: 'sheet-edit',
      email: 'charles@eb-buyers.test',
      'set.name': 'Charles B. Babbage',
    });
    await atProvider(page, sheets, {
      action: 'sheet-add',
      'set.name': 'Walk-in Guest',
      'set.email': 'walk.in@sheet.test',
    });
    await syncNow(page, org, sheets);
    const jazz = await jazzPath(page, org);
    await page.goto(`${jazz}/attendees`);
    await expect(page.getByRole('row').filter({ hasText: 'Charles B. Babbage' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Walk-in Guest' })).toBeVisible();
    // No duplicates either way, however often it runs.
    await syncNow(page, org, sheets);
    sheet = await sheetRows(page, sheets);
    expect(sheet.rows).toHaveLength(9);
    expect(sheet.rows.filter((r) => r.values.email === 'walk.in@sheet.test')).toHaveLength(1);

    // Both sides change Joan; Yayatoh's change is later, so it wins and the sheet's goes to the inbox.
    await atProvider(page, sheets, {
      action: 'sheet-edit',
      email: 'joan@eb-buyers.test',
      'set.labels': 'from-sheet',
    });
    await page.goto(`${jazz}/attendees`);
    await page.getByRole('row').filter({ hasText: 'Joan Clarke' }).getByRole('link').click();
    const profile = page.getByRole('complementary', { name: 'Profile' });
    await profile.getByLabel('Add a label').fill('from-yayatoh');
    await profile.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(profile.getByRole('listitem').filter({ hasText: 'from-yayatoh' })).toBeVisible();
    // And Grace's row is deleted in the sheet.
    await atProvider(page, sheets, { action: 'sheet-delete', email: 'grace@eb-buyers.test' });
    await syncNow(page, org, sheets);
    sheet = await sheetRows(page, sheets);
    expect(sheet.rows.find((r) => r.values.email === 'joan@eb-buyers.test')?.values.labels).toBe(
      'from-yayatoh',
    );

    await page.goto(`/o/${org}/integrations/errors`);
    const conflict = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: /Google Sheets: Changed in both places · 1 record/ }),
    });
    await expect(conflict).toContainText("Changed in both places: Yayatoh's change was kept");
    await expect(conflict).toContainText('Labels: kept “from-yayatoh”, lost “from-sheet”');
    await expect(conflict.getByRole('button', { name: /Retry/ })).toHaveCount(0);
    const deleted = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: /Google Sheets: Reading from the provider · 1 record/ }),
    });
    await expect(deleted).toContainText('Deleted in the sheet');
    await expect(deleted).toContainText('Nobody was removed from the list in Yayatoh.');
    await expect(deleted).toContainText('Needs your decision');
    await expect(deleted.getByRole('button', { name: /Retry/ })).toHaveCount(0);
    await expectAccessibleBothModes(page);
    await deleted.getByRole('button', { name: /^Dismiss all/ }).click();
    await expect(page.getByText('1 record dismissed.')).toBeVisible();
    // Grace is still on the list.
    await page.goto(`${jazz}/attendees`);
    await expect(page.getByRole('row').filter({ hasText: 'Grace Hopper' })).toBeVisible();

    // Unlink, with a confirmation; nothing syncs any more.
    await page.goto(`/o/${org}/integrations/${sheets}`);
    await page.getByRole('link', { name: 'Unlink Summer Jazz Night' }).click();
    await expect(page.getByText('Unlink the sheet of Summer Jazz Night?')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Unlink' }).click();
    await expect(
      page.getByText('Sheet unlinked. Nothing syncs with it any more; it stays in your Google Drive.'),
    ).toBeVisible();
    await expect(links.getByRole('row').filter({ hasText: 'Summer Jazz Night' })).toContainText('Unlinked');
    // It persists.
    await page.goto(`/o/${org}/integrations/${sheets}`);
    await expect(page.getByText('Sheet unlinked.', { exact: false })).toHaveCount(0);
    await expect(links.getByRole('row').filter({ hasText: 'Summer Jazz Night' })).toContainText('Unlinked');
  });

  test('keyboard only: import, then link a sheet', async ({ page }) => {
    const org = await ownOrg(page);
    await page.goto(`/o/${org}/integrations`);
    const connect = page.getByRole('button', { name: 'Connect Eventbrite' });
    await connect.focus();
    await page.keyboard.press('Enter');
    const allow = page.getByRole('button', { name: 'Allow' });
    await allow.focus();
    await page.keyboard.press('Enter');
    const start = page.getByRole('button', { name: 'Import 18 new records' });
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Import started.', { exact: false })).toBeVisible();
    await runSyncs(page, org);

    await page.goto(`/o/${org}/integrations`);
    const sheetsConnect = page.getByRole('button', { name: 'Connect Google Sheets' });
    await sheetsConnect.focus();
    await page.keyboard.press('Enter');
    const allow2 = page.getByRole('button', { name: 'Allow' });
    await allow2.focus();
    await page.keyboard.press('Enter');
    const section = page.getByRole('region', { name: 'Linked events' });
    await stepOption(section.getByLabel('Event', { exact: true }), 0);
    const link = section.getByRole('button', { name: 'Create sheet and link' });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sheet created and linked. It fills on the next sync.')).toBeVisible();
    const unlink = page.getByRole('link', { name: /^Unlink / });
    await unlink.focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('button', { name: 'Unlink' });
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sheet unlinked.', { exact: false })).toBeVisible();
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const org = await ownOrg(page);
    const connection = await importEventbrite(page, org);
    const sheets = await connectSheets(page, org);
    await page.goto(`/ar/o/${org}/integrations/${connection}/import`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'الاستيراد من Eventbrite' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'النتيجة' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${org}/integrations/${sheets}`);
    await expect(page.getByRole('heading', { name: 'الفعاليات المرتبطة' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a viewer cannot open the import wizard', async ({ page }) => {
    await signIn(page, 'jordan@lakeside.test');
    const res = await page.goto(
      '/o/lakeside-events/integrations/01999999-0000-7000-8000-000000000001/import',
    );
    expect(res?.status()).toBe(404);
  });
});
