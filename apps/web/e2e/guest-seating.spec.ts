import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, signIn } from './helpers.ts';
import { quickPlan } from './seating-helpers.ts';

/**
 * M4.3a guest seating editor: the unseated queue, the map and table details. Acceptance: the
 * keyboard-only path works; a plus-one change updates the queue in realtime. Plus "can't fit",
 * VIP zones, group assignment, drag and drop, the read-only viewer, empty states and Arabic RTL.
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

/** A wedding in Chicago, 60 days out; returns its console path. */
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

const partyRegion = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function addParty(page: Page, p: { name: string; side?: string; vip?: boolean }) {
  const add = page.getByRole('region', { name: 'Add party' });
  await add.getByLabel('Party name').fill(p.name);
  if (p.side) await add.getByLabel('Side').fill(p.side);
  if (p.vip) await add.getByRole('checkbox', { name: 'VIP' }).check();
  await add.getByRole('button', { name: 'Add party' }).click();
  await expect(add.getByText('Party added.')).toBeVisible();
  await expect(partyRegion(page, p.name)).toBeVisible();
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

/**
 * A wedding with two tables of `seats` and the parties given (each "Name: First, First…"),
 * as the Lakeside owner. Returns the console path.
 */
async function weddingWithGuests(
  page: Page,
  name: string,
  parties: readonly {
    name: string;
    side?: string;
    vip?: boolean;
    guests: readonly string[];
    meal?: string;
  }[],
  seats = 4,
) {
  const base = await createWedding(page, name);
  await quickPlan(page, base, { tables: 2, seatsPerTable: seats, stage: false });
  await page.goto(`${base}/guests`);
  for (const p of parties) {
    await addParty(page, p);
    for (const g of p.guests) await addGuest(page, p.name, g, p.meal);
  }
  return base;
}

const queue = (page: Page) => page.getByRole('list', { name: 'Parties still to seat' });
const queueParty = (page: Page, name: string) =>
  queue(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
const details = (page: Page, place: string): Locator =>
  page.getByRole('region', { name: place, exact: true });

async function openEditor(page: Page, base: string) {
  await page.goto(`${base}/seating/guests`);
  await expect(page.getByRole('heading', { name: 'Seat guests', level: 1 })).toBeVisible();
}

/** Wait until the editor follows both live streams. */
async function waitLive(page: Page) {
  await expect(page.locator('section[data-live]')).toHaveAttribute('data-live', 'live', { timeout: 15_000 });
}

test.describe('guest seating editor (M4.3a)', () => {
  test('keyboard only: seat a party, "can\'t fit", move and unseat, persistence', async ({ page }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const base = await weddingWithGuests(page, `Keyboard Seating ${s}`, [
      { name: 'Garcia', vip: true, guests: ['Luis', 'Ana'], meal: 'Beef' },
      { name: 'Chen', guests: ['Mei', 'Jun', 'Kai'] },
    ]);
    // The tab is on every seating view.
    await page.goto(`${base}/seating`);
    await page
      .getByRole('navigation', { name: 'Seating views' })
      .getByRole('link', { name: 'Seat guests' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Seat guests', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unseated (5)' })).toBeVisible();
    await expect(page.getByText('0 seated · 5 to seat')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Tick the Garcia party (Space), choose Table 1, press Enter on the button.
    await page.getByRole('checkbox', { name: 'Select everyone in Garcia' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('2 guests selected')).toBeVisible();
    await page.getByLabel('Table or row', { exact: true }).first().focus();
    await page
      .getByLabel('Table or row', { exact: true })
      .first()
      .selectOption({ label: 'Table 1 — 4 of 4 free' });
    await page.getByRole('button', { name: 'Seat selected guests' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Seated 2 guests at Table 1.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unseated (3)' })).toBeVisible();
    const t1 = details(page, 'Table 1');
    await expect(t1).toContainText('Luis X');
    await expect(t1).toContainText('Ana X');
    await expect(t1).toContainText('2 seated · 2 of 4 free');
    await expect(t1).toContainText('Beef: 2');

    // Chen (3) doesn't fit at Table 1 (2 free): warned before sending, refused if sent anyway.
    await page.getByRole('checkbox', { name: 'Select everyone in Chen' }).focus();
    await page.keyboard.press('Space');
    await page
      .getByLabel('Table or row', { exact: true })
      .first()
      .selectOption({ label: 'Table 1 — 2 of 4 free' });
    await expect(page.getByText("Can't fit: 3 guests selected, 2 seats free at Table 1.")).toBeVisible();
    await page.getByRole('button', { name: 'Seat selected guests' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText("Can't fit: 3 guests need a seat, and only 2 seats are free there."),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unseated (3)' })).toBeVisible();
    await expectAccessible(page);
    // Table 2 has room.
    await page
      .getByLabel('Table or row', { exact: true })
      .first()
      .selectOption({ label: 'Table 2 — 4 of 4 free' });
    await page.getByRole('button', { name: 'Seat selected guests' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Seated 3 guests at Table 2.')).toBeVisible();
    await expect(page.getByText('Everyone has a seat.')).toBeVisible();

    // Move Mei to Table 1 with "Move to…", by keyboard.
    const t2 = details(page, 'Table 2');
    await expect(t2).toContainText('Mei X');
    await t2.getByRole('button', { name: 'Move Mei X to another table' }).focus();
    await page.keyboard.press('Enter');
    const move = page.getByRole('form', { name: 'Move Mei X' });
    await expect(move.getByLabel('Table or row')).toBeFocused();
    await move.getByLabel('Table or row').selectOption({ label: 'Table 1 — 2 of 4 free' });
    await move.getByRole('button', { name: 'Move' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Moved Mei X to Table 1.')).toBeVisible();
    await expect(details(page, 'Table 1')).toContainText('Mei X');

    // Unseat Ana: back in the queue.
    await details(page, 'Table 1').getByRole('button', { name: 'Unseat Ana X' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('1 guest is back in the queue.')).toBeVisible();
    await expect(queueParty(page, 'Garcia')).toContainText('Ana X');
    await expectAccessible(page);

    // It persisted.
    await page.reload();
    await expect(page.getByText('4 seated · 1 to seat')).toBeVisible();
    await expect(details(page, 'Table 1')).toContainText('Mei X');
    await expect(details(page, 'Table 1')).not.toContainText('Ana X');
  });

  test('a plus-one change updates the queue in realtime', async ({ page, context }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const base = await weddingWithGuests(page, `Live Seating ${s}`, [{ name: 'Rossi', guests: ['Gia'] }]);
    await openEditor(page, base);
    await expect(queueParty(page, 'Rossi')).toContainText('Gia X');
    await expect(queueParty(page, 'Rossi')).not.toContainText('Guest of Gia X');
    await waitLive(page);
    await expect(page.getByText('Live', { exact: true })).toBeVisible();

    // Another tab adds a plus-one for Gia on the Guests page.
    const other = await context.newPage();
    await other.goto(`${base}/guests`);
    const rossi = partyRegion(other, 'Rossi');
    await rossi.getByText('Edit Gia X', { exact: true }).click();
    await other
      .getByRole('region', { name: 'Edit Gia X', exact: true })
      .getByRole('button', { name: 'Add a plus-one for Gia X' })
      .click();
    await expect(rossi.getByText('Plus-one to name', { exact: true })).toBeVisible();

    // The editor's queue shows them without a reload.
    await expect(queueParty(page, 'Rossi')).toContainText('Guest of Gia X', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Unseated (2)' })).toBeVisible();

    // Seating from the other tab shows here too.
    await other.goto(`${base}/seating/guests`);
    await other.getByRole('checkbox', { name: 'Select everyone in Rossi' }).check();
    await other
      .getByLabel('Table or row', { exact: true })
      .first()
      .selectOption({ label: 'Table 2 — 4 of 4 free' });
    await other.getByRole('button', { name: 'Seat selected guests' }).click();
    await expect(other.getByText('Seated 2 guests at Table 2.')).toBeVisible();
    await expect(page.getByText('Everyone has a seat.')).toBeVisible({ timeout: 10_000 });
    await other.close();
  });

  test('group assignment by side, VIP zones and their warnings', async ({ page }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const base = await weddingWithGuests(page, `Group Seating ${s}`, [
      { name: 'Garcia', side: 'Bride', vip: true, guests: ['Luis', 'Ana'] },
      { name: 'Patel', side: 'Bride', guests: ['Raj', 'Priya'] },
      { name: 'Chen', side: 'Groom', guests: ['Mei'] },
    ]);
    await openEditor(page, base);

    // Mark Table 2 as a VIP zone.
    await page.getByLabel('Table to show').selectOption({ label: 'Table 2 — 4 of 4 free' });
    await details(page, 'Table 2').getByRole('checkbox', { name: 'VIP zone' }).check();
    await expect(page.getByText('Table 2 is now a VIP zone.')).toBeVisible();
    await expect(page.getByLabel('Table or row', { exact: true }).first()).toContainText(
      'Table 2 — 4 of 4 free · VIP zone',
    );

    // The bride's side as one group: filter, tick both parties, seat them together.
    await page.getByLabel('Side').selectOption('Bride');
    await expect(queueParty(page, 'Chen')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Select everyone in Garcia' }).check();
    await page.getByRole('checkbox', { name: 'Select everyone in Patel' }).check();
    await expect(page.getByText('4 guests selected')).toBeVisible();
    await page
      .getByLabel('Table or row', { exact: true })
      .first()
      .selectOption({ label: 'Table 1 — 4 of 4 free' });
    await page.getByRole('button', { name: 'Seat selected guests' }).click();
    // Seated, with the VIP warning for Garcia outside the VIP zone.
    await expect(page.getByText('Seated 4 guests at Table 1.')).toBeVisible();
    await expect(page.getByText('Garcia is a VIP party, and Table 1 is not a VIP zone.')).toBeVisible();
    await expect(details(page, 'Table 1')).toContainText('Garcia is a VIP party outside a VIP zone.');

    // Chen (not VIP) in the VIP zone: seated with a warning.
    await page.getByLabel('Side').selectOption('');
    await page.getByRole('checkbox', { name: 'Select everyone in Chen' }).check();
    await page
      .getByLabel('Table or row', { exact: true })
      .first()
      .selectOption({ label: 'Table 2 — 4 of 4 free · VIP zone' });
    await page.getByRole('button', { name: 'Seat selected guests' }).click();
    await expect(page.getByText('Table 2 is a VIP zone, and Chen is not a VIP party.')).toBeVisible();
    await expect(details(page, 'Table 2')).toContainText('Chen is not a VIP party but sits in a VIP zone.');
    await expectAccessible(page);

    // Unmark the zone: the warning goes.
    await details(page, 'Table 2').getByRole('checkbox', { name: 'VIP zone' }).uncheck();
    await expect(page.getByText('Table 2 is no longer a VIP zone.')).toBeVisible();
    await expect(details(page, 'Table 2')).not.toContainText('sits in a VIP zone');
  });

  test('drag a party onto a table of the map', async ({ page }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const base = await weddingWithGuests(
      page,
      `Drag Seating ${s}`,
      [
        { name: 'Okafor', guests: ['Ada', 'Obi'] },
        { name: 'Lund', guests: ['Eva', 'Nils', 'Ida'] },
      ],
      4,
    );
    await openEditor(page, base);
    const map = page.getByTestId('guest-seating-map');
    const canvas = map.locator('canvas').first();
    await expect(canvas).toBeVisible();
    // The quick layout without a stage (1060 × 800 cm): table 1 centred at (330, 330), table 2 at (730, 330).
    const dropAt = async (partyName: string, x: number, y: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const c = await canvas.boundingBox();
      if (!c) throw new Error('no map');
      const point = { clientX: c.x + (x * c.width) / 1060, clientY: c.y + (y * c.width) / 1060 };
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      await queueParty(page, partyName).dispatchEvent('dragstart', { dataTransfer });
      await map.dispatchEvent('dragover', { dataTransfer, ...point });
      await map.dispatchEvent('drop', { dataTransfer, ...point });
      await queueParty(page, partyName)
        .dispatchEvent('dragend', { dataTransfer })
        .catch(() => undefined);
    };
    if (test.info().project.name === 'desktop-1280') {
      const [c, m] = await Promise.all([canvas.boundingBox(), map.boundingBox()]);
      if (!c || !m) throw new Error('no map');
      const scale = c.width / 1060;
      await queueParty(page, 'Okafor').dragTo(map, {
        targetPosition: { x: c.x - m.x + 730 * scale, y: c.y - m.y + 330 * scale },
      });
    } else await dropAt('Okafor', 730, 330);
    await expect(page.getByText('Seated 2 guests at Table 2.')).toBeVisible();
    await expect(details(page, 'Table 2')).toContainText('Ada X');

    // Lund (3) dropped on Table 2 (2 free): can't fit, nothing changes.
    await dropAt('Lund', 730, 330);
    await expect(
      page.getByText("Can't fit: 3 guests need a seat, and only 2 seats are free there."),
    ).toBeVisible();
    await dropAt('Lund', 330, 330);
    await expect(page.getByText('Seated 3 guests at Table 1.')).toBeVisible();
    await expect(page.getByText('Everyone has a seat.')).toBeVisible();
  });

  test('a viewer sees the seating read-only; empty states say what to do next', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    // No plan yet.
    const bare = await createWedding(page, `Empty Seating ${s}`);
    await openEditor(page, bare);
    await expect(page.getByText('Whole event has no seating plan yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the plan' })).toBeVisible();
    await expectAccessible(page);
    // A plan but no guests.
    await quickPlan(page, bare, { tables: 1, seatsPerTable: 4, stage: false });
    await openEditor(page, bare);
    await expect(page.getByText('No guests to seat yet')).toBeVisible();
    await page.getByRole('link', { name: 'Go to Guests' }).click();
    await expect(page.getByRole('heading', { name: 'Guests', level: 1 })).toBeVisible();

    const base = await weddingWithGuests(page, `Viewer Seating ${s}`, [{ name: 'Novak', guests: ['Ivo'] }]);
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await signIn(viewer, VIEWER);
    await openEditor(viewer, base);
    await expect(viewer.getByText('You can see the seating but not change it.')).toBeVisible();
    await expect(queueParty(viewer, 'Novak')).toContainText('Ivo X');
    // No controls: no ticks, no seat form, no VIP switch.
    await expect(viewer.getByRole('checkbox')).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Seat selected guests' })).toHaveCount(0);
    await expectAccessible(viewer);
    await viewerContext.close();
  });

  test('Arabic, right to left', async ({ page }) => {
    test.setTimeout(120_000);
    const s = stamp();
    await signIn(page);
    const base = await weddingWithGuests(page, `RTL Seating ${s}`, [{ name: 'Haddad', guests: ['Lina'] }]);
    await page.goto(`/ar${base}/seating/guests`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'إجلاس الضيوف', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'بلا مقعد (1)' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'تحديد كل من في Haddad' }).check();
    await page.getByLabel('طاولة أو صف', { exact: true }).first().selectOption({ index: 1 });
    await page.getByRole('button', { name: 'إجلاس الضيوف المحدّدين' }).click();
    await expect(page.getByText('أُجلِس ضيف واحد على الطاولة 1.')).toBeVisible();
    await expectAccessibleBothModes(page);
  });
});
