import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, pickOption, signIn, stepOption } from './helpers.ts';
import { addGuests, createGala, quickPlan, unique } from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';
const queue = (page: Page) => page.getByRole('list', { name: 'People still to seat' });
const tableCard = (page: Page, label: string) => page.getByRole('region', { name: label, exact: true });
const feedback = (page: Page) => page.locator('[aria-live="polite"]').getByRole('status');

/** A gala with two round tables of four and one guest seated at Table 1 (with the form). */
async function seatedGuest(page: Page, what: string) {
  const name = unique(what);
  const guest = `Gus ${name}`;
  const base = await createGala(page, name);
  await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
  await addGuests(page, base, [guest]);
  await page.goto(`${base}/seating/assign`);
  await page.getByRole('checkbox', { name: guest }).check();
  await pickOption(page.getByLabel('Table or row'), { label: 'Table 1 — 4 of 4 free' });
  await page.getByRole('button', { name: 'Seat them' }).click();
  await expect(feedback(page)).toHaveText('Seated 1 person at Table 1.');
  await expect(queue(page)).toHaveCount(0);
  return { base, guest };
}

test.describe('moving seated guests (M1.7f)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('keyboard: “Move to…” another table, with its errors, cancel and a persisted result', async ({
    page,
  }) => {
    await signIn(page);
    const { base, guest } = await seatedGuest(page, 'Move Gala');
    const t1 = tableCard(page, 'Table 1');
    const move = t1.getByRole('button', { name: `Move ${guest} to another seat` });
    await move.focus();
    await page.keyboard.press('Enter');
    await expect(move).toHaveAttribute('aria-expanded', 'true');
    const form = page.getByRole('form', { name: `Move ${guest}` });
    const item = form.getByLabel('Table or row');
    await expect(item).toBeFocused();
    await expectAccessible(page);
    // Nothing chosen: said so.
    await form.getByRole('button', { name: 'Move' }).click();
    await expect(page.locator('[aria-live="polite"]').getByRole('alert')).toHaveText(
      'Choose a table or row.',
    );
    // By keyboard: Table 2, its first free seat, Move.
    await stepOption(item, 2);
    await expect(item).toHaveText('Table 2 — 4 of 4 free');
    await page.keyboard.press('Tab');
    const seat = form.getByLabel('Seat', { exact: true });
    await expect(seat).toBeFocused();
    await stepOption(seat);
    await expect(seat).toHaveText('Table 2 · 1');
    await page.keyboard.press('Tab');
    await expect(form.getByRole('button', { name: 'Move' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toHaveText(`${guest} moved to Table 2.`);
    await expect(tableCard(page, 'Table 2')).toContainText(guest);
    await expect(tableCard(page, 'Table 2')).toContainText('Table 2 · 1');
    await expect(tableCard(page, 'Table 1')).toContainText('No one yet.');
    await expectAccessible(page);
    // Cancel closes the form without moving anyone.
    await tableCard(page, 'Table 2')
      .getByRole('button', { name: `Move ${guest} to another seat` })
      .click();
    await page
      .getByRole('form', { name: `Move ${guest}` })
      .getByRole('button', { name: 'Cancel' })
      .click();
    await expect(page.getByRole('form', { name: `Move ${guest}` })).toHaveCount(0);
    // It persisted; and the plan view counts the guest's seat as assigned, apart from blocked.
    await page.reload();
    await expect(tableCard(page, 'Table 2')).toContainText(guest);
    await page.goto(`${base}/seating`);
    await expect(page.getByTestId('seat-counts')).toHaveText(
      '8 seats · 7 available · 0 held · 0 sold · 1 assigned to guests · 0 blocked',
    );
    const legend = page.getByRole('list', { name: 'What the seat colours mean' });
    await expect(legend.getByText("Guest's seat", { exact: true })).toBeVisible();
    await expect(legend.getByText('Blocked', { exact: true })).toBeVisible();
    // A viewer can't move anyone.
    await signIn(page, VIEWER);
    await page.goto(`${base}/seating/assign`);
    await expect(tableCard(page, 'Table 2')).toContainText(guest);
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
  });

  test('drag: a seated name onto another table, and a guest’s seat on the plan onto another seat', async ({
    page,
  }) => {
    await signIn(page);
    const { guest } = await seatedGuest(page, 'Drag Move Gala');
    const plan = page.getByTestId('assignment-plan');
    const canvas = plan.locator('canvas').first();
    await expect(canvas).toBeVisible();
    // The quick layout (1060 × 1300 cm, stage on top): table 1 centred at (330, 830), table 2 at
    // (730, 830); seat 1 of each 125 cm above its centre.
    const at = async (x: number, y: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const c = await canvas.boundingBox();
      if (!c) throw new Error('no plan');
      return { x: c.x + (x * c.width) / 1060, y: c.y + (y * c.width) / 1060 };
    };
    // 1. The name, from Table 1's list, dropped on Table 2 (drag events at a point of the room).
    const row = tableCard(page, 'Table 1').getByRole('listitem').filter({ hasText: guest });
    const p = await at(730, 830);
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await row.dispatchEvent('dragstart', { dataTransfer });
    await plan.dispatchEvent('dragover', { dataTransfer, clientX: p.x, clientY: p.y });
    await plan.dispatchEvent('drop', { dataTransfer, clientX: p.x, clientY: p.y });
    await expect(feedback(page)).toHaveText(`${guest} moved to Table 2.`);
    await expect(tableCard(page, 'Table 2')).toContainText('Table 2 · 1');

    // 2. On the plan: press on their seat (Table 2 · 1), drag, release on Table 1's seat 1.
    const from = await at(730, 705);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const to = await at(330, 705);
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await expect(feedback(page)).toHaveText(`${guest} moved to Table 1.`);
    await expect(tableCard(page, 'Table 1')).toContainText(guest);
    await expect(tableCard(page, 'Table 1')).toContainText('Table 1 · 1');
    await expectAccessible(page);

    // Released where it started: nothing moves.
    const same = await at(330, 705);
    await page.mouse.move(same.x, same.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(tableCard(page, 'Table 1')).toContainText('Table 1 · 1');
  });

  test('renders right to left in Arabic', async ({ page }) => {
    await signIn(page);
    const { base, guest } = await seatedGuest(page, 'RTL Move Gala');
    await page.goto(`/ar${base}/seating/assign`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: `نقل ${guest} إلى مقعد آخر` }).click();
    await expect(page.getByRole('form', { name: `نقل ${guest}` })).toBeVisible();
    await expectAccessible(page);
  });
});
