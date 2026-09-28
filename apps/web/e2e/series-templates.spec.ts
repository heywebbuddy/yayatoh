import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/** M1.4b: event series (console + public page + filter), duplicate event, org templates. */

const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const tagOf = () => `${test.info().project.name.replace(/[^a-z0-9]/g, '')}${Date.now()}`;

async function createEvent(page: Page, name: string): Promise<string> {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill('2027-09-10T19:00');
  await page.getByLabel('Ends', { exact: true }).fill('2027-09-10T23:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

async function addTicketType(page: Page, base: string, name: string) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('20');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe('series', () => {
  test('create a series, put an event in it, see it publicly and filter the console by it', async ({
    page,
    browser,
  }) => {
    const tag = tagOf();
    await signIn(page);
    await page.goto(`${ORG}/series`);
    await expectAccessible(page);
    const form = page.getByRole('region', { name: 'New series' });
    // Validation: a one-letter name is refused with its message.
    await form.getByLabel('Name').fill('X');
    await form.getByRole('button', { name: 'Create series' }).click();
    await expect(form.getByText('Enter a name of 2 to 160 characters.')).toBeVisible();
    await expectAccessible(page);
    const name = `Tour ${tag}`;
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Description (optional)').fill('Four cities, one summer');
    await form.getByRole('button', { name: 'Create series' }).click();
    await expect(form.getByText('Series created.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
    // The same name again is refused (series addresses are global).
    await form.getByLabel('Name').fill(name);
    await form.getByRole('button', { name: 'Create series' }).click();
    await expect(form.getByText('A series with this name already exists.', { exact: false })).toBeVisible();

    const base = await createEvent(page, `Tour Stop ${tag}`);
    const slug = base.split('/').pop() as string;
    await addTicketType(page, base, 'Stop pass');
    await page.goto(`${base}/dates`);
    const picker = page.getByRole('region', { name: 'Series' });
    await picker.getByRole('combobox', { name: 'Series' }).selectOption({ label: name });
    await picker.getByRole('button', { name: 'Save series' }).click();
    await expect(picker.getByText('Series saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Series' })).toHaveValue(/.+/);
    await page.goto(base);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();

    // Console: the org home filters by series (keyboard: follow the filter link with Enter).
    await page.goto(ORG);
    const filter = page.getByRole('navigation', { name: 'Filter events by series' });
    await filter.getByRole('link', { name }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?series=/);
    await expect(filter.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: `Tour Stop ${tag}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lakeside Open House' })).toHaveCount(0);
    await expectAccessible(page);
    await filter.getByRole('link', { name: 'All events' }).click();
    await expect(page.getByRole('heading', { name: 'Lakeside Open House' })).toBeVisible();

    // Public series page.
    const guest = await (await browser.newContext()).newPage();
    const seriesSlug = `tour-${tag}`;
    await guest.goto(`/series/${seriesSlug}`);
    await expect(guest.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(guest.getByText('Four cities, one summer')).toBeVisible();
    await expect(guest.getByText('A series by Lakeside Events')).toBeVisible();
    await guest.getByRole('link', { name: `View Tour Stop ${tag}` }).click();
    await expect(guest).toHaveURL(new RegExp(`/events/${slug}$`));
    await guest.goto(`/series/${seriesSlug}`);
    await expectAccessible(guest);
    expect(await noSideScroll(guest)).toBe(true);
    await guest.goto(`/ar/series/${seriesSlug}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: 'الفعاليات القادمة' })).toBeVisible();
    await expectAccessible(guest);
    expect((await guest.goto('/series/no-such-series-here'))?.status()).toBe(404);

    // Deleting the series keeps the event; the public page is gone.
    await page.goto(`${ORG}/series`);
    await page.getByRole('button', { name: `Delete the series ${name}` }).click();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
    expect((await guest.goto(`/series/${seriesSlug}`))?.status()).toBe(404);
    expect((await guest.goto(`/events/${slug}`))?.status()).toBe(200);
  });

  test('viewers see series but cannot create or delete them', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(`${ORG}/series`);
    await expect(page.getByRole('heading', { name: 'Series', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New series' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete the series/ })).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe('duplicate and templates', () => {
  test('duplicating an event copies its setup but never its orders', async ({ page, browser }) => {
    const tag = tagOf();
    await signIn(page);
    const name = `Gala Night ${tag}`;
    const base = await createEvent(page, name);
    const slug = base.split('/').pop() as string;
    await addTicketType(page, base, 'Gala seat');
    await page.goto(base);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
    // A real order on the source.
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}`);
    await guest.getByLabel('Quantity — Gala seat').selectOption('2');
    await guest.getByLabel('Full name').fill(`Ada ${tag}`);
    await guest.getByLabel('Email for your tickets').fill(`ada${tag}@example.test`);
    await guest.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(guest).toHaveURL(/\/orders\//);
    await page.goto(`${base}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: `Ada ${tag}` })).toBeVisible();

    await page.goto(`${base}/copy`);
    await expectAccessible(page);
    const dup = page.getByRole('region', { name: 'Duplicate this event' });
    await expect(dup.getByLabel('Name of the new event')).toHaveValue(`${name} (copy)`);
    await expect(dup.getByLabel('Starts', { exact: true })).toHaveValue('2027-09-10T19:00');
    // Validation: a one-letter name.
    await dup.getByLabel('Name of the new event').fill('X');
    await dup.getByRole('button', { name: 'Duplicate event' }).click();
    await expect(dup.getByText('Check this value.')).toBeVisible();
    await dup.getByLabel('Name of the new event').fill(`${name} (copy)`);
    await dup.getByLabel('Starts', { exact: true }).fill('2028-09-08T19:00');
    await dup.getByRole('button', { name: 'Duplicate event' }).click();
    await expect(page).toHaveURL(new RegExp(`/e/${slug}-copy$`));
    await expect(page.getByText('Draft ·')).toBeVisible();
    await page.goto(`${ORG}/e/${slug}-copy/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: 'Gala seat' })).toContainText('0 / 20');
    await expect(page.getByText('No orders yet')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `Ada ${tag}` })).toHaveCount(0);
    await page.goto(`${ORG}/e/${slug}-copy/attendees`);
    await expect(page.getByText(`Ada ${tag}`)).toHaveCount(0);
    // The source keeps its order.
    await page.goto(`${base}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: `Ada ${tag}` })).toBeVisible();
  });

  test('save an event as a template and create a new event from it', async ({ page }) => {
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Kit Source ${tag}`);
    await addTicketType(page, base, 'Kit pass');
    await page.goto(`${base}/copy`);
    const save = page.getByRole('region', { name: 'Save as template' });
    const kit = `Kit ${tag}`;
    await save.getByLabel('Template name').fill(kit);
    await save.getByLabel('Description (optional)').fill('Our house style');
    await save.getByRole('button', { name: 'Save template' }).click();
    await expect(save.getByText('Template saved.')).toBeVisible();
    await expect(save.getByRole('link', { name: 'Open templates' })).toHaveAttribute('href', /\/templates$/);
    await expectAccessible(page);
    // The same name twice is refused.
    await save.getByRole('button', { name: 'Save template' }).click();
    await expect(save.getByText('That name is already used. Choose another.')).toBeVisible();

    // The org sidebar leads to the templates.
    await page.goto(`${ORG}/templates`);
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: kit }) });
    await expect(card.getByText('Our house style')).toBeVisible();
    await expect(card.getByText('1 ticket type · 0 questions · no floor plan')).toBeVisible();
    await expectAccessible(page);
    // Keyboard: open the disclosure with Enter.
    await card.getByText(`Create an event from ${kit}`).focus();
    await page.keyboard.press('Enter');
    await card.getByLabel('Name of the new event').fill(`From Kit ${tag}`);
    await card.getByRole('button', { name: 'Create event' }).click();
    await expect(card.getByText('Check this value.')).toBeVisible();
    await card.getByLabel('Starts', { exact: true }).fill('2028-02-01T18:00');
    await card.getByRole('button', { name: 'Create event' }).click();
    await expect(page).toHaveURL(/\/e\/from-kit-/);
    await expect(page.getByText('Draft ·')).toBeVisible();
    const made = new URL(page.url()).pathname;
    await page.goto(`${made}/tickets-orders`);
    await expect(page.getByRole('row').filter({ hasText: 'Kit pass' })).toContainText('0 / 20');

    // Delete it.
    await page.goto(`${ORG}/templates`);
    await page.getByRole('button', { name: `Delete the template ${kit}` }).click();
    await expect(page.getByRole('heading', { name: kit })).toHaveCount(0);
    await page.goto(`/ar${ORG}/templates`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'القوالب', level: 1 })).toBeVisible();
    await expectAccessible(page);
    expect(await noSideScroll(page)).toBe(true);
  });

  test('viewers cannot duplicate or use templates', async ({ page }) => {
    await signIn(page, VIEWER);
    await page.goto(`${ORG}/e/lakeside-open-house/copy`);
    await expect(page.getByText("Copying events isn't part of your role")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Duplicate event' })).toHaveCount(0);
    await expectAccessible(page);
    await page.goto(`${ORG}/templates`);
    await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
    await expect(page.getByText(/^Create an event from/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete the template/ })).toHaveCount(0);
    await page.goto(`/ar${ORG}/e/lakeside-open-house/copy`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });
});
