import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, pickOption, signIn } from './helpers.ts';
import { quickPlan } from './seating-helpers.ts';

/**
 * M4.1c: sub-events (ceremony, reception…) and the invitation matrix. The acceptance criterion:
 * a guest not invited to a sub-event can't have a response to it (the server refuses).
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
const DAY = chicagoDate(60);

async function createWedding(page: Page, name: string): Promise<string> {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'wedding');
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(`${DAY}T15:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${DAY}T23:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

/** Opens a disclosure (by its summary text) and returns its region. */
async function open(page: Page, summary: string): Promise<Locator> {
  const region = page.getByRole('region', { name: summary, exact: true });
  if (!(await region.isVisible())) await page.getByText(summary, { exact: true }).click();
  await expect(region).toBeVisible();
  return region;
}

/** A party with one guest (and optionally a plus-one for them), on the guest list. */
async function party(
  page: Page,
  p: { name: string; side?: string; vip?: boolean; first: string; last: string; plusOne?: boolean },
) {
  const add = page.getByRole('region', { name: 'Add party' });
  await add.getByLabel('Party name').fill(p.name);
  if (p.side) await add.getByLabel('Side').fill(p.side);
  if (p.vip) await add.getByRole('checkbox', { name: 'VIP' }).check();
  await add.getByRole('button', { name: 'Add party' }).click();
  await expect(add.getByText('Party added.')).toBeVisible();
  const form = await open(page, `Add a guest to ${p.name}`);
  await form.getByLabel('First name').fill(p.first);
  await form.getByLabel('Last name').fill(p.last);
  await form.getByRole('button', { name: 'Add guest' }).click();
  await expect(form.getByText('Guest added.')).toBeVisible();
  if (p.plusOne) {
    const edit = await open(page, `Edit ${p.first} ${p.last}`);
    await edit.getByRole('button', { name: `Add a plus-one for ${p.first} ${p.last}` }).click();
    await expect(
      page
        .getByRole('region', { name: p.name, exact: true })
        .getByText(`Guest of ${p.first} ${p.last}`, { exact: true }),
    ).toBeVisible();
  }
}

const addForm = (page: Page) => page.getByRole('region', { name: 'Add a sub-event' });

async function addSubEvent(
  page: Page,
  s: {
    name: string;
    kind?: string;
    start: string;
    end: string;
    place?: string;
    everyone?: boolean;
    date?: number;
  },
) {
  const add = addForm(page);
  await add.getByLabel('Name', { exact: true }).fill(s.name);
  if (s.kind) await pickOption(add.getByLabel('Kind'), { label: s.kind });
  await add.getByLabel('Starts').fill(`${DAY}T${s.start}`);
  await add.getByLabel('Ends').fill(`${DAY}T${s.end}`);
  if (s.place) await add.getByLabel('Place', { exact: true }).fill(s.place);
  if (s.date !== undefined) await pickOption(add.getByLabel('Event date'), { index: s.date });
  if (s.everyone)
    await add
      .getByRole('checkbox', { name: 'Everyone on the guest list is invited (parties added later too)' })
      .check();
  await add.getByRole('button', { name: 'Add a sub-event' }).click();
  await expect(add.getByText('Sub-event added.')).toBeVisible();
  await expect(page.getByRole('heading', { name: s.name, level: 3 })).toBeVisible();
}

const grid = (page: Page) => page.getByRole('grid', { name: 'Invitations by guest and sub-event' });
const cell = (page: Page, name: string) => grid(page).getByRole('checkbox', { name, exact: true });
const status = (page: Page) => page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /\S/ });
const recordForm = (page: Page) => page.getByRole('region', { name: 'Record a response' });
const heading = (page: Page, name: string) => page.getByRole('heading', { name, level: 3, exact: true });
const subCard = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function record(page: Page, guest: string, sub: string, response: string, paper = true) {
  const form = recordForm(page);
  await pickOption(form.getByLabel('Guest', { exact: true }), { label: guest });
  await pickOption(form.getByLabel('Sub-event', { exact: true }), { label: sub });
  await pickOption(form.getByLabel('Response', { exact: true }), { label: response });
  if (paper)
    await pickOption(form.getByLabel('Entered from'), { label: 'Paper reply (entered for the guest)' });
  await form.getByRole('button', { name: 'Record response' }).click();
}

test.describe('sub-events and invitations (M4.1c)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('keyboard only: a ceremony and a reception, everyone to one and two parties to the other; paper response; an uninvited guest is refused', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Rivera Chen Wedding ${s}`);
    await page.goto(`${base}/guests`);
    await party(page, { name: 'Chen', side: 'Groom', first: 'Mei', last: 'Chen' });
    await party(page, {
      name: 'Garcia',
      side: 'Bride',
      vip: true,
      first: 'Luis',
      last: 'Garcia',
      plusOne: true,
    });
    await party(page, { name: 'Lopez', side: 'Bride', first: 'Ana', last: 'Lopez' });

    // From the guest list to the new page.
    await page.getByRole('link', { name: 'Sub-events and invitations' }).click();
    await expect(page).toHaveURL(/\/guests\/sub-events$/);
    await expect(page.getByRole('heading', { name: 'Sub-events and invitations', level: 1 })).toBeVisible();
    await expect(page.getByText('No sub-events yet')).toBeVisible();
    await expect(page.getByText('Nothing to invite yet')).toBeVisible();
    await expectAccessible(page);

    // Validation, named on the field; values survive.
    const add = addForm(page);
    await add.getByLabel('Place', { exact: true }).fill('The garden');
    await add.getByRole('button', { name: 'Add a sub-event' }).click();
    await expect(add.getByText('Give the sub-event a name (up to 120 characters).')).toBeVisible();
    await expect(add.getByText('Enter a start date and time.')).toBeVisible();
    await expect(add.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(add.getByLabel('Place', { exact: true })).toHaveValue('The garden');
    await add.getByLabel('Name', { exact: true }).fill('Backwards');
    await add.getByLabel('Starts').fill(`${DAY}T17:00`);
    await add.getByLabel('Ends').fill(`${DAY}T16:00`);
    await add.getByRole('button', { name: 'Add a sub-event' }).click();
    await expect(add.getByText('Enter an end after the start.')).toBeVisible();
    await expectAccessible(page);
    await add.getByLabel('Place', { exact: true }).fill('');

    await addSubEvent(page, { name: 'Reception', kind: 'Reception', start: '18:00', end: '23:00' });
    await addSubEvent(page, {
      name: 'Ceremony',
      kind: 'Ceremony',
      start: '16:00',
      end: '17:00',
      place: 'The garden',
    });
    await expect(subCard(page, 'Ceremony').getByText('Place: The garden')).toBeVisible();
    // Times show in the event's zone (4:00 PM Chicago).
    await expect(subCard(page, 'Ceremony').locator('time')).toContainText('4:00');

    // Reorder by keyboard: the ceremony moves up, above the reception.
    const up = page.getByRole('button', { name: 'Move Ceremony up' });
    await up.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText('Ceremony');
    await expect(page.getByRole('button', { name: 'Move Reception up' })).toBeVisible();

    // The grid: parties by name, their guests (plus-ones after their host), one column each.
    await expect(grid(page)).toBeVisible();
    await expect(grid(page).getByRole('columnheader', { name: /Ceremony/ })).toBeVisible();
    await expect(grid(page).getByRole('rowheader')).toHaveText([
      'Everyone on the list',
      'Chen',
      'Mei Chen',
      'Garcia',
      'Luis Garcia',
      'Guest of Luis Garcia',
      'Lopez',
      'Ana Lopez',
    ]);
    await expectAccessible(page);

    // Keyboard only. One tab stop: the first cell (everyone × Ceremony).
    const first = cell(page, 'Invite everyone on the list to Ceremony');
    await expect(first).toHaveAttribute('tabindex', '0');
    await expect(cell(page, 'Invite Mei Chen to Ceremony')).toHaveAttribute('tabindex', '-1');
    await first.focus();
    await page.keyboard.press('Space');
    await expect(status(page)).toHaveText('Invited: Everyone on the list · Ceremony');
    await expect(first).toBeChecked();
    await expect(cell(page, 'Invite Guest of Luis Garcia to Ceremony')).toBeChecked();
    // → Reception column, ↓ Chen's row: the whole party.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, 'Invite Chen to Reception')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(status(page)).toHaveText('Invited: Chen · Reception');
    // ↓↓ Garcia's row.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, 'Invite Garcia to Reception')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(status(page)).toHaveText('Invited: Garcia · Reception');
    await expect(cell(page, 'Invite Mei Chen to Reception')).toBeChecked();
    await expect(cell(page, 'Invite Luis Garcia to Reception')).toBeChecked();
    await expect(cell(page, 'Invite Ana Lopez to Reception')).not.toBeChecked();
    // Everyone row is partly invited now (mixed).
    await expect(cell(page, 'Invite everyone on the list to Reception')).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
    // A plus-one follows their host: their cell can't be toggled on its own.
    const plusOne = cell(page, 'Invite Guest of Luis Garcia to Reception');
    await expect(plusOne).toBeChecked();
    await expect(plusOne).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(plusOne).toBeFocused();
    await page.keyboard.press('Space');
    await expect(plusOne).toBeChecked();
    // Home / End move within the row.
    await page.keyboard.press('Home');
    await expect(cell(page, 'Invite Guest of Luis Garcia to Ceremony')).toBeFocused();
    await page.keyboard.press('End');
    await expect(plusOne).toBeFocused();
    // Counts per sub-event.
    const header = (name: string) => grid(page).getByRole('columnheader', { name: new RegExp(name) });
    await expect(header('Ceremony')).toContainText('Invited: 4 · Attending: 0');
    await expect(header('Reception')).toContainText('Invited: 3 · Attending: 0');
    await expectAccessible(page);

    // A paper response for Mei, recorded for the reception (keyboard: select and submit).
    await record(page, 'Mei Chen (Chen)', 'Reception', 'Attending');
    await expect(recordForm(page).getByText('Response recorded.')).toBeVisible();
    await expect(header('Reception')).toContainText('Invited: 3 · Attending: 1');
    await expect(grid(page).getByRole('row', { name: /Mei Chen/ })).toContainText('Attending');
    // Ana isn't invited to the reception: the server refuses.
    await record(page, 'Ana Lopez (Lopez)', 'Reception', 'Declined');
    await expect(recordForm(page).getByText("This guest isn't invited to that sub-event.")).toBeVisible();
    await expect(recordForm(page).getByLabel('Guest', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expectAccessible(page);

    // Persisted.
    await page.reload();
    await expect(cell(page, 'Invite Mei Chen to Reception')).toBeChecked();
    await expect(cell(page, 'Invite Ana Lopez to Reception')).not.toBeChecked();
    await expect(grid(page).getByRole('row', { name: /Mei Chen/ })).toContainText('Attending');
    await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText('Ceremony');
    await expect(page.getByTestId('sub-counts-1')).toHaveText('Invited: 3 · Attending: 1 · Declined: 0');

    // Uninviting Mei clears her response, and the history says so.
    const mei = cell(page, 'Invite Mei Chen to Reception');
    await mei.focus();
    await page.keyboard.press('Space');
    await expect(status(page)).toHaveText('No longer invited: Mei Chen · Reception');
    await expect(mei).not.toBeChecked();
    await expect(grid(page).getByRole('row', { name: /Mei Chen/ })).not.toContainText('Attending');
    const recent = page.getByRole('region', { name: 'Recent changes' });
    await expect(recent.getByText(/^Response cleared · Reception · Mei Chen/)).toBeVisible();
    await expect(recent.getByText(/^Response recorded · Reception · Mei Chen · Paper reply/)).toBeVisible();
  });

  test('everyone invited includes parties added later; bulk by filter; removal needs confirmation while responses exist', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Bulk Wedding ${s}`);
    await page.goto(`${base}/guests`);
    await party(page, { name: 'Adams', side: 'Bride', first: 'Ada', last: 'Adams' });
    await party(page, { name: 'Baker', side: 'Groom', first: 'Ben', last: 'Baker' });
    await page.goto(`${base}/guests/sub-events`);
    await addSubEvent(page, {
      name: 'Ceremony',
      kind: 'Ceremony',
      start: '16:00',
      end: '17:00',
      everyone: true,
    });
    await addSubEvent(page, { name: 'Dinner', kind: 'Rehearsal dinner', start: '19:00', end: '21:00' });
    await expect(subCard(page, 'Ceremony').getByText('Everyone invited')).toBeVisible();
    // Cells of an "everyone" sub-event are checked and locked.
    await expect(cell(page, 'Invite Ada Adams to Ceremony')).toBeChecked();
    await expect(cell(page, 'Invite Ada Adams to Ceremony')).toHaveAttribute('aria-disabled', 'true');

    // A party added afterwards is invited too.
    await page.goto(`${base}/guests`);
    await party(page, { name: 'Clark', side: 'Bride', first: 'Cy', last: 'Clark' });
    await page.goto(`${base}/guests/sub-events`);
    await expect(cell(page, 'Invite Cy Clark to Ceremony')).toBeChecked();
    await expect(page.getByTestId('sub-counts-0')).toHaveText('Invited: 3 · Attending: 0 · Declined: 0');

    // Filter to the bride's side, then invite everyone shown to the dinner from the bulk bar.
    const filters = page.getByRole('search', { name: 'Filter the invitations' });
    await pickOption(filters.getByLabel('Side'), 'Bride');
    await filters.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Matching the filters: parties 2 · guests 2')).toBeVisible();
    await expect(grid(page).getByRole('rowheader')).toHaveText([
      'Everyone shown',
      'Adams',
      'Ada Adams',
      'Clark',
      'Cy Clark',
    ]);
    const bulk = page.getByRole('region', { name: 'Change many at once' });
    await bulk.getByRole('button', { name: 'Apply to the guests shown (2)' }).click();
    await expect(bulk.getByText('Choose a sub-event.')).toBeVisible();
    await pickOption(bulk.getByLabel('Sub-event'), { label: 'Dinner' });
    await bulk.getByRole('button', { name: 'Apply to the guests shown (2)' }).click();
    await expect(bulk.getByText('Invitations updated.')).toBeVisible();
    await expect(cell(page, 'Invite Ada Adams to Dinner')).toBeChecked();
    await expect(cell(page, 'Invite Cy Clark to Dinner')).toBeChecked();
    // Toggling an "everyone" sub-event from the bulk bar is refused with the reason.
    await pickOption(bulk.getByLabel('Sub-event'), { label: 'Ceremony' });
    await pickOption(bulk.getByLabel('Change'), { label: 'Uninvite (clears their responses)' });
    await bulk.getByRole('button', { name: 'Apply to the guests shown (2)' }).click();
    await expect(
      bulk.getByText('Everyone is invited to this sub-event. Turn that off in its settings first.'),
    ).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Clear' }).click();
    await expect(cell(page, 'Invite Ben Baker to Dinner')).not.toBeChecked();

    // Turning "everyone" off keeps everyone invited; then a cell can be changed.
    const edit = await open(page, 'Edit Ceremony');
    await edit
      .getByRole('checkbox', { name: 'Everyone on the guest list is invited (parties added later too)' })
      .uncheck();
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText('Saved.')).toBeVisible();
    await expect(cell(page, 'Invite Ben Baker to Ceremony')).toBeChecked();
    await expect(cell(page, 'Invite Ben Baker to Ceremony')).not.toHaveAttribute('aria-disabled', 'true');

    // A response on the dinner: removing it now asks for confirmation.
    await record(page, 'Ada Adams (Adams)', 'Dinner', 'Declined', false);
    await expect(recordForm(page).getByText('Response recorded.')).toBeVisible();
    const dinner = await open(page, 'Edit Dinner');
    await dinner.getByRole('button', { name: 'Remove Dinner' }).click();
    await expect(
      dinner.getByText('Responses are recorded for this sub-event. Tick the box to remove it anyway.'),
    ).toBeVisible();
    await expect(heading(page, 'Dinner')).toBeVisible();
    await dinner.getByRole('checkbox', { name: 'Also remove the recorded responses (1)' }).check();
    await dinner.getByRole('button', { name: 'Remove Dinner' }).click();
    await expect(heading(page, 'Dinner')).toHaveCount(0);
    await page.reload();
    await expect(heading(page, 'Dinner')).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: 'Recent changes' })
        .getByText(/^Sub-event removed · Typed in by the team/),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('the reception linked to a date with its own chart uses it; a sub-event can have its own chart', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Chart Wedding ${s}`);
    // Two dates, a plan of 2 tables × 4, and date 2 gets its own chart.
    await page.goto(`${base}/dates`);
    const repeat = page.getByRole('region', { name: 'Add a repeating schedule' });
    await repeat.getByLabel('Number of dates', { exact: true }).fill('2');
    await repeat.getByRole('button', { name: 'Preview dates' }).click();
    await repeat.getByRole('button', { name: 'Save 2 dates' }).click();
    await expect(repeat.getByText('2 dates added')).toBeVisible();
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4, stage: false });
    const nav = page.getByRole('navigation', { name: 'Seating chart by date' });
    await nav.getByRole('link').nth(2).click();
    await expect(page).toHaveURL(/\?date=/);
    await page.getByRole('button', { name: 'Give this date its own chart' }).click();
    await expect(page.getByTestId('date-chart-state')).toContainText('This date has its own chart');

    await page.goto(`${base}/guests/sub-events`);
    await addSubEvent(page, { name: 'Ceremony', kind: 'Ceremony', start: '16:00', end: '17:00' });
    await addSubEvent(page, { name: 'Reception', kind: 'Reception', start: '18:00', end: '23:00', date: 2 });
    const reception = subCard(page, 'Reception');
    await expect(reception.getByText(/^Date: /)).toBeVisible();
    await expect(page.getByTestId('sub-chart-1')).toHaveText(/^Seating chart: the chart of .+ \(seats: 8\)$/);
    await expect(page.getByTestId('sub-chart-0')).toHaveText('Seating chart: the event plan (seats: 8)');
    await expectAccessible(page);

    // The ceremony gets its own chart (by keyboard), then goes back to the event plan.
    await page.getByText('Give Ceremony its own seating chart', { exact: true }).focus();
    await page.keyboard.press('Enter');
    const give = page.getByRole('region', { name: 'Give Ceremony its own seating chart' });
    await give.getByRole('button', { name: 'Create its chart' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sub-chart-0')).toHaveText('Seating chart: its own (seats: 8)');
    await page.reload();
    await expect(page.getByTestId('sub-chart-0')).toHaveText('Seating chart: its own (seats: 8)');
    await expect(page.getByTestId('sub-chart-1')).toHaveText(/the chart of/);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Stop using a chart of its own for Ceremony' }).click();
    await expect(page.getByTestId('sub-chart-0')).toHaveText('Seating chart: the event plan (seats: 8)');

    // Unlinking the reception from its date: it uses the event plan.
    const edit = await open(page, 'Edit Reception');
    await pickOption(edit.getByLabel('Event date'), { label: 'Not linked to a date' });
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText('Saved.')).toBeVisible();
    await expect(page.getByTestId('sub-chart-1')).toHaveText('Seating chart: the event plan (seats: 8)');
  });

  test('a viewer reads the program and the matrix but cannot change anything; the server refuses', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `Viewer Program ${s}`);
    await page.goto(`${base}/guests`);
    await party(page, { name: 'Diaz', first: 'Dora', last: 'Diaz' });
    await page.goto(`${base}/guests/sub-events`);
    await addSubEvent(page, { name: 'Ceremony', kind: 'Ceremony', start: '16:00', end: '17:00' });

    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/guests/sub-events`);
    await expect(
      viewer.getByText('You can view sub-events and invitations. Only hosts and planners can change them.'),
    ).toBeVisible();
    await expect(heading(viewer, 'Ceremony')).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Add a sub-event' })).toHaveCount(0);
    await expect(viewer.getByRole('region', { name: 'Record a response' })).toHaveCount(0);
    await expect(viewer.getByRole('region', { name: 'Change many at once' })).toHaveCount(0);
    await expect(viewer.getByText(/^Edit /)).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Move / })).toHaveCount(0);
    const c = cell(viewer, 'Invite Dora Diaz to Ceremony');
    await expect(c).toHaveAttribute('aria-disabled', 'true');
    await c.focus();
    await viewer.keyboard.press('Space');
    await expect(c).not.toBeChecked();
    await expectAccessible(viewer);
    await ctx.close();

    // The owner's open forms, submitted as the viewer: refused by the server.
    await record(page, 'Dora Diaz (Diaz)', 'Ceremony', 'Attending');
    await expect(recordForm(page).getByText("This guest isn't invited to that sub-event.")).toBeVisible();
    const add = addForm(page);
    await add.getByLabel('Name', { exact: true }).fill('Sneaky');
    await add.getByLabel('Starts').fill(`${DAY}T10:00`);
    await add.getByLabel('Ends').fill(`${DAY}T11:00`);
    await signIn(page, VIEWER);
    await add.getByRole('button', { name: 'Add a sub-event' }).click();
    await expect(add.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    // A grid change as the viewer: refused, nothing changes.
    const own = cell(page, 'Invite Dora Diaz to Ceremony');
    await own.focus();
    await page.keyboard.press('Space');
    await expect(status(page)).toHaveText("You don't have access to this.");
    await page.reload();
    await expect(heading(page, 'Sneaky')).toHaveCount(0);
    await expect(cell(page, 'Invite Dora Diaz to Ceremony')).not.toBeChecked();
  });

  test('Arabic: the page renders right to left; arrows follow the reading direction', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const base = await createWedding(page, `RTL Program ${s}`);
    await page.goto(`${base}/guests`);
    await party(page, { name: 'Haddad', first: 'Layla', last: 'Haddad' });
    await page.goto(`/ar${base}/guests/sub-events`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'فقرات الحفل والدعوات', level: 1 })).toBeVisible();
    await expect(page.getByText('لا توجد فقرات بعد')).toBeVisible();
    await expectAccessible(page);
    const add = page.getByRole('region', { name: 'إضافة فقرة' });
    await add.getByRole('button', { name: 'إضافة فقرة' }).click();
    await expect(add.getByText('اكتب اسمًا للفقرة (حتى 120 حرفًا).')).toBeVisible();
    for (const [name, start, end] of [
      ['المراسم', '16:00', '17:00'],
      ['حفل الاستقبال', '18:00', '23:00'],
    ] as const) {
      await add.getByLabel('الاسم', { exact: true }).fill(name);
      await add.getByLabel('البداية').fill(`${DAY}T${start}`);
      await add.getByLabel('النهاية').fill(`${DAY}T${end}`);
      await add.getByRole('button', { name: 'إضافة فقرة' }).click();
      await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();
    }
    const g = page.getByRole('grid', { name: 'الدعوات حسب الضيف والفقرة' });
    const first = g.getByRole('checkbox', { name: 'دعوة كل من في القائمة إلى المراسم' });
    await first.focus();
    // Right to left: ArrowLeft goes to the next column.
    await page.keyboard.press('ArrowLeft');
    await expect(g.getByRole('checkbox', { name: 'دعوة كل من في القائمة إلى حفل الاستقبال' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(g.getByRole('checkbox', { name: 'دعوة Layla Haddad إلى حفل الاستقبال' })).toBeChecked();
    await expectAccessible(page);
  });
});
