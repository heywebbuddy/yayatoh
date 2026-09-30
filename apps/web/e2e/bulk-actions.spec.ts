import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';
import { addGuests, createGala, quickPlan, unique } from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';

/** `YYYY-MM-DDTHH:mm` wall-clock time in Chicago, `offsetH` hours from now (for datetime-local). */
function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetH * 3_600_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** A published event happening now (check-in open), with free ticket types; its console path. */
async function liveEvent(page: Page, name: string, types: readonly string[]) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('gala');
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  for (const type of types) {
    await page.getByLabel('Name', { exact: true }).fill(type);
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('20');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: type })).toBeVisible();
  }
  return base;
}

/** A buyer takes one free ticket of a type; returns its short code. */
async function buy(browser: Browser, base: string, type: string, who: string) {
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(`/events/${base.split('/').pop()}`);
  await buyer.getByLabel(`Quantity — ${type}`).selectOption('1');
  await buyer.getByLabel('Full name').fill(who);
  const email = `${who.toLowerCase().replace(/\W+/g, '.')}@example.test`;
  await buyer.getByLabel('Email for your tickets').fill(email);
  await continueToPayment(buyer, email);
  await expect(buyer).toHaveURL(/\/orders\//);
  const code = (await buyer.locator('.tracking-\\[0\\.2em\\]').first().textContent())?.trim() ?? '';
  await buyer.close();
  return code;
}

/** Choose an option of a focused native select with the arrow keys only. */
async function arrowTo(page: Page, select: Locator, label: string) {
  await expect(select).toBeFocused();
  for (let i = 0; i < 12; i++) {
    if ((await select.locator('option:checked').textContent())?.trim() === label) return;
    await page.keyboard.press('ArrowDown');
  }
  await expect(select.locator('option:checked')).toHaveText(label);
}

const bulkForm = (page: Page) => page.getByRole('form', { name: 'Bulk actions' });
const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });

test.describe('bulk seat assignment (M1.8f)', () => {
  test('keyboard only: seat everyone matching at a table, see progress and who did not fit, undo', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const name = unique('Bulk Seat Gala');
    const people = ['Ada', 'Bo', 'Cy', 'Di', 'Ed'].map((n) => `${n} ${name}`);
    await signIn(page);
    const base = await createGala(page, name);
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
    await addGuests(page, base, people);

    await page.goto(`${base}/attendees`);
    const bulk = bulkForm(page);
    await bulk.getByLabel('All 5 matching').focus();
    await page.keyboard.press('Space');
    await expect(bulk.getByLabel('All 5 matching')).toBeChecked();
    await page.keyboard.press('Tab');
    await arrowTo(page, bulk.getByLabel('Action', { exact: true }), 'Assign seats');
    await page.keyboard.press('Tab');
    const target = bulk.getByLabel('Seat them in', { exact: true });
    await expect(target.locator('option:checked')).toHaveText('Best available seats — 8 free');
    await arrowTo(page, target, 'Table 1 — 4 of 4 free');
    await expect(bulk).toContainText('You can undo for 10 minutes.');
    await expectAccessible(page);
    await page.keyboard.press('Tab');
    await expect(bulk.getByRole('button', { name: 'Apply' })).toBeFocused();
    await page.keyboard.press('Enter');

    const panel = page.getByRole('region', { name: 'Seat assignment' });
    await expect(panel.getByRole('status')).toHaveText('Seated 4 people of 5.');
    const progress = panel.getByRole('progressbar', { name: 'Progress: 5 of 5' });
    await expect(progress).toHaveAttribute('value', '5');
    await expect(progress).toHaveAttribute('max', '5');
    await expect(panel).toContainText('1 failed: no free seat left there');
    await expectAccessible(page);

    // It persists: the plan shows the four at Table 1, the fifth still to seat.
    await page.reload();
    await expect(panel.getByRole('status')).toHaveText('Seated 4 people of 5.');
    await page.goto(`${base}/seating/assign`);
    const table1 = page.getByRole('region', { name: 'Table 1', exact: true });
    for (const who of people.slice(0, 4)) await expect(table1).toContainText(who);
    await expect(page.getByRole('list', { name: 'People still to seat' })).toContainText(people[4] as string);

    // Undo by keyboard restores everyone's previous state (no seat).
    await page.goBack();
    await panel.getByRole('button', { name: 'Undo' }).focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('status')).toHaveText('Undone: 4 restored.');
    await page.goto(`${base}/seating/assign`);
    await expect(page.getByRole('region', { name: 'Table 1', exact: true })).toContainText('No one yet.');
    await expect(page.getByRole('list', { name: 'People still to seat' }).getByRole('listitem')).toHaveCount(
      5,
    );
  });

  test('one selected person gets the best available seat; an empty selection is refused', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const name = unique('Bulk Best Gala');
    const [ann, ben] = ['Ann', 'Ben'].map((n) => `${n} ${name}`) as [string, string];
    await signIn(page);
    const base = await createGala(page, name);
    await quickPlan(page, base, { tables: 1, seatsPerTable: 2 });
    await addGuests(page, base, [ann, ben]);
    await page.goto(`${base}/attendees`);
    await page.getByLabel(`Select ${ann}`).check();
    const bulk = bulkForm(page);
    await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Assign seats' });
    await bulk.getByRole('button', { name: 'Apply' }).click();
    const panel = page.getByRole('region', { name: 'Seat assignment' });
    await expect(panel.getByRole('status')).toHaveText('Seated 1 person of 1.');
    await expect(panel.getByRole('button', { name: 'Undo' })).toBeVisible();
    // Nothing selected: refused with a message.
    await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Assign seats' });
    await bulk.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Some details need fixing.' })).toBeVisible();
  });
});

test.describe('bulk ticket actions (M1.8f)', () => {
  test('resend tickets: holders get them again; a guest without a ticket is reported', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const name = unique('Resend Night');
    await signIn(page);
    const base = await liveEvent(page, name, ['Pass']);
    for (const who of ['Ann', 'Ben']) await buy(browser, base, 'Pass', `${who} ${name}`);
    await addGuests(page, base, [`Gus ${name}`]);
    await page.goto(`${base}/attendees`);
    const bulk = bulkForm(page);
    await bulk.getByLabel('All 3 matching').check();
    await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Resend tickets' });
    await expect(bulk).toContainText('Everyone with a ticket gets it again by email');
    await expectAccessible(page);
    await bulk.getByRole('button', { name: 'Apply' }).click();
    const panel = page.getByRole('region', { name: 'Resent tickets' });
    await expect(panel.getByRole('status')).toHaveText('Sent 2 tickets again.');
    await expect(panel).toContainText('1 failed: no ticket (guest list only)');
    await expect(panel.getByRole('progressbar', { name: 'Progress: 3 of 3' })).toBeVisible();
    // Resending can't be undone (the emails are out).
    await expect(panel.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expectAccessible(page);
  });

  test('cancel tickets: the confirmation names the count, keeping them changes nothing, cancelling voids them', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const name = unique('Cancel Night');
    const [ann, ben] = [`Ann ${name}`, `Ben ${name}`];
    await signIn(page);
    const base = await liveEvent(page, name, ['Pass']);
    await buy(browser, base, 'Pass', ann);
    await buy(browser, base, 'Pass', ben);
    await page.goto(`${base}/attendees`);
    const bulk = bulkForm(page);
    await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Cancel tickets (no refund)' });
    await expect(bulk).toContainText('No money is refunded');
    // Nobody selected yet.
    await bulk.getByRole('button', { name: 'Review cancellation…' }).click();
    await expect(bulk.getByRole('alert')).toHaveText('Select at least one person first.');

    await page.getByLabel(`Select ${ann}`).check();
    await bulk.getByRole('button', { name: 'Review cancellation…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel the tickets of 1 person?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Nobody is refunded');
    await expectAccessible(page);
    // Escape (or "Keep the tickets") backs out: nothing changes.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await bulk.getByRole('button', { name: 'Review cancellation…' }).click();
    await dialog.getByRole('button', { name: 'Keep the tickets' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('region', { name: 'Cancelled tickets' })).toHaveCount(0);

    await bulk.getByRole('button', { name: 'Review cancellation…' }).click();
    await dialog.getByRole('button', { name: 'Cancel tickets for 1 person' }).click();
    const panel = page.getByRole('region', { name: 'Cancelled tickets' });
    await expect(panel.getByRole('status')).toHaveText('Cancelled 1 ticket.');
    await expect(panel.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expectAccessible(page);

    // Persisted: Ann is cancelled, Ben is not.
    await page.goto(`${base}/attendees?status=cancelled`);
    await expect(row(page, ann)).toBeVisible();
    await expect(row(page, ben)).toHaveCount(0);
    // A cancelled ticket is refused at the door.
    await page.goto(`${base}/attendees?status=active`);
    await expect(row(page, ben)).toBeVisible();
  });

  test('a cancelled ticket no longer admits at the door', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const name = unique('Door Cancel');
    const who = `Hal ${name}`;
    await signIn(page);
    const base = await liveEvent(page, name, ['Pass']);
    const code = await buy(browser, base, 'Pass', who);
    await page.goto(`${base}/attendees`);
    await page.getByLabel(`Select ${who}`).check();
    const bulk = bulkForm(page);
    await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Cancel tickets (no refund)' });
    await bulk.getByRole('button', { name: 'Review cancellation…' }).click();
    await page.getByRole('button', { name: 'Cancel tickets for 1 person' }).click();
    await expect(page.getByRole('region', { name: 'Cancelled tickets' }).getByRole('status')).toHaveText(
      'Cancelled 1 ticket.',
    );
    await page.goto(`${base}/onsite`);
    const field = page.getByLabel('Ticket code');
    await field.fill(code);
    await field.press('Enter');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    await expect(result).not.toContainText('Welcome in');
  });
});

test.describe('attendee filters: ticket type and check-in (M1.8f)', () => {
  test('filter on the server, combine filters, keep them after reload, export what matches', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const name = unique('Filter Night');
    const [ann, ben, cy, gus] = ['Ann', 'Ben', 'Cy', 'Gus'].map((n) => `${n} ${name}`) as [
      string,
      string,
      string,
      string,
    ];
    await signIn(page);
    const base = await liveEvent(page, name, ['General', 'VIP']);
    await buy(browser, base, 'General', ann);
    const benCode = await buy(browser, base, 'VIP', ben);
    await buy(browser, base, 'VIP', cy);
    await addGuests(page, base, [gus]);
    // Ben is checked in at the door.
    await page.goto(`${base}/onsite`);
    await page.getByLabel('Ticket code').fill(benCode);
    await page.getByLabel('Ticket code').press('Enter');
    await expect(page.getByRole('status').filter({ has: page.locator('[data-result]') })).toContainText(
      'Welcome in',
    );

    await page.goto(`${base}/attendees`);
    const search = page.getByRole('search');
    await search.getByLabel('Ticket type', { exact: true }).selectOption({ label: 'VIP' });
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(row(page, ben)).toBeVisible();
    await expect(row(page, cy)).toBeVisible();
    await expect(row(page, ann)).toHaveCount(0);
    await expect(row(page, gus)).toHaveCount(0);

    await search.getByLabel('Check-in', { exact: true }).selectOption({ label: 'Not checked in' });
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(row(page, cy)).toBeVisible();
    await expect(row(page, ben)).toHaveCount(0);
    await expect(page.getByText('1–1 of 1 · filtered')).toBeVisible();
    await expectAccessible(page);
    // Kept after a reload (they live in the address).
    await page.reload();
    await expect(search.getByLabel('Ticket type', { exact: true }).locator('option:checked')).toHaveText(
      'VIP',
    );
    await expect(search.getByLabel('Check-in', { exact: true }).locator('option:checked')).toHaveText(
      'Not checked in',
    );
    await expect(row(page, cy)).toBeVisible();

    // Not checked in, any ticket type: guests without a ticket count too.
    await search.getByLabel('Ticket type', { exact: true }).selectOption({ label: 'Any ticket type' });
    await search.getByRole('button', { name: 'Search' }).click();
    for (const who of [ann, cy, gus]) await expect(row(page, who)).toBeVisible();
    await expect(row(page, ben)).toHaveCount(0);

    // Checked in today, General only: no one — the empty state.
    await search.getByLabel('Ticket type', { exact: true }).selectOption({ label: 'General' });
    await search.getByLabel('Check-in', { exact: true }).selectOption({ label: 'Checked in today' });
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No matches')).toBeVisible();
    await expectAccessible(page);

    // Checked in today, any type: Ben; the export of everything matching carries only him.
    await search.getByLabel('Ticket type', { exact: true }).selectOption({ label: 'Any ticket type' });
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(row(page, ben)).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2);
    const bulk = bulkForm(page);
    await bulk.getByLabel('The 1 matching').check();
    await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Export as CSV' });
    await bulk.getByRole('button', { name: 'Apply' }).click();
    const exportPanel = page.getByRole('region', { name: 'Attendee export' });
    await expect(exportPanel).toContainText('Ready: 1 rows exported.');
    const href = await exportPanel.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
    const csv = await (await page.request.get(href ?? '')).text();
    expect(csv).toContain(`${ben},`);
    expect(csv).not.toContain(cy);
    expect(csv.trim().split('\r\n')).toHaveLength(2);
    // Checked in, then the Seat column (empty: no seating plan here).
    expect(csv.trim().endsWith(',Yes,')).toBe(true);

    // Labels on "everything matching" follow the check-in filter too.
    await bulk.getByLabel('The 1 matching').check();
    await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Add label' });
    await bulk.getByLabel('Label', { exact: true }).fill('Arrived');
    await bulk.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('region', { name: 'Bulk labels' })).toContainText(
      'Done: 1 of 1 updated, 0 failed.',
    );
    await page.goto(`${base}/attendees?label=Arrived`);
    await expect(row(page, ben)).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2);
  });
});

test.describe('group seat blocks (M1.8f)', () => {
  test('keep seats for a group, with every validation message; seat its members; release the rest', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const name = unique('Group Gala');
    const label = `Acme ${test.info().project.name.split('-')[0]}`;
    await signIn(page);
    const base = await createGala(page, name);
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
    await page.goto(`${base}/attendees`);
    await page
      .getByText(/^Add (attendee|guest)/i)
      .first()
      .click();
    for (const who of ['Kai', 'Lu']) {
      await page.getByLabel('Full name').fill(`${who} ${name}`);
      await page.getByLabel('Email', { exact: true }).fill(`${who.toLowerCase()}.${Date.now()}@example.test`);
      await page.getByLabel('Label (optional)').fill(label);
      await page.getByRole('button', { name: 'Add to the list' }).click();
      await expect(row(page, `${who} ${name}`)).toBeVisible();
    }

    await page.goto(`${base}/seating/assign`);
    const groups = page.getByRole('region', { name: 'Group blocks' });
    await expect(groups).toContainText('No group has seats kept yet.');
    await expectAccessible(page);
    const form = groups.getByRole('form', { name: 'Keep seats for a group' });
    const submit = form.getByRole('button', { name: 'Keep seats' });
    const alert = form.getByRole('alert');
    await submit.click();
    await expect(alert).toHaveText('Enter the group’s label (up to 40 characters).');
    await expect(form.getByLabel('Group (label)', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await form.getByLabel('Group (label)', { exact: true }).fill(label);
    await submit.click();
    await expect(alert).toHaveText('Choose where to keep the seats.');
    await form.getByLabel('Keep seats at', { exact: true }).selectOption({ label: 'Table 2 — 4 of 4 free' });
    await form.getByLabel('Number of seats', { exact: true }).fill('0');
    await submit.click();
    await expect(alert).toHaveText('Enter a number of seats from 1 to 2,000, or leave it empty.');
    await form.getByLabel('Number of seats', { exact: true }).fill('5');
    await submit.click();
    await expect(alert).toHaveText('Only 4 seats are free there.');
    await expectAccessible(page);

    // Keyboard: three seats at Table 2.
    await form.getByLabel('Number of seats', { exact: true }).fill('3');
    await form.getByLabel('Number of seats', { exact: true }).press('Enter');
    await expect(form.getByRole('status')).toHaveText(`Kept 3 seats at Table 2 for ${label}.`);
    const list = groups.getByRole('list', { name: 'Groups with kept seats' });
    await expect(list).toContainText(`${label} · 3 seats at Table 2 · 0 seated · 3 unused`);
    // The plan shows them kept back, and a reload keeps them.
    await page.reload();
    await expect(list).toContainText(`${label} · 3 seats at Table 2 · 0 seated · 3 unused`);
    await expectAccessible(page);

    // Seat the members into the block: a bulk operation, shown on the attendee list.
    await list.getByRole('button', { name: `Seat the ${label} group` }).focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Seat assignment' });
    await expect(panel.getByRole('status')).toHaveText('Seated 2 people of 2.');
    await expect(page).toHaveURL(/label=/);
    await page.goto(`${base}/seating/assign`);
    const table2 = page.getByRole('region', { name: 'Table 2', exact: true });
    await expect(table2).toContainText(`Kai ${name}`);
    await expect(table2).toContainText(`Lu ${name}`);
    await expect(list).toContainText(`${label} · 3 seats at Table 2 · 2 seated · 1 unused`);

    // Release the seat nobody used: back on sale.
    await list.getByRole('button', { name: `Release unused seats of ${label}` }).click();
    await expect(groups.getByRole('status').filter({ hasText: 'back on sale' })).toHaveText(
      `1 seat of ${label} back on sale.`,
    );
    await expect(list).toContainText(`${label} · 2 seats at Table 2 · 2 seated · 0 unused`);
    await expect(list.getByRole('button', { name: `Release unused seats of ${label}` })).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe('bulk actions: viewers and Arabic (M1.8f)', () => {
  test('a viewer sees no bulk form or group controls; a stale page is refused on the server', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const name = unique('Viewer Bulk Gala');
    const jo = `Jo ${name}`;
    await signIn(page);
    const base = await createGala(page, name);
    await quickPlan(page, base, { tables: 1, seatsPerTable: 4 });
    await addGuests(page, base, [jo]);

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/attendees`);
    await expect(row(viewer, jo)).toBeVisible();
    await expect(bulkForm(viewer)).toHaveCount(0);
    await expect(viewer.getByRole('checkbox', { name: `Select ${jo}` })).toHaveCount(0);
    // Viewers can still filter.
    await expect(viewer.getByRole('search').getByLabel('Check-in', { exact: true })).toBeVisible();
    await expectAccessible(viewer);
    await viewer.goto(`${base}/seating/assign`);
    const groups = viewer.getByRole('region', { name: 'Group blocks' });
    await expect(groups).toContainText('No group has seats kept yet.');
    await expect(groups.getByRole('form')).toHaveCount(0);
    await expectAccessible(viewer);

    // The owner's open pages, now signed in as the viewer: both actions are refused.
    await page.goto(`${base}/seating/assign`);
    const form = page.getByRole('form', { name: 'Keep seats for a group' });
    await expect(form).toBeVisible();
    await page.goto(`${base}/attendees`);
    await page.getByLabel(`Select ${jo}`).check();
    const bulk = bulkForm(page);
    await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Assign seats' });
    await signIn(page, VIEWER);
    await bulk.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await page.goto(`${base}/seating/assign`);
    await expect(form).toHaveCount(0);
    // Nobody was seated.
    await expect(page.getByRole('list', { name: 'People still to seat' })).toContainText(jo);
  });

  test('a stale group form is refused for a viewer', async ({ page }) => {
    test.setTimeout(90_000);
    const name = unique('Viewer Group Gala');
    await signIn(page);
    const base = await createGala(page, name);
    await quickPlan(page, base, { tables: 1, seatsPerTable: 4 });
    await page.goto(`${base}/seating/assign`);
    const form = page.getByRole('form', { name: 'Keep seats for a group' });
    await form.getByLabel('Group (label)', { exact: true }).fill('Press');
    await form.getByLabel('Keep seats at', { exact: true }).selectOption({ label: 'Table 1 — 4 of 4 free' });
    await signIn(page, VIEWER);
    await form.getByRole('button', { name: 'Keep seats' }).click();
    await expect(form.getByRole('alert')).toHaveText('You can see the groups but not change them.');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Group blocks' })).toContainText(
      'No group has seats kept yet.',
    );
  });

  test('renders right to left in Arabic: the new filters, bulk actions and group blocks', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const name = unique('RTL Bulk Gala');
    await signIn(page);
    const base = await createGala(page, name);
    await quickPlan(page, base, { tables: 1, seatsPerTable: 4 });
    await addGuests(page, base, [`Lea ${name}`]);
    await page.goto(`/ar${base}/attendees`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const bulk = page.getByRole('form', { name: 'إجراءات جماعية' });
    await bulk.getByLabel('الإجراء', { exact: true }).selectOption({ label: 'تخصيص المقاعد' });
    await expect(bulk.getByLabel('إجلاسهم في', { exact: true })).toBeVisible();
    await expect(page.getByRole('search').getByLabel('تسجيل الدخول للحدث', { exact: true })).toBeVisible();
    await expectAccessible(page);
    await bulk.getByLabel('الإجراء', { exact: true }).selectOption({ label: 'إلغاء التذاكر (دون استرداد)' });
    await expect(bulk.getByRole('button', { name: 'مراجعة الإلغاء…' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${base}/seating/assign`);
    await expect(page.getByRole('heading', { name: 'كتل المجموعات' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'احجز المقاعد' })).toBeVisible();
    await expectAccessible(page);
  });
});
