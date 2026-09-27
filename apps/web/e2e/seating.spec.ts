import { expect, test } from '@playwright/test';
import { expectAccessible, signIn, WEDDING, WEDDING_OWNER } from './helpers.ts';

test.describe('seating', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('an organizer creates a plan, edits it by keyboard with undo, prices tables and puts seats on sale', async ({
    page,
  }) => {
    await signIn(page, WEDDING_OWNER);
    await page.goto(`${WEDDING}/seating`);
    await expect(page.getByRole('heading', { name: 'Seating', level: 1 })).toBeVisible();
    // A fresh database starts without a plan; a rerun locally finds the first run's.
    const create = page.getByRole('button', { name: 'Create plan' });
    if (await create.isVisible()) {
      await expectAccessible(page);
      await page.getByLabel('Rows').fill('2');
      await page.getByLabel('Seats per row').fill('6');
      await page.getByLabel('Round tables').fill('3');
      await page.getByLabel('Seats per table').fill('8');
      await create.click();
      // The page turns into the editor once the plan exists.
    }
    await expect(
      page.getByRole('application', { name: 'Seating plan' }).locator('canvas').first(),
    ).toBeVisible();

    // The list editor and the keyboard do everything the canvas does.
    const list = page.getByRole('table', { name: 'Everything on the plan' });
    const x = list.getByRole('spinbutton', { name: 'x — A' });
    const before = Number(await x.inputValue());
    await list.getByRole('checkbox', { name: 'Select A' }).check();
    const plan = page.getByRole('application', { name: 'Seating plan' });
    await plan.focus();
    await page.keyboard.press('ArrowRight');
    await expect(x).toHaveValue(String(before + 10));
    await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(x).toHaveValue(String(before));
    await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
    await expectAccessible(page);

    // Price the tables, then put seats on sale.
    const prices = page.getByRole('region', { name: 'Prices' });
    await prices.getByRole('checkbox', { name: 'Table 1' }).check();
    await prices.getByLabel('Sells as').selectOption({ index: 0 });
    await prices.getByRole('button', { name: 'Set price' }).click();
    await expect(prices.getByText('Prices updated.')).toBeVisible();
    const publish = page.getByRole('button', { name: 'Put seats on sale' });
    if (await publish.isVisible()) await publish.click();
    await expect(page.getByText('On sale', { exact: true })).toBeVisible();
  });
});
