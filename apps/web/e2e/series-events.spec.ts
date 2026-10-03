import { expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  pickOption,
  pickWithKeyboard,
  signIn,
} from './helpers.ts';

/**
 * U7: series and events, connected — the Series field when creating an event (quick and guided),
 * "Part of {series}" on the event header and the public event page, the series page's Events
 * and Details tabs, adding and removing events, and "Create next event in series".
 */

const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const tagOf = () => `${test.info().project.name.replace(/[^a-z0-9]/g, '')}${Date.now().toString(36)}`;
const seriesCombo = (page: Page) => page.getByRole('combobox', { name: 'Series (optional)' });

/** Pick an existing series in the Series field, then move on (Tab) so its list is closed. */
async function pickSeries(page: Page, name: string) {
  await pickOption(seriesCombo(page), { label: name });
  await expect(seriesCombo(page)).toHaveValue(name);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox', { name: 'Series (optional)' })).toHaveCount(0);
}

/** The quick create form, up to (not including) the submit; the series is picked by the caller. */
async function fillQuickEvent(page: Page, name: string, day = '10') {
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(`2027-09-${day}T19:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`2027-09-${day}T23:00`);
}

async function createSeries(page: Page, name: string) {
  await page.goto(`${ORG}/series`);
  const form = page.getByRole('region', { name: 'New series' });
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Create series' }).click();
  await expect(form.getByText('Series created.')).toBeVisible();
}

async function publishWithPass(page: Page, base: string) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Stop pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('20');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Stop pass' })).toBeVisible();
  await page.goto(base);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe('series ↔ events', () => {
  test('create an event in a new series, see it on both series pages, create the next one, remove one', async ({
    page,
    browser,
  }) => {
    // A long journey across console and public pages.
    test.setTimeout(150_000);
    const tag = tagOf();
    const series = `Tour ${tag}`;
    const first = `Stop One ${tag}`;
    await signIn(page);

    // Create-event: the Series field creates a new series inline (keyboard: type, then Enter).
    await page.goto(`${ORG}/events/new`);
    await expect(
      page.getByText('Group this event with others in a tour or season.', { exact: false }),
    ).toBeVisible();
    await fillQuickEvent(page, first);
    await seriesCombo(page).focus();
    await page.keyboard.type(series);
    await expect(page.getByRole('option', { name: `Create “${series}”` })).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Enter');
    await expect(seriesCombo(page)).toHaveValue(series);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    const base = new URL(page.url()).pathname;
    const slug = base.split('/').pop() as string;

    // The event header names its series and links the series page.
    const partOf = page.getByRole('link', { name: `Part of ${series}` });
    await expect(partOf).toBeVisible();
    await expectAccessibleBothModes(page);
    await publishWithPass(page, base);
    await page.getByRole('link', { name: `Part of ${series}` }).click();

    // The series page: Events tab with status, dates and sales.
    await expect(page.getByRole('heading', { level: 1, name: series })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Events', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { name: '1 event' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: first });
    await expect(row).toBeVisible();
    await expect(row.getByText(/^Published ·/)).toBeVisible();
    await expect(row.getByText('Sep 10, 2027', { exact: false })).toBeVisible();
    await expect(row.getByText('No sales yet')).toBeVisible();
    await expectAccessibleBothModes(page);
    expect(await noSideScroll(page)).toBe(true);

    // Public: the event page links its series, and the public series page lists the event.
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}`);
    await guest.getByRole('link', { name: `Part of ${series}` }).click();
    await expect(guest).toHaveURL(new RegExp(`/series/tour-${tag}$`));
    await expect(guest.getByRole('heading', { level: 1, name: series })).toBeVisible();
    await expect(guest.getByRole('link', { name: `View ${first}` })).toBeVisible();
    await guest.goto(`/events/${slug}`);
    await expectAccessibleBothModes(guest);
    await guest.goto(`/ar/events/${slug}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('link', { name: `ضمن ${series}` })).toBeVisible();
    await expectAccessible(guest);

    // Create next event in series: the latest event's setup, a draft in the series.
    await page.getByRole('link', { name: 'Create next event in series' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Create next event in series' })).toBeVisible();
    await expect(
      page.getByText(`Copies the settings, ticket types, questions and seating plan of ${first}`, {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByLabel('Event name', { exact: true })).toHaveValue(first);
    await expect(page.getByLabel('Starts', { exact: true })).toHaveAttribute(
      'data-value',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    );
    await expectAccessibleBothModes(page);
    // Validation: a one-letter name is refused with its message.
    await page.getByLabel('Event name', { exact: true }).fill('X');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Enter a name of 2 to 160 characters.')).toBeVisible();
    const second = `Stop Two ${tag}`;
    await page.getByLabel('Event name', { exact: true }).fill(second);
    await page.getByLabel('Starts', { exact: true }).fill('2028-09-10T19:00');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    const nextBase = new URL(page.url()).pathname;
    await expect(page.getByText(/^Draft ·/)).toBeVisible();
    await expect(page.getByRole('link', { name: `Part of ${series}` })).toBeVisible();
    // It copied the pass.
    await page.goto(`${nextBase}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: 'Stop pass' })).toBeVisible();

    // Both events on the series page, earliest first.
    await page.goto(`${ORG}/series/tour-${tag}`);
    await expect(page.getByRole('heading', { name: '2 events' })).toBeVisible();
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows.nth(1)).toContainText(first);
    await expect(rows.nth(2)).toContainText(second);
    await expect(rows.nth(2)).toContainText(/Draft ·/);

    // Remove one (keyboard): it leaves the series, the event stays, and both sides unlink.
    await page.getByRole('button', { name: `Remove ${first} from the series` }).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Event removed from the series. The event itself is unchanged.'),
    ).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: first })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '1 event' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: first })).toHaveCount(0);
    await page.goto(base);
    await expect(page.getByRole('main').getByText(first).first()).toBeVisible();
    await expect(page.getByRole('link', { name: `Part of ${series}` })).toHaveCount(0);
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByRole('link', { name: `Part of ${series}` })).toHaveCount(0);
    await guest.goto(`/series/tour-${tag}`);
    await expect(guest.getByRole('link', { name: `View ${first}` })).toHaveCount(0);
  });

  test('pick an existing series in create-event; a taken or too-short new name is refused', async ({
    page,
  }) => {
    const tag = tagOf();
    const series = `Season ${tag}`;
    await signIn(page);
    await createSeries(page, series);

    // A new series whose name is already taken.
    await page.goto(`${ORG}/events/new`);
    await fillQuickEvent(page, `Taken ${tag}`);
    // The same address as the existing series ("season-…"), a different name.
    await seriesCombo(page).fill(`${series}!`);
    await page.getByRole('option', { name: `Create “${series}!”` }).click();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(
      page.getByText('A series with this name already exists. Pick it from the list instead.').first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/events\/new$/);
    await expectAccessible(page);

    // A one-letter new name.
    await page.goto(`${ORG}/events/new`);
    await fillQuickEvent(page, `Short ${tag}`);
    await seriesCombo(page).fill('X');
    await page.getByRole('option', { name: 'Create “X”' }).click();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Enter a series name of 2 to 160 characters.').first()).toBeVisible();

    // The existing series, picked from the list.
    await page.goto(`${ORG}/events/new`);
    await fillQuickEvent(page, `Picked ${tag}`);
    await pickSeries(page, series);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    await expect(page.getByRole('link', { name: `Part of ${series}` })).toBeVisible();
    // The event's Dates tab shows the same series.
    await page.goto(`${new URL(page.url()).pathname}/dates`);
    await expect(
      page.getByRole('region', { name: 'Series' }).getByRole('combobox', { name: 'Series' }),
    ).toContainText(series);
  });

  test('an empty series page leads to "Create event in this series", which picks it in advance', async ({
    page,
  }) => {
    const tag = tagOf();
    const series = `Empty ${tag}`;
    await signIn(page);
    await createSeries(page, series);
    await page.getByRole('link', { name: series, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: series })).toBeVisible();
    await expect(page.getByText('No events in this series yet')).toBeVisible();
    // No "Create next" without an event to copy.
    await expect(page.getByRole('link', { name: 'Create next event in series' })).toHaveCount(0);
    await expectAccessibleBothModes(page);
    await page.getByRole('link', { name: 'Create event in this series' }).click();
    await expect(page).toHaveURL(/\/events\/new\?series=/);
    await expect(seriesCombo(page)).toHaveValue(series);
    await fillQuickEvent(page, `Inside ${tag}`, '12');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    await page.getByRole('link', { name: `Part of ${series}` }).click();
    await expect(page.getByRole('row').filter({ hasText: `Inside ${tag}` })).toBeVisible();
  });

  test('the guided wizard has the Series field on its first step', async ({ page }) => {
    const tag = tagOf();
    const series = `Guided ${tag}`;
    await signIn(page);
    await createSeries(page, series);
    await page.goto(`${ORG}/events/new/guided`);
    await page.getByLabel('Event name', { exact: true }).fill(`Wizard ${tag}`);
    await pickSeries(page, series);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await pickOption(page.getByLabel('Time zone'), 'America/Chicago');
    await page.getByLabel('Starts', { exact: true }).fill('2027-10-01T09:00');
    await page.getByLabel('Ends', { exact: true }).fill('2027-10-01T17:00');
    await page.getByRole('button', { name: 'Next' }).click();
    // The summary names the series; Back keeps it.
    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(summary.getByText(series)).toBeVisible();
    await page.getByRole('button', { name: 'Step 1 of 3: Basics' }).click();
    await expect(seriesCombo(page)).toHaveValue(series);
    await page.getByRole('button', { name: 'Step 3 of 3: Tickets and publishing' }).click();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/setup-guide$/);
    await expect(page.getByRole('link', { name: `Part of ${series}` })).toBeVisible();
  });

  test('add an existing event to a series from its page', async ({ page }) => {
    const tag = tagOf();
    const series = `Adds ${tag}`;
    const loose = `Loose ${tag}`;
    await signIn(page);
    await page.goto(`${ORG}/events/new`);
    await fillQuickEvent(page, loose, '14');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    await expect(page.getByRole('link', { name: /^Part of / })).toHaveCount(0);
    await createSeries(page, series);
    await page.goto(`${ORG}/series/adds-${tag}`);
    const add = page.getByRole('region', { name: 'Add an existing event' });
    // Nothing chosen: the field says what to do.
    await add.getByRole('button', { name: 'Add to series' }).click();
    await expect(add.getByText('Choose an event to add.')).toBeVisible();
    await expectAccessible(page);
    await pickWithKeyboard(add.getByRole('combobox', { name: 'Event' }), {
      label: new RegExp(`^${loose} · `),
    });
    await add.getByRole('button', { name: 'Add to series' }).click();
    await expect(page.getByText('Event added to the series.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: loose })).toBeVisible();
    await page.getByRole('row').filter({ hasText: loose }).getByRole('link', { name: loose }).click();
    await expect(page.getByRole('link', { name: `Part of ${series}` })).toBeVisible();
  });

  test('details tab: rename keeps the address; delete leaves the events', async ({ page }) => {
    const tag = tagOf();
    const series = `Rename ${tag}`;
    await signIn(page);
    await createSeries(page, series);
    await page.goto(`${ORG}/series/rename-${tag}`);
    await page.getByRole('link', { name: 'Details', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Details', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: `/series/rename-${tag}` })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Y');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter a name of 2 to 160 characters.')).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill(`Renamed ${tag}`);
    await page.getByLabel('Description (optional)').fill('Every autumn');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Series saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: `Renamed ${tag}` })).toBeVisible();
    await expect(page.getByLabel('Description (optional)')).toHaveValue('Every autumn');
    await expectAccessibleBothModes(page);
    await page.getByRole('button', { name: 'Delete series' }).click();
    await expect(page).toHaveURL(/\/series\?deleted=1$/);
    await expect(page.getByText('Series deleted. Its events are unchanged.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `Renamed ${tag}` })).toHaveCount(0);
    expect((await page.goto(`${ORG}/series/rename-${tag}`))?.status()).toBe(404);
  });

  test('viewers see a series and its events but cannot change them', async ({ page, browser }) => {
    const tag = tagOf();
    const series = `Viewed ${tag}`;
    const owner = await (await browser.newContext()).newPage();
    await signIn(owner);
    await owner.goto(`${ORG}/events/new`);
    await fillQuickEvent(owner, `Watched ${tag}`, '16');
    await seriesCombo(owner).fill(series);
    await owner.getByRole('option', { name: `Create “${series}”` }).click();
    await owner.getByRole('button', { name: 'Create draft' }).click();
    await expect(owner).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);

    await signIn(page, VIEWER);
    await page.goto(`${ORG}/series/viewed-${tag}`);
    await expect(page.getByRole('heading', { level: 1, name: series })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `Watched ${tag}` })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create next event in series' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Remove .* from the series$/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Add an existing event' })).toHaveCount(0);
    await expectAccessible(page);
    expect((await page.goto(`${ORG}/series/viewed-${tag}/next`))?.status()).toBe(404);
    await page.goto(`${ORG}/series/viewed-${tag}/details`);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete series' })).toHaveCount(0);
    expect((await page.goto(`${ORG}/series/no-such-series-${tag}`))?.status()).toBe(404);
  });

  test('the series page in Arabic (RTL)', async ({ page }) => {
    const tag = tagOf();
    const series = `Rtl ${tag}`;
    await signIn(page);
    await createSeries(page, series);
    await page.goto(`/ar${ORG}/series/rtl-${tag}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: series })).toBeVisible();
    await expect(page.getByText('لا توجد فعاليات في هذه السلسلة بعد')).toBeVisible();
    await expectAccessible(page);
    expect(await noSideScroll(page)).toBe(true);
    await page.goto(`/ar${ORG}/events/new`);
    await expect(page.getByRole('combobox', { name: 'السلسلة (اختياري)' })).toBeVisible();
    await expectAccessible(page);
  });
});
