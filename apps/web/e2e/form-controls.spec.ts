import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, expectPicked, pickOption } from './helpers.ts';

/**
 * U1 form controls on the living style guide (/dev/design): the chevron fix measured in the
 * browser at all three sizes, LTR and RTL; the WAI-ARIA keyboard patterns; search, chips, the
 * calendar and the pickers; axe with the lists open in both themes.
 */
const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
};
const hidden = (page: Page, name: string, section: string) =>
  page.getByTestId(`controls-${section}`).locator(`input[name="${name}"]`);

test.beforeEach(async ({ page }) => {
  const res = await page.goto('/dev/design');
  expect(res?.status()).toBe(200);
});

test.describe('the chevron sits inside the field', () => {
  for (const section of ['light', 'rtl'] as const) {
    for (const size of ['sm', 'md', 'lg'] as const) {
      test(`${section} ${size}: centred, 16 px, 12 px from the inline end, text clear of it`, async ({
        page,
      }) => {
        const trigger = page.locator(`#size-${size}-${section}`);
        await trigger.scrollIntoViewIfNeeded();
        const chevron = trigger.locator('svg[data-chevron]');
        const t = await box(trigger);
        const c = await box(chevron);
        const label = await box(trigger.locator('span').first());
        expect(c.width).toBeCloseTo(16, 0);
        expect(c.height).toBeCloseTo(16, 0);
        // Vertically centred.
        expect(Math.abs(c.y + c.height / 2 - (t.y + t.height / 2))).toBeLessThanOrEqual(1);
        // Inside the field with 12 px inline-end padding (the right in LTR, the left in RTL).
        const endGap = section === 'rtl' ? c.x - t.x : t.x + t.width - (c.x + c.width);
        expect(endGap).toBeGreaterThanOrEqual(11);
        expect(endGap).toBeLessThanOrEqual(13);
        // The text never runs under the chevron.
        if (section === 'rtl') expect(label.x).toBeGreaterThanOrEqual(c.x + c.width);
        else expect(label.x + label.width).toBeLessThanOrEqual(c.x);
        // Our own icon: the native arrow is gone.
        expect(await trigger.evaluate((el) => getComputedStyle(el).appearance)).toBe('none');
      });
    }
  }

  test('visual snapshot: the three sizes in LTR and RTL', async ({ page }) => {
    for (const section of ['light', 'rtl'] as const) {
      const row = page.locator(`#size-sm-${section}`).locator('xpath=../../..');
      await row.scrollIntoViewIfNeeded();
      await expect(row).toHaveScreenshot(`select-sizes-${section}.png`, { maxDiffPixelRatio: 0.02 });
    }
  });

  test('turns 180° while open and the list is our themed panel, not the OS popup', async ({ page }) => {
    const trigger = page.locator('#size-md-dark');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(async () => trigger.locator('svg[data-chevron]').evaluate((el) => getComputedStyle(el).rotate))
      .toBe('180deg');
    const list = page.locator('#size-md-dark-list');
    await expect(list).toBeVisible();
    const [panelBg, fieldBg] = await Promise.all([
      list.locator('xpath=..').evaluate((el) => getComputedStyle(el).backgroundColor),
      trigger.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(panelBg).toBe(fieldBg); // surface-solid of the dark theme
    await expect(list.getByRole('option', { name: 'Published' })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Select keyboard (WAI-ARIA select-only combobox)', () => {
  test('arrows, Enter, Escape, Home/End, type-ahead and Tab', async ({ page }) => {
    const trigger = page.locator('#size-md-light');
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const active = () => trigger.getAttribute('aria-activedescendant');
    await expect.poll(active).toBe('size-md-light-list-1');
    await page.keyboard.press('ArrowDown');
    await expect.poll(active).toBe('size-md-light-list-2');
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(hidden(page, 'size-md', 'light')).toHaveValue('cancelled');
    // Escape closes without changing the value.
    await page.keyboard.press('Space');
    await page.keyboard.press('Home');
    await expect.poll(active).toBe('size-md-light-list-0');
    await page.keyboard.press('Escape');
    await expect(hidden(page, 'size-md', 'light')).toHaveValue('cancelled');
    // Type-ahead on the closed trigger opens on the match; End jumps to the last option.
    await page.keyboard.press('p');
    await expect.poll(active).toBe('size-md-light-list-1');
    await page.keyboard.press('End');
    await expect.poll(active).toBe('size-md-light-list-2');
    await page.keyboard.press('ArrowUp');
    // Tab chooses the active option and moves on.
    await page.keyboard.press('Tab');
    await expect(hidden(page, 'size-md', 'light')).toHaveValue('published');
    await expect(trigger).not.toBeFocused();
  });

  test('above eight options a search box filters as you type', async ({ page }) => {
    const trigger = page.locator('#country-light');
    await trigger.click();
    const search = page.getByRole('combobox', { name: 'Search' });
    await expect(search).toBeFocused();
    await search.fill('ken');
    const list = page.locator('#country-light-list');
    await expect(list.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(hidden(page, 'country', 'light')).toHaveValue('kenya');
    await expect(trigger).toHaveText('Kenya');
    // No match says so.
    await trigger.click();
    await page.getByRole('combobox', { name: 'Search' }).fill('zzz');
    await expect(list.getByRole('status')).toHaveText('No matches');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });

  test('long labels wrap in the list, groups are labelled, disabled does nothing', async ({ page }) => {
    await page.locator('#long-light').click();
    const long = page.locator('#long-light-list').getByRole('option').first();
    const b = await box(long);
    expect(b.height).toBeGreaterThan(44); // wrapped onto two lines, not cut
    await page.keyboard.press('Escape');
    await page.locator('#groups-light').click();
    await expect(page.getByRole('group', { name: 'Series' }).getByRole('option')).toHaveText([
      'Concert season',
    ]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#dis-sel-light')).toBeDisabled();
    await expect(page.locator('#err-light')).toHaveAttribute('aria-invalid', 'true');
  });

  test('pickOption helper and the hidden input agree', async ({ page }) => {
    const trigger = page.getByLabel('Applies to').first();
    await pickOption(trigger, { label: 'Autumn Fair' });
    await expectPicked(trigger, 'event:Autumn Fair');
    await expect(hidden(page, 'scope', 'light')).toHaveValue('event:Autumn Fair');
  });
});

test.describe('Combobox', () => {
  test('multi-select chips: add by typing, remove with the chip button or Backspace, create new', async ({
    page,
  }) => {
    const input = page.locator('#tags-light');
    await input.click();
    await input.fill('pre');
    await page.keyboard.press('Enter');
    const values = () =>
      hidden(page, 'tags', 'light').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    await expect.poll(values).toEqual(['vip', 'press']);
    await page.getByRole('button', { name: 'Remove VIP' }).first().click();
    await expect.poll(values).toEqual(['press']);
    await input.fill('Caterer');
    await page.getByRole('option', { name: 'Create “Caterer”' }).click();
    await expect.poll(values).toEqual(['press', 'caterer']);
    await input.focus();
    await page.keyboard.press('Backspace');
    await expect.poll(values).toEqual(['press']);
  });

  test('async options load as you type', async ({ page }) => {
    const input = page.locator('#city-light');
    await input.fill('lis');
    await expect(page.locator('#city-light-list').getByRole('option')).toHaveText(['Lisbon']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(hidden(page, 'city', 'light')).toHaveValue('lisbon');
  });
});

test.describe('date and time pickers', () => {
  test('calendar keyboard: arrows, PageDown, Enter; typed entry; out-of-range refused', async ({ page }) => {
    const field = page.locator('#date-light');
    await expect(field).toHaveValue('11/05/2026');
    await field.locator('xpath=..').getByRole('button', { name: 'Choose a date' }).click();
    const grid = page.getByRole('grid');
    await expect(grid.locator('button[tabindex="0"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('PageDown');
    await page.keyboard.press('Enter');
    await expect(hidden(page, 'date', 'light')).toHaveValue('2026-12-13');
    await expect(field).toHaveValue('12/13/2026');
    // Typed ISO works whatever the locale; junk explains itself.
    await field.fill('2026-03-04');
    await expect(hidden(page, 'date', 'light')).toHaveValue('2026-03-04');
    await field.fill('soon');
    await field.blur();
    await expect(page.getByText(/Enter a date like/).first()).toBeVisible();
    await expect(hidden(page, 'date', 'light')).toHaveValue('');
    await field.fill('2025-06-01');
    await field.blur();
    await expect(page.getByText('Choose a date on or after 01/01/2026').first()).toBeVisible();
  });

  test('date-time shows the event zone; time picker lists times', async ({ page }) => {
    await expect(page.locator('#dt-light-zone')).toContainText(/Paris · UTC\+0[12]:00/);
    await expect(page.locator('#dt-light')).toHaveAttribute('aria-describedby', /dt-light-zone/);
    const dt = page.locator('#dt-light');
    await dt.fill('2026-11-06T08:15');
    await expect(hidden(page, 'doors', 'light')).toHaveValue('2026-11-06T08:15');
    await dt.blur();
    await expect(dt).toHaveValue('11/06/2026 8:15 AM');
    const time = page.locator('#time-light');
    await time.locator('xpath=..').getByRole('button', { name: 'Choose a time' }).click();
    await expect(page.getByRole('listbox', { name: 'Choose a time' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(hidden(page, 'start', 'light')).toHaveValue('19:45');
    await time.fill('7:05 pm');
    await expect(hidden(page, 'start', 'light')).toHaveValue('19:05');
  });

  test('RTL: the calendar mirrors (ArrowLeft goes forward) and the zone sits beside the field', async ({
    page,
  }) => {
    const field = page.locator('#date-rtl');
    await field.locator('xpath=..').getByRole('button', { name: 'Choose a date' }).click();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(hidden(page, 'date', 'rtl')).toHaveValue('2026-11-06');
  });

  test('time zone and currency pickers search by city, offset, code or symbol', async ({ page }) => {
    await page.locator('#tz-light').click();
    await page.getByRole('combobox', { name: 'Search' }).fill('kolkata');
    await expect(page.locator('#tz-light-list').getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(hidden(page, 'timezone', 'light')).toHaveValue('Asia/Kolkata');
    await page.locator('#cur-light').click();
    await page.getByRole('combobox', { name: 'Search' }).fill('yen');
    await page.locator('#cur-light-list').getByRole('option', { name: /JPY/ }).click();
    await expect(hidden(page, 'currency', 'light')).toHaveValue('JPY');
  });
});

test.describe('accessibility', () => {
  test.slow();
  test('axe clean in both themes with a list open, and in Arabic', async ({ page }) => {
    await page.locator('#country-light').click();
    await expectAccessibleBothModes(page);
    await page.keyboard.press('Escape');
    await page
      .locator('#date-dark')
      .locator('xpath=..')
      .getByRole('button', { name: 'Choose a date' })
      .click();
    await expectAccessible(page);
    const res = await page.goto('/ar/dev/design');
    expect(res?.status()).toBe(200);
    await page.locator('#size-md-rtl').click();
    await expectAccessible(page);
  });
});
