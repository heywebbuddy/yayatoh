import { expect, type Page, test } from '@playwright/test';
import { expectAccessible } from './helpers.ts';

const JAZZ = '/events/lakeside-jazz-night';

/** Each viewport project buys in its own row, so parallel projects never race each other. */
const ROWS: Record<string, string> = {
  'mobile-375': 'Row A',
  'tablet-768': 'Row B',
  'desktop-1280': 'Row C',
};
const myRow = () => ROWS[test.info().project.name] ?? 'Row A';

/**
 * Free seats in the project's row (a rerun locally finds some already sold): from the front for
 * the purchase test, from the back for the race test, so the two tests never want the same seat.
 */
async function freeSeats(page: Page, n: number, from: 'front' | 'back') {
  const boxes = page.getByRole('group', { name: myRow() }).locator('input[name="seat"]:not([disabled])');
  await expect(boxes.first()).toBeVisible();
  const all = await boxes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const ids = (from === 'front' ? all : all.reverse()).slice(0, n);
  expect(ids).toHaveLength(n);
  return ids;
}

async function buyer(page: Page, name: string) {
  await page.getByLabel('Full name').fill(name);
  await page
    .getByLabel('Email for your tickets')
    .fill(`${name.toLowerCase().replace(/\W+/g, '.')}@example.test`);
}

test.describe('seated checkout', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('a guest picks seats from the list (or the map), pays, and the tickets name the seats', async ({
    page,
  }) => {
    const stamp = Date.now();
    await page.goto(JAZZ);
    // Seated passes are bought by choosing seats; standing room still sells by quantity.
    await expect(page.getByText('Choose your seats below')).toHaveCount(2);
    await expect(page.getByLabel('Quantity — Standing')).toBeVisible();
    await expect(page.getByLabel('Quantity — Table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Choose your seats' })).toBeVisible();
    await expectAccessible(page);

    // The map is optional; the list is the default and does the same by keyboard.
    await page.getByRole('button', { name: 'Show seat map' }).click();
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.getByRole('button', { name: 'Hide seat map' }).click();

    const [first, second] = await freeSeats(page, 2, 'front');
    for (const id of [first, second]) await page.locator(`input[name="seat"][value="${id}"]`).check();
    await expect(page.getByRole('status').filter({ hasText: '2 seats selected' })).toBeVisible();
    const labels = await Promise.all(
      [first, second].map(async (id) =>
        ((await page.locator(`label:has(input[value="${id}"])`).innerText()).split(' (')[0] ?? '').trim(),
      ),
    );
    await buyer(page, `Billie Holiday ${stamp}`);
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    await page.getByRole('button', { name: 'Pay now (test)' }).click();
    await expect(page).toHaveURL(/\/orders\//);
    await expect(page.getByText('Paid', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your 2 tickets' })).toBeVisible();
    for (const label of labels) await expect(page.getByText(`Seat: ${label}`)).toBeVisible();
    await expectAccessible(page);

    // Sold seats can no longer be chosen.
    await page.goto(JAZZ);
    await expect(page.locator(`input[name="seat"][value="${first}"]`)).toBeDisabled();
  });

  test('two buyers race for the same seat: one gets it, the other is asked to choose again', async ({
    browser,
  }) => {
    const stamp = Date.now();
    const [one, two] = await Promise.all(
      [0, 1].map(async () =>
        (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(),
      ),
    );
    if (!one || !two) throw new Error('no pages');
    await Promise.all([one.goto(JAZZ), two.goto(JAZZ)]);
    const [seat] = await freeSeats(one, 1, 'back');
    for (const [p, name] of [
      [one, `Ella First ${stamp}`],
      [two, `Nina Second ${stamp}`],
    ] as const) {
      await p.locator(`input[name="seat"][value="${seat}"]`).check();
      await buyer(p, name);
    }
    await one.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(one.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
    // The first buyer's seat is held while they pay; the second is told and keeps their details.
    await two.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(two.getByText('Some of those seats were just taken. Please choose others.')).toBeVisible();
    await expect(two.getByLabel('Full name')).toHaveValue(`Nina Second ${stamp}`);
    // Their seat map is refreshed: the taken seat is shown as taken and dropped from the choice.
    await expect(two.locator(`input[name="seat"][value="${seat}"]`)).toBeDisabled();
    await expect(two.getByRole('status').filter({ hasText: 'No seats selected' })).toBeVisible();
  });
});
