import { readFileSync } from 'node:fs';
import { type Download, expect, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, pickOption, signIn } from './helpers.ts';
import { quickPlan } from './seating-helpers.ts';

/**
 * M4.3b cards and exports: place, escort and table cards as a PDF (paper size, card language with
 * Arabic RTL), the seating chart and caterer meal counts as CSV or XLSX, keyboard only. Plus the
 * empty states, inline validation, the viewer (prints, never exports) and the Arabic page.
 */

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

async function createWedding(page: Page, name: string): Promise<string> {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'wedding');
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${chicagoDate(60)}T16:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${chicagoDate(60)}T23:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

const partyRegion = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function addParty(page: Page, name: string) {
  const add = page.getByRole('region', { name: 'Add party' });
  await add.getByLabel('Party name').fill(name);
  await add.getByRole('button', { name: 'Add party' }).click();
  await expect(add.getByText('Party added.')).toBeVisible();
  await expect(partyRegion(page, name)).toBeVisible();
}

async function addGuest(page: Page, partyName: string, first: string, meal?: string) {
  const p = partyRegion(page, partyName);
  const summary = `Add a guest to ${partyName}`;
  const form = page.getByRole('region', { name: summary, exact: true });
  if (!(await form.isVisible())) await p.getByText(summary, { exact: true }).click();
  await form.getByLabel('First name').fill(first);
  await form.getByLabel('Last name').fill('X');
  if (meal) await form.getByLabel('Meal').fill(meal);
  await form.getByRole('button', { name: 'Add guest' }).click();
  await expect(form.getByText('Guest added.')).toBeVisible();
  await expect(p.getByText(`${first} X`, { exact: true })).toBeVisible();
}

/** A wedding with two tables of 4, Garcia (Luis, Ana: Beef) and Chen (Mei), as the owner. */
async function wedding(page: Page, name: string, { plan = true } = {}) {
  const base = await createWedding(page, name);
  if (plan) await quickPlan(page, base, { tables: 2, seatsPerTable: 4, stage: false });
  await page.goto(`${base}/guests`);
  await addParty(page, 'Garcia');
  await addGuest(page, 'Garcia', 'Luis', 'Beef');
  await addGuest(page, 'Garcia', 'Ana', 'Beef');
  await addParty(page, 'Chen');
  await addGuest(page, 'Chen', 'Mei');
  return base;
}

/** Seat a whole party at a table from the seating editor, by keyboard. */
async function seatParty(page: Page, base: string, party: string, table: string) {
  await page.goto(`${base}/seating/guests`);
  await page.getByRole('checkbox', { name: `Select everyone in ${party}` }).focus();
  await page.keyboard.press('Space');
  const chooser = page.getByLabel('Table or row', { exact: true }).first();
  await pickOption(chooser, { label: new RegExp(`^${table} — `) });
  await page.getByRole('button', { name: 'Seat selected guests' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(new RegExp(`Seated \\d guests? at ${table}\\.`))).toBeVisible();
}

const bytes = async (d: Download) => readFileSync((await d.path()) as string);

async function pressForDownload(page: Page, focus: () => Promise<void>): Promise<Download> {
  await focus();
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  return download;
}

test.describe('cards and exports (M4.3b)', () => {
  test('keyboard only: cards as PDF in English and Arabic, chart and meal counts as CSV and XLSX', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const s = stamp();
    await signIn(page);
    const base = await wedding(page, `Cards ${s}`);
    await seatParty(page, base, 'Garcia', 'Table 1');

    // The tab is on every seating view, reached by keyboard.
    await page.goto(`${base}/seating/guests`);
    await page
      .getByRole('navigation', { name: 'Seating views' })
      .getByRole('link', { name: 'Cards and exports' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Cards and exports', level: 1 })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Place cards' })).toBeChecked();
    await expect(page.getByText('2 cards: one per seated guest, a tent card folded in half')).toBeVisible();
    await expect(page.getByText('1 card: one per party at each table, for the entrance')).toBeVisible();
    await expect(page.getByText('2 cards: one per table, a sheet folded in half')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Place cards on A4 in English: one primary action, a download and a success line.
    await pickOption(page.getByLabel('Paper size'), 'a4');
    const place = await pressForDownload(page, () =>
      page.getByRole('button', { name: 'Download PDF' }).focus(),
    );
    expect(place.suggestedFilename()).toMatch(/-place-cards-a4\.pdf$/);
    expect((await bytes(place)).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(page.getByRole('status').filter({ hasText: 'Your PDF is being prepared' })).toBeVisible();

    // Escort cards on US Letter in Arabic, chosen with the arrow keys and the keyboard.
    await page.getByRole('radio', { name: 'Place cards' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Escort cards' })).toBeChecked();
    await pickOption(page.getByLabel('Paper size'), 'letter');
    await pickOption(page.getByLabel('Card language'), 'ar');
    const escort = await pressForDownload(page, () =>
      page.getByRole('button', { name: 'Download PDF' }).focus(),
    );
    expect(escort.suggestedFilename()).toMatch(/-escort-cards-letter\.pdf$/);
    const pdf = await bytes(escort);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // US Letter: 612 × 792 points.
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 612 792\]/);

    // Table cards on A5.
    await page.getByRole('radio', { name: 'Table cards' }).check();
    await pickOption(page.getByLabel('Paper size'), 'a5');
    const table = await pressForDownload(page, () =>
      page.getByRole('button', { name: 'Download PDF' }).focus(),
    );
    expect(table.suggestedFilename()).toMatch(/-table-cards-a5\.pdf$/);

    // Exports: the seating chart as CSV (headers in English, a line per guest, unseated last).
    const exports = page.getByRole('region', { name: 'Exports' });
    const csv = await pressForDownload(page, () =>
      exports.getByRole('link', { name: 'Download Seating chart by table as CSV' }).focus(),
    );
    expect(csv.suggestedFilename()).toMatch(/-seating-chart\.csv$/);
    const lines = (await bytes(csv)).toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toEqual([
      'Table,Guest,Party,Age,Meal,Reply',
      'Table 1,Luis X,Garcia,Adult,Beef,Awaiting reply',
      'Table 1,Ana X,Garcia,Adult,Beef,Awaiting reply',
      'Not seated,Mei X,Chen,Adult,,Awaiting reply',
    ]);
    // Meal counts as CSV and as XLSX.
    const meals = await pressForDownload(page, () =>
      exports.getByRole('link', { name: 'Download Caterer meal counts as CSV' }).focus(),
    );
    expect((await bytes(meals)).toString('utf8').replace(/^﻿/, '').trim().split('\r\n')).toEqual([
      'Table,Beef,Not chosen,Children,Infants,Total',
      'Table 1,2,0,0,0,2',
      'Table 2,0,0,0,0,0',
      'Not seated,0,1,0,0,1',
      'Total,2,1,0,0,3',
    ]);
    const xlsx = await pressForDownload(page, () =>
      exports.getByRole('link', { name: 'Download Caterer meal counts as Excel (XLSX)' }).focus(),
    );
    expect(xlsx.suggestedFilename()).toMatch(/-meal-counts\.xlsx$/);
    expect((await bytes(xlsx)).subarray(0, 2).toString()).toBe('PK');
    const chartXlsx = await pressForDownload(page, () =>
      exports.getByRole('link', { name: 'Download Seating chart by table as Excel (XLSX)' }).focus(),
    );
    expect((await bytes(chartXlsx)).subarray(0, 2).toString()).toBe('PK');

    // A bad request to the PDF route is refused with a reason, never an empty file.
    const bad = await page.request.get(`${base}/seating/cards/pdf?kind=menu&paper=a4`);
    expect(bad.status()).toBe(400);

    // Arabic, right to left: the same page and an Arabic-headed CSV.
    await page.goto(`/ar${base}/seating/cards`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'البطاقات والتصدير', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'تنزيل PDF' })).toBeVisible();
    await expectAccessible(page);
    const arCsv = await page.request.get(`/ar${base}/seating/cards/export?kind=chart&format=csv`);
    expect(arCsv.status()).toBe(200);
    expect((await arCsv.text()).replace(/^﻿/, '').split('\r\n')[0]).toBe(
      'الطاولة,الضيف,المجموعة,العمر,الوجبة,الرد',
    );
  });

  test('empty states: no plan, then nobody seated (inline error, no download)', async ({ page }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const base = await wedding(page, `Cards Empty ${s}`, { plan: false });
    await page.goto(`${base}/seating/cards`);
    await expect(page.getByText('Whole event has no seating plan yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
    await expectAccessible(page);

    await quickPlan(page, base, { tables: 2, seatsPerTable: 4, stage: false });
    await page.goto(`${base}/seating/cards`);
    // Nobody seated yet: table cards are chosen, and the next step is offered.
    await expect(page.getByRole('radio', { name: 'Table cards' })).toBeChecked();
    await expect(
      page.getByText('No cards yet: one per seated guest, a tent card folded in half'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Seat guests' }).last()).toBeVisible();
    await page.getByRole('radio', { name: 'Place cards' }).check();
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    await page.getByRole('button', { name: 'Download PDF' }).focus();
    await page.keyboard.press('Enter');
    const error = page.getByText(
      'No guests are seated yet, so there are no place cards to print. Seat your guests first.',
    );
    await expect(error).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Place cards' })).toBeFocused();
    await expectAccessible(page);
    // Choosing another kind clears the error; table cards download.
    await page.getByRole('radio', { name: 'Table cards' }).check();
    await expect(error).toHaveCount(0);
    expect(downloaded).toBe(false);
    const [table] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    expect(table.suggestedFilename()).toMatch(/-table-cards-/);
  });

  test('a viewer prints cards but never sees or reaches the exports', async ({ page }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const base = await wedding(page, `Cards Viewer ${s}`);
    await seatParty(page, base, 'Chen', 'Table 2');
    await signIn(page, VIEWER);
    await page.goto(`${base}/seating/cards`);
    await expect(page.getByRole('heading', { name: 'Cards and exports', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Exports' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /as CSV/ })).toHaveCount(0);
    await expectAccessible(page);
    const pdf = await page.request.get(`${base}/seating/cards/pdf?kind=place&paper=letter&lang=en`);
    expect(pdf.status()).toBe(200);
    for (const q of ['kind=chart&format=csv', 'kind=meals&format=xlsx']) {
      const res = await page.request.get(`${base}/seating/cards/export?${q}`);
      expect(res.status()).toBe(404);
    }
  });
});
