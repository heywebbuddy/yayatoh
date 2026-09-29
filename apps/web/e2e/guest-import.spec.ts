import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * M4.1b: guest-list import. Paste a list, fix the column mapping, preview the parties, import,
 * download the rejected rows and see the parties on the Guests page; upload the XLSX fixture; a
 * viewer cannot import; keyboard only; Arabic right to left.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';
const FIXTURES = fileURLToPath(new URL('../../../packages/testing/fixtures/guest-import/', import.meta.url));

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

/** A wedding in Chicago, 60 days out, via the one-page form; returns its console path. */
async function createWedding(page: Page, name: string): Promise<string> {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('wedding');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${chicagoDate(60)}T16:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${chicagoDate(60)}T23:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

const pasteForm = (page: Page) => page.getByRole('form', { name: 'Paste from a spreadsheet' });
const expectAlert = (page: Page, text: string) =>
  expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();

/** "Who" is not a header we guess, so the host has to pick the name column. */
const PASTED = [
  'Household\tWho\tAge\tDiet\tPlus one',
  'The Garcias\tLuis Garcia\t\tNo nuts\tyes',
  'The Garcias\tSofía García\tchild\t\t',
  '\tAna Kim\t\t\tJamie Lee',
  '\tBad Row\tteenager\t\t',
  '\t=1+2 Formula\tteen\t\t',
].join('\n');

async function paste(page: Page, text: string) {
  const form = pasteForm(page);
  await form.getByLabel('Your list').fill(text);
  await form.getByRole('button', { name: 'Read the pasted list' }).click();
}

test.describe('guests: import (M4.1b)', () => {
  test('a host pastes a list, fixes the mapping, previews, imports and downloads the rejected rows', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Import Wedding ${s}`);
    await page.goto(`${base}/guests`);
    await page.getByRole('link', { name: 'Import guests' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/guests/import$`));
    await expect(page.getByRole('heading', { name: 'Import guests', level: 1 })).toBeVisible();
    await expect(page.getByText(/Imported guests are never added to marketing lists/)).toBeVisible();
    await expectAccessible(page);

    // Only a header: nothing to read.
    await paste(page, 'Name\tEmail');
    await expectAlert(page, 'The list is empty. Include the header row and at least one guest.');
    // A link that isn't a Google Sheet.
    const google = page.getByRole('form', { name: 'Link a Google Sheet' });
    await google.getByLabel('Google Sheet link').fill('https://example.com/spreadsheets/d/abc');
    await google.getByRole('button', { name: 'Read the sheet' }).click();
    await expectAlert(page, 'Enter a Google Sheets link (https://docs.google.com/spreadsheets/d/…).');

    await paste(page, PASTED);
    await expect(page).toHaveURL(/batch=[0-9a-f-]{36}/);
    const mapping = page.getByRole('form', { name: '2. Match your columns' });
    await expect(page.getByText('Pasted list · 5 rows')).toBeVisible();
    await expect(mapping.getByLabel('Household or party')).toHaveValue('0');
    await expect(mapping.getByLabel('Dietary needs')).toHaveValue('3');
    await expect(mapping.getByLabel('Plus one')).toHaveValue('4');
    await expect(mapping.getByLabel('Full name')).toHaveValue('');
    const sample = page.getByRole('region', { name: 'First rows as read' });
    await expect(sample.getByRole('cell', { name: 'Luis Garcia' })).toBeVisible();
    await expectAccessible(page);

    // No name column yet: refused with the reason.
    await mapping.getByRole('button', { name: 'Check the list' }).click();
    await expectAlert(page, "Choose the column with the guests' names (full name or first name).");
    await page.getByLabel('Full name').selectOption({ label: 'Who' });
    await page.getByRole('button', { name: 'Check the list' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'will be created' })).toHaveText(
      "2 parties with 5 guests will be created. 2 rows can't be imported.",
    );
    const preview = page.getByRole('region', { name: 'Parties to be created' });
    const garcias = preview.getByRole('list', { name: 'Guests in The Garcias' });
    await expect(garcias.getByRole('listitem')).toHaveText([
      'Luis Garcia',
      'Guest of Luis Garcia',
      'Sofía García · Child',
    ]);
    await expect(preview.getByRole('list', { name: 'Guests in Ana Kim' }).getByRole('listitem')).toHaveText([
      'Ana Kim',
      'Jamie Lee (plus one of Ana Kim)',
    ]);
    const rejected = page.getByRole('region', { name: "Rows that can't be imported" });
    await expect(rejected.getByRole('row', { name: /Bad Row/ })).toContainText(
      'Age not recognized (use adult, child, infant or a number)',
    );
    await expect(page.getByRole('list', { name: "Why rows can't be imported" })).toHaveText(
      'Age not recognized (use adult, child, infant or a number) · 2',
    );
    await expectAccessible(page);

    // The rejected rows, as the host's own columns plus the reason; formulas neutralised.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download rejected rows' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('guests-not-imported.csv');
    const csv = readFileSync((await download.path()) as string, 'utf8').replace(/^﻿/, '');
    expect(csv.split('\r\n').filter(Boolean)).toEqual([
      'Household,Who,Age,Diet,Plus one,Problem',
      ',Bad Row,teenager,,,"Age not recognized (use adult, child, infant or a number)"',
      ',\'=1+2 Formula,teen,,,"Age not recognized (use adult, child, infant or a number)"',
    ]);

    await page.getByRole('button', { name: 'Import 2 parties' }).click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toHaveText(
      'Imported 2 parties with 5 guests.',
    );
    await expect(page.getByRole('button', { name: /^Import \d/ })).toHaveCount(0);
    await expectAccessible(page);
    // After a reload it is still done; it can't run twice.
    await page.reload();
    await expect(page.getByText('Imported 2 parties with 5 guests.')).toBeVisible();

    await page.getByRole('link', { name: 'See the guest list' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/guests$`));
    const party = page.getByRole('region', { name: 'The Garcias', exact: true });
    await expect(party.getByText('Luis Garcia', { exact: true })).toBeVisible();
    await expect(party.getByText('Guest of Luis Garcia', { exact: true })).toBeVisible();
    await expect(party.getByText('No nuts')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Ana Kim', exact: true }).getByText('Jamie Lee'),
    ).toBeVisible();
    await party.getByRole('link', { name: 'Show history of The Garcias' }).click();
    const history = page.getByRole('region', { name: 'History of The Garcias' });
    await expect(history.getByText(/^Party added · Import · by you/)).toBeVisible();
    await expect(history.getByText(/^Guest added · Luis Garcia · Import/)).toBeVisible();
    await expect(history.getByText(/^Plus-one added · Guest of Luis Garcia · Import/)).toBeVisible();
    await expectAccessible(page);
  });

  test('upload the XLSX fixture: every column guessed, three parties imported', async ({ page }) => {
    test.setTimeout(60_000);
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Excel Wedding ${s}`);
    await page.goto(`${base}/guests/import`);
    const upload = page.getByRole('form', { name: 'Upload a file' });
    // A sheet that isn't in the workbook.
    await upload.getByLabel('CSV or Excel file').setInputFiles(`${FIXTURES}guests.xlsx`);
    await upload.getByLabel('Sheet name (optional)').fill('Nope');
    await upload.getByRole('button', { name: 'Upload the file' }).click();
    await expectAlert(page, 'The workbook has no sheet with that name.');
    // A file that isn't a spreadsheet.
    await upload.getByLabel('CSV or Excel file').setInputFiles({
      name: 'old.xls',
      mimeType: 'application/vnd.ms-excel',
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    });
    await upload.getByRole('button', { name: 'Upload the file' }).click();
    await expectAlert(
      page,
      "Old Excel files (.xls) can't be read. Save the file as .xlsx or CSV and upload it again.",
    );

    await upload.getByLabel('CSV or Excel file').setInputFiles(`${FIXTURES}guests.xlsx`);
    await upload.getByRole('button', { name: 'Upload the file' }).click();
    await expect(page.getByText('Excel file guests.xlsx, sheet “Guests” · 6 rows')).toBeVisible();
    await expect(page.getByText(/This workbook also has: Old list\./)).toBeVisible();
    const mapping = page.getByRole('form', { name: '2. Match your columns' });
    for (const [label, header] of [
      ['Household or party', 'Household'],
      ['First name', 'First name'],
      ['Last name', 'Last name'],
      ['Email', 'Email'],
      ['Home address', 'Address'],
      ['Plus one', 'Plus one'],
    ] as const)
      await expect(mapping.getByLabel(label, { exact: true }).locator('option:checked')).toHaveText(header);
    await mapping.getByRole('button', { name: 'Check the list' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'will be created' })).toHaveText(
      "3 parties with 7 guests will be created. 1 row can't be imported.",
    );
    await page.getByRole('button', { name: 'Import 3 parties' }).click();
    await expect(page.getByText('Imported 3 parties with 7 guests.')).toBeVisible();
    await page.goto(`${base}/guests`);
    for (const name of ['The Garcias', 'Ana Kim', 'Okafor family'])
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Okafor family', exact: true }).getByText('Guest of Chidi Okafor'),
    ).toBeVisible();
    await expect(page.getByText('luis@example.test')).toBeVisible();
  });

  test('keyboard only: paste, check and import', async ({ page }) => {
    test.setTimeout(60_000);
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Keyboard Import ${s}`);
    await page.goto(`${base}/guests/import`);
    await pasteForm(page).getByLabel('Your list').focus();
    await page.keyboard.insertText(`Name\tSide\nKey Board\tBride\nTab Stop\tGroom`);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Read the pasted list' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/batch=/);
    const check = page.getByRole('button', { name: 'Check the list' });
    await check.focus();
    await page.keyboard.press('Enter');
    const start = page.getByRole('button', { name: 'Import 2 parties' });
    await expect(start).toBeVisible();
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Imported 2 parties with 2 guests.')).toBeVisible();
    await page.getByRole('link', { name: 'See the guest list' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Key Board', exact: true })).toBeVisible();
  });

  test('a viewer cannot import: no link, no forms, and the server refuses their action', async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000);
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Viewer Import ${s}`);
    await page.goto(`${base}/guests/import`);
    await paste(page, 'Name\nSneaky Guest');
    await page.getByRole('button', { name: 'Check the list' }).click();
    await expect(page.getByRole('button', { name: 'Import 1 party' })).toBeVisible();
    const batchUrl = page.url();

    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/guests`);
    await expect(viewer.getByRole('link', { name: 'Import guests' })).toHaveCount(0);
    await viewer.goto(`${base}/guests/import`);
    await expect(viewer.getByText("You can't import guests")).toBeVisible();
    await expect(viewer.getByRole('form')).toHaveCount(0);
    await viewer.goto(batchUrl);
    await expect(viewer.getByText("You can't import guests")).toBeVisible();
    await expect(viewer.getByRole('button', { name: /^Import/ })).toHaveCount(0);
    const res = await viewer.request.get(
      `${base}/guests/import/${new URL(batchUrl).searchParams.get('batch')}/rejected`,
    );
    expect(res.status()).toBe(404);
    await expectAccessible(viewer);
    await viewerContext.close();

    // The owner's open form, submitted as the viewer: refused by the server; nothing imported.
    await signIn(page, VIEWER);
    await page.getByRole('button', { name: 'Import 1 party' }).click();
    await expect(page.getByText("You can't import guests")).toBeVisible();
    await signIn(page);
    await page.goto(`${base}/guests`);
    await expect(page.getByText('Sneaky Guest')).toHaveCount(0);
  });

  test('Arabic: the import page renders right to left', async ({ page }) => {
    test.setTimeout(60_000);
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `RTL Import ${s}`);
    await page.goto(`/ar${base}/guests/import`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'استيراد الضيوف', level: 1 })).toBeVisible();
    await expectAccessible(page);
    const form = page.getByRole('form', { name: 'اللصق من جدول بيانات' });
    await form.getByLabel('قائمتك').fill('الاسم\tالعائلة\nليلى حسن\tآل حسن\nعمر حسن\tآل حسن');
    await form.getByRole('button', { name: 'قراءة القائمة الملصقة' }).click();
    await expect(page.getByRole('form', { name: '2. طابِق الأعمدة' }).getByLabel('الاسم الكامل')).toHaveValue(
      '0',
    );
    await page.getByRole('button', { name: 'مراجعة القائمة' }).click();
    await expect(page.getByRole('heading', { name: 'المجموعات التي ستُنشأ' })).toBeVisible();
    await expectAccessible(page);
  });
});
