import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, pickOption, signIn, stepOption } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';

/** A unique name per test and viewport project (projects run in parallel on one database). */
const unique = (what: string) => `${what} ${Date.now()} ${test.info().project.name.split('-')[0]}`;

/** A new gala event (its profile shows Seating) as the Lakeside owner; returns its console path. */
async function createGala(page: Page, name: string) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Event type'), 'gala');
  await page.getByLabel('Starts', { exact: true }).fill('2027-12-04T18:00');
  await page.getByLabel('Ends', { exact: true }).fill('2027-12-04T23:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

/** A plan of round tables (and a stage) from numbers. */
async function createPlan(page: Page, base: string, tables: number, seatsPerTable: number) {
  await page.goto(`${base}/seating`);
  await page.getByLabel('Rows').fill('0');
  await page.getByLabel('Seats per row').fill('1');
  await page.getByLabel('Round tables').fill(String(tables));
  await page.getByLabel('Seats per table').fill(String(seatsPerTable));
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('application', { name: 'Seating plan' })).toBeVisible();
}

async function addGuests(page: Page, base: string, names: readonly string[]) {
  await page.goto(`${base}/attendees`);
  await page
    .getByText(/^Add (attendee|guest)/i)
    .first()
    .click();
  for (const name of names) {
    await page.getByLabel('Full name').fill(name);
    await page
      .getByLabel('Email', { exact: true })
      .fill(`${name.toLowerCase().replace(/\W+/g, '.')}@example.test`);
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
  }
}

const queue = (page: Page) => page.getByRole('list', { name: 'People still to seat' });
const tableCard = (page: Page, label: string) => page.getByRole('region', { name: label, exact: true });
const feedback = (page: Page) => page.locator('[aria-live="polite"]').getByRole('status');

test.describe('seat assignment (M1.7d)', () => {
  test('keyboard only: pick people from the queue, seat them at a table, remove one', async ({ page }) => {
    // A long journey through several pages: more than the default 30 s with parallel workers.
    test.setTimeout(90_000);
    const name = unique('Keyboard Gala');
    const [ann, ben, cat] = ['Ann', 'Ben', 'Cat'].map((n) => `${n} ${name}`) as [string, string, string];
    await signIn(page);
    const base = await createGala(page, name);

    // No plan yet: an empty state pointing to the plan.
    await page.goto(`${base}/seating/assign`);
    await expect(page.getByText('This event has no seating plan yet.', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the plan' })).toBeVisible();
    await expectAccessible(page);

    await createPlan(page, base, 2, 4);
    await addGuests(page, base, [ann, ben, cat]);
    // The Plan view links to Assign guests.
    await page.goto(`${base}/seating`);
    await page
      .getByRole('navigation', { name: 'Seating views' })
      .getByRole('link', { name: 'Assign guests' })
      .click();
    await expect(page.getByRole('heading', { name: 'Assign guests', level: 1 })).toBeVisible();
    await expect(queue(page).getByRole('listitem')).toHaveCount(3);
    await expect(tableCard(page, 'Table 1')).toContainText('No one yet.');
    await expectAccessible(page);

    // Search, then tab through the queue and tick two people with Space.
    const search = page.getByLabel('Search by name or email');
    await search.focus();
    await page.keyboard.type(name);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Select all shown' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: ann })).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: ben })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByText('2 selected')).toBeVisible();
    // Past Cat to the table chooser; arrow keys pick Table 1; then the seat chooser and the button.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const item = page.getByLabel('Table or row');
    await expect(item).toBeFocused();
    await stepOption(item);
    await expect(item).toHaveText('Table 1 — 4 of 4 free');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Seat', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Seat them' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(feedback(page)).toHaveText('Seated 2 people at Table 1.');
    const t1 = tableCard(page, 'Table 1');
    await expect(t1).toContainText(ann);
    await expect(t1).toContainText(ben);
    await expect(t1).toContainText('2 of 4 seats taken · 2 free');
    await expect(queue(page).getByRole('listitem')).toHaveCount(1);
    await expect(queue(page)).toContainText(cat);
    await expectAccessible(page);

    // Remove one by keyboard: they go back to the queue.
    await page.getByRole('button', { name: `Remove ${ann} from Table 1` }).focus();
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toHaveText(`${ann} no longer has a seat.`);
    await expect(queue(page)).toContainText(ann);
    await expect(t1).not.toContainText(ann);
    await expectAccessible(page);

    // It persisted.
    await page.reload();
    await expect(tableCard(page, 'Table 1')).toContainText(ben);
    await expect(tableCard(page, 'Table 1')).toContainText('1 of 4 seats taken · 3 free');
  });

  test('drag and drop: a name dropped on a table or on one seat of the plan', async ({ page }) => {
    const name = unique('Drag Gala');
    const [dee, eli] = ['Dee', 'Eli'].map((n) => `${n} ${name}`) as [string, string];
    await signIn(page);
    const base = await createGala(page, name);
    await createPlan(page, base, 2, 4);
    await addGuests(page, base, [dee, eli]);
    await page.goto(`${base}/seating/assign`);
    const plan = page.getByTestId('assignment-plan');
    const canvas = plan.locator('canvas').first();
    await expect(canvas).toBeVisible();
    // The quick layout (1060 × 1300 cm, stage on top): table 1 centred at (330, 830), table 2 at
    // (730, 830); seat 1 of each 125 cm above its centre.
    const chip = (who: string) => queue(page).getByRole('listitem').filter({ hasText: who });
    /** Drag events dispatched at a point of the room (the queue and the plan may not fit on screen together). */
    const dropAt = async (who: string, x: number, y: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const c = await canvas.boundingBox();
      if (!c) throw new Error('no plan');
      const point = { clientX: c.x + (x * c.width) / 1060, clientY: c.y + (y * c.width) / 1060 };
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      await chip(who).dispatchEvent('dragstart', { dataTransfer });
      await plan.dispatchEvent('dragover', { dataTransfer, ...point });
      await plan.dispatchEvent('drop', { dataTransfer, ...point });
      await chip(who).dispatchEvent('dragend', { dataTransfer });
    };

    if (test.info().project.name === 'desktop-1280') {
      // Wide enough for both: a real mouse drag.
      const [c, p] = await Promise.all([canvas.boundingBox(), plan.boundingBox()]);
      if (!c || !p) throw new Error('no plan');
      const scale = c.width / 1060;
      await chip(dee).dragTo(plan, {
        targetPosition: { x: c.x - p.x + 730 * scale, y: c.y - p.y + 830 * scale },
      });
    } else await dropAt(dee, 730, 830);
    await expect(feedback(page)).toHaveText('Seated 1 person at Table 2.');
    await expect(tableCard(page, 'Table 2')).toContainText(dee);

    // Dropped on one seat: that exact seat.
    await dropAt(eli, 330, 705);
    await expect(feedback(page)).toHaveText('Seated 1 person at Table 1.');
    await expect(tableCard(page, 'Table 1')).toContainText(eli);
    await expect(tableCard(page, 'Table 1')).toContainText('Table 1 · 1');
    await expect(page.getByText('Everyone has a seat.')).toBeVisible();
    await expectAccessible(page);
  });

  test('form errors, and a group that does not fit at a table', async ({ page }) => {
    const name = unique('Full Gala');
    const people = ['Fin', 'Gia', 'Hal'].map((n) => `${n} ${name}`);
    await signIn(page);
    const base = await createGala(page, name);
    await createPlan(page, base, 1, 2);
    await addGuests(page, base, people);
    await page.goto(`${base}/seating/assign`);
    const alert = page.locator('[aria-live="polite"]').getByRole('alert');
    const submit = page.getByRole('button', { name: 'Seat them' });

    await submit.click();
    await expect(alert).toHaveText('Choose at least one person to seat.');
    await page.getByRole('checkbox', { name: people[0] }).check();
    await submit.click();
    await expect(alert).toHaveText('Choose a table or row.');
    await pickOption(page.getByLabel('Table or row'), { label: 'Table 1 — 2 of 2 free' });
    await page.getByRole('checkbox', { name: people[1] }).check();
    await pickOption(page.getByLabel('Seat', { exact: true }), { label: 'Table 1 · 1' });
    await submit.click();
    await expect(alert).toHaveText('A seat is for one person. Choose one person, or “Any free seat”.');
    await expectAccessible(page);

    await pickOption(page.getByLabel('Seat', { exact: true }), { label: 'Any free seat' });
    await page.getByRole('button', { name: 'Select all shown' }).click();
    await expect(page.getByText('3 selected')).toBeVisible();
    await submit.click();
    await expect(alert).toHaveText("They don't all fit: only 2 seats are free there for 3 people.");
    // Nothing was seated, and the choice is kept to try again.
    await expect(tableCard(page, 'Table 1')).toContainText('No one yet.');
    await expect(page.getByText('3 selected')).toBeVisible();
    await expectAccessible(page);
  });

  test('a guest given a seat takes it off sale on the public page, and removing them frees it', async ({
    page,
    browser,
  }) => {
    const name = unique('Sold Gala');
    const guest = `Ivy ${name}`;
    await signIn(page);
    const base = await createGala(page, name);
    const slug = base.split('/').pop() as string;
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Table seat');
    await page.getByLabel('Price (USD)').fill('50');
    await page.getByLabel('Quantity available').fill('20');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Table seat' })).toBeVisible();
    await createPlan(page, base, 1, 4);
    const prices = page.getByRole('region', { name: 'Prices' });
    await prices.getByRole('checkbox', { name: 'Table 1' }).check();
    await pickOption(prices.getByLabel('Sells as'), { label: 'Table seat' });
    await prices.getByRole('button', { name: 'Set price' }).click();
    await expect(prices.getByText('Prices updated.')).toBeVisible();
    await page.getByRole('button', { name: 'Put seats on sale' }).click();
    await expect(page.getByText('On sale', { exact: true })).toBeVisible();
    await addGuests(page, base, [guest]);

    await page.goto(`${base}/seating/assign`);
    await page.getByRole('checkbox', { name: guest }).check();
    await pickOption(page.getByLabel('Table or row'), { label: 'Table 1 — 4 of 4 free' });
    await pickOption(page.getByLabel('Seat', { exact: true }), { label: 'Table 1 · 2' });
    await page.getByRole('button', { name: 'Seat them' }).click();
    await expect(feedback(page)).toHaveText('Seated 1 person at Table 1.');
    await expect(tableCard(page, 'Table 1')).toContainText('Table 1 · 2');

    const buyer = await (await browser.newContext()).newPage();
    await buyer.goto(`/events/${slug}`);
    const seats = buyer.getByRole('group', { name: 'Table 1' }).getByRole('checkbox');
    await expect(seats).toHaveCount(4);
    await expect(seats.nth(1)).toBeDisabled();
    await expect(seats.nth(0)).toBeEnabled();
    await expectAccessible(buyer);

    await page.getByRole('button', { name: `Remove ${guest} from Table 1` }).click();
    await expect(feedback(page)).toHaveText(`${guest} no longer has a seat.`);
    await buyer.reload();
    await expect(buyer.getByRole('group', { name: 'Table 1' }).getByRole('checkbox').nth(1)).toBeEnabled();
  });

  test('a viewer sees who sits where but cannot seat anyone; a stale page is refused', async ({
    page,
    browser,
  }) => {
    const name = unique('Viewer Gala');
    const [jo, kim] = ['Jo', 'Kim'].map((n) => `${n} ${name}`) as [string, string];
    await signIn(page);
    const base = await createGala(page, name);
    await createPlan(page, base, 1, 4);
    await addGuests(page, base, [jo, kim]);
    await page.goto(`${base}/seating/assign`);
    await page.getByRole('checkbox', { name: jo }).check();
    await pickOption(page.getByLabel('Table or row'), { label: 'Table 1 — 4 of 4 free' });
    await page.getByRole('button', { name: 'Seat them' }).click();
    await expect(tableCard(page, 'Table 1')).toContainText(jo);

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/seating/assign`);
    await expect(viewer.getByText('You can see who sits where, but not change it.')).toBeVisible();
    await expect(tableCard(viewer, 'Table 1')).toContainText(jo);
    await expect(queue(viewer)).toContainText(kim);
    await expect(viewer.getByRole('checkbox')).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Seat them' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await expectAccessible(viewer);

    // The owner's open page, now signed in as the viewer: the server refuses both actions.
    await signIn(page, VIEWER);
    await page.getByRole('checkbox', { name: kim }).check();
    await pickOption(page.getByLabel('Table or row'), { label: 'Table 1 — 3 of 4 free' });
    await page.getByRole('button', { name: 'Seat them' }).click();
    const alert = page.locator('[aria-live="polite"]').getByRole('alert');
    await expect(alert).toHaveText('You can see the seating but not change it.');
    await page.getByRole('button', { name: `Remove ${jo} from Table 1` }).click();
    await expect(alert).toHaveText('You can see the seating but not change it.');
    await viewer.reload();
    await expect(tableCard(viewer, 'Table 1')).toContainText(jo);
    await expect(tableCard(viewer, 'Table 1')).not.toContainText(kim);
  });

  test('renders right to left in Arabic', async ({ page }) => {
    const name = unique('RTL Gala');
    await signIn(page);
    const base = await createGala(page, name);
    await createPlan(page, base, 1, 4);
    await addGuests(page, base, [`Lea ${name}`]);
    await page.goto(`/ar${base}/seating/assign`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'توزيع الضيوف', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'أجلِسهم' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'أشخاص بلا مقعد بعد' })).toContainText(`Lea ${name}`);
    await expectAccessible(page);
  });
});
