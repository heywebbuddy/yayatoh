import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink } from '@yayatoh/db/platform';
import { listPlatformCategories, savePlatformDefaults } from '../src/server/platform-categories.ts';
import { expectAccessible, makeStaff, signInStaff, webPage, webUser } from './helpers.ts';

const ACTOR = 'staff:e2e';

test.afterAll(async () => {
  await closePools();
});

/** U8: the platform's default event categories (every new organization starts with them). */
test.describe('default event categories (U8)', () => {
  test('an admin takes a category out of the defaults, puts it back and reorders; restored after', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'desktop-1280', 'one project changes the single global list');
    // Whatever happens below, the global list goes back to how it was.
    setPlatformAuditSink(databaseAuditSink);
    const saved = (await listPlatformCategories(ACTOR)).filter((r) => r.inDefaults).map((r) => r.key);
    try {
      await defaultsJourney(page);
    } finally {
      await savePlatformDefaults(ACTOR, saved);
    }
  });

  test('the page works on a phone and support staff cannot open it', async ({ page, browser }) => {
    await signInStaff(page);
    await page.goto('/categories');
    await expect(page.getByRole('heading', { name: 'Default event categories', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save defaults' })).toBeVisible();
    await expectAccessible(page);

    const web = await webPage(browser);
    const support = await webUser(web, { signIn: false });
    await web.close();
    makeStaff(support.email, 'support');
    const other = await (await browser.newContext({ baseURL: new URL(page.url()).origin })).newPage();
    await signInStaff(other, support.email);
    await expect(
      other
        .getByRole('navigation', { name: 'Staff console' })
        .getByRole('link', { name: 'Event categories' }),
    ).toHaveCount(0);
    await other.goto('/categories');
    await expect(other).toHaveURL(/\/not-staff$/);
    await other.close();
  });
});

async function defaultsJourney(page: Page) {
  await signInStaff(page);
  await page
    .getByRole('navigation', { name: 'Staff console' })
    .getByRole('link', { name: 'Event categories' })
    .click();
  await expect(page).toHaveURL(/\/categories$/);
  await expect(page.getByRole('heading', { name: 'Default event categories', level: 1 })).toBeVisible();
  await expectAccessible(page);
  const rows = page.getByRole('listitem');
  const names = async () => (await rows.locator('span.font-semibold').allInnerTexts()).map((x) => x.trim());
  const before = await names();

  // Out of the defaults.
  await page.getByRole('checkbox', { name: 'Nightlife' }).uncheck();
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.getByText('Defaults saved.')).toBeVisible();
  await expect(rows.filter({ hasText: 'Nightlife' }).getByText('Not in the defaults')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Nightlife' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Move Nightlife up' })).toHaveCount(0);
  // Back in (it goes to the end of the defaults).
  await page.getByRole('checkbox', { name: 'Nightlife' }).check();
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(rows.filter({ hasText: 'Nightlife' }).getByText('Not in the defaults')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move Nightlife up' })).toBeVisible();

  // Keyboard: move Music up, then down again; focus stays on the button.
  const at = (await names()).indexOf('Music');
  await page.getByRole('button', { name: 'Move Music up' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Order saved.')).toBeVisible();
  await expect.poll(async () => (await names()).indexOf('Music')).toBe(at - 1);
  await expect(page.getByRole('button', { name: 'Move Music up' })).toBeFocused();
  await page.getByRole('button', { name: 'Move Music down' }).click();
  await expect.poll(async () => (await names()).indexOf('Music')).toBe(at);

  // Nothing ticked is refused with a message.
  for (const box of await page.getByRole('checkbox').all()) await box.uncheck();
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.getByText('Keep at least one category in the defaults.')).toBeVisible();
  await expectAccessible(page);

  // Restore the original order (Nightlife moved to the end of the list when re-added).
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await expect(page.getByText('Defaults saved.')).toBeVisible();
  for (let i = (await names()).indexOf('Nightlife'); i > before.indexOf('Nightlife'); i--) {
    await page.getByRole('button', { name: 'Move Nightlife up' }).click();
    await expect.poll(async () => (await names()).indexOf('Nightlife')).toBe(i - 1);
  }
  expect(await names()).toEqual(before);
}
