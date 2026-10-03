import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, pickOption, signIn } from './helpers.ts';
import { addGuests, holdSeats, seatedGala, unique } from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });

test.describe('the Seat column (M1.7g)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('the attendee list, its export and the order page show each person’s seat', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Seat Column Gala'));
    const stamp = Date.now();
    const ann = `Ann Seat ${stamp}`;
    const ben = `Ben Seat ${stamp}`;
    await addGuests(page, base, [ann, ben]);

    // Ann is seated by the organizer (keyboard-free form, M1.7d); Ben stays unseated.
    await page.goto(`${base}/seating/assign`);
    await page.getByRole('checkbox', { name: ann }).check();
    await pickOption(page.getByLabel('Table or row'), { label: 'Table 1 — 4 of 4 free' });
    await pickOption(page.getByLabel('Seat', { exact: true }), { label: 'Table 1 · 3' });
    await page.getByRole('button', { name: 'Seat them' }).click();
    await expect(page.getByText(`Seated 1 person at Table 1.`)).toBeVisible();

    // A buyer takes Table 2 · 1 and pays.
    const buyer = await (await browser.newContext()).newPage();
    const cy = `Cy Buyer ${stamp}`;
    await holdSeats(buyer, slug, ['Table 2 · 1'], cy);
    await buyer.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(buyer.getByText('Seat: Table 2 · 1').first()).toBeVisible();

    // The list: seat labels, "—" for no seat.
    await page.goto(`${base}/attendees`);
    const list = page.getByRole('table').first();
    await expect(list.getByRole('columnheader', { name: 'Seat' })).toBeVisible();
    await expect(row(page, ann)).toContainText('Table 1 · 3');
    await expect(row(page, ben)).toContainText('—');
    await expect(row(page, cy)).toContainText('Table 2 · 1');
    await expectAccessible(page);

    // The profile panel names the seat too (keyboard: open it from the list).
    await row(page, ann).getByRole('link').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('definition').filter({ hasText: 'Table 1 · 3' })).toBeVisible();

    // The export carries the Seat column.
    await page.goto(`${base}/attendees`);
    const bulk = page.getByRole('form', { name: 'Bulk actions' });
    await bulk.getByLabel('All 3 matching').check();
    await pickOption(bulk.getByLabel('Action'), { label: 'Export as CSV' });
    await bulk.getByRole('button', { name: 'Apply' }).click();
    const panel = page.getByRole('region', { name: 'Attendee export' });
    await expect(panel).toContainText('Ready: 3 rows exported.');
    const href = await panel.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
    const csv = await (await page.request.get(href ?? '')).text();
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]?.endsWith(',Seat')).toBe(true);
    expect(lines.find((l) => l.startsWith(`${ann},`))?.endsWith(',Table 1 · 3')).toBe(true);
    expect(lines.find((l) => l.startsWith(`${cy},`))?.endsWith(',Table 2 · 1')).toBe(true);
    expect(lines.find((l) => l.startsWith(`${ben},`))?.endsWith(',')).toBe(true);

    // The organizer's order page has a Seat column.
    await page.goto(`${base}/tickets-orders`);
    await page.getByRole('link', { name: cy }).first().click();
    const tickets = page.getByRole('table', { name: 'Tickets' });
    await expect(tickets.getByRole('columnheader', { name: 'Seat' })).toBeVisible();
    await expect(tickets.getByRole('cell', { name: 'Table 2 · 1', exact: true })).toBeVisible();
    await expectAccessible(page);

    // A viewer sees the seats but can't export; a stale page's export is refused.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/attendees`);
    await expect(row(viewer, ann)).toContainText('Table 1 · 3');
    await expect(viewer.getByRole('form', { name: 'Bulk actions' })).toHaveCount(0);
    await page.goto(`${base}/attendees`);
    await bulk.getByLabel('All 3 matching').check();
    await pickOption(bulk.getByLabel('Action'), { label: 'Export as CSV' });
    await signIn(page, VIEWER);
    await bulk.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Attendee export' })).toHaveCount(0);

    // Arabic, right to left.
    await signIn(page);
    await page.goto(`/ar${base}/attendees`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('columnheader', { name: 'المقعد' })).toBeVisible();
    await expect(row(page, ann)).toContainText('Table 1 · 3');
    await expectAccessible(page);
  });
});
