import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, signIn } from './helpers.ts';
import {
  addTicketType,
  createGala,
  priceAllAndPublish,
  publishEvent,
  quickPlan,
  seatBox,
  unique,
} from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';

/** Two weekly dates (the event's day and a week later). */
async function addTwoDates(page: Page, base: string) {
  await page.goto(`${base}/dates`);
  const repeat = page.getByRole('region', { name: 'Add a repeating schedule' });
  await repeat.getByLabel('Number of dates', { exact: true }).fill('2');
  await repeat.getByRole('button', { name: 'Preview dates' }).click();
  await repeat.getByRole('button', { name: 'Save 2 dates' }).click();
  await expect(repeat.getByText('2 dates added')).toBeVisible();
}

/** A published two-date gala with 2 tables × 4 seats priced as "Table seat" (free). */
async function twoDateGala(page: Page, name: string) {
  const base = await createGala(page, name);
  await addTwoDates(page, base);
  await addTicketType(page, base, 'Table seat', '0', 100);
  await quickPlan(page, base, { tables: 2, seatsPerTable: 4 });
  await priceAllAndPublish(page, base, 'Table seat');
  await publishEvent(page, base);
  return { base, slug: base.split('/').pop() as string };
}

const chartNav = (page: Page) => page.getByRole('navigation', { name: 'Seating chart by date' });
const chartState = (page: Page) => page.getByTestId('date-chart-state');

/** A guest buys one seat for the n-th date (0-based) on the public page; returns their page. */
async function buySeat(browser: Browser, slug: string, nth: number, seat: string, who: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByRole('navigation', { name: 'Choose a date' }).getByRole('link').nth(nth).click();
  await expect(guest).toHaveURL(/\?date=/);
  await seatBox(guest, seat).check();
  await guest.getByLabel('Full name').fill(who);
  const email = `${who.toLowerCase().replace(/\W+/g, '.')}@example.test`;
  await guest.getByLabel('Email for your tickets').fill(email);
  // Guests confirm their email with a code before the order is placed (M1.5f).
  await continueToPayment(guest, email);
  await expect(guest).toHaveURL(/\/orders\//);
  return guest;
}

test.describe('per-date seating charts (M1.7g)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('give date 2 its own chart by keyboard, then sell the same seat on both dates', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await twoDateGala(page, unique('Two Nights'));

    // The plan view lists the event plan and each date; every date uses the plan at first.
    await page.goto(`${base}/seating`);
    const nav = chartNav(page);
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expect(nav.getByRole('link').first()).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link').nth(2)).toContainText('Uses the event plan');
    await expect(page.getByText('You are editing the event plan.', { exact: false })).toBeVisible();
    await expectAccessible(page);

    // Keyboard: focus date 2 and open it, then give it its own chart.
    await nav.getByRole('link').nth(2).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?date=/);
    await expect(chartState(page)).toContainText('This date uses the event plan');
    const give = page.getByRole('button', { name: 'Give this date its own chart' });
    await give.focus();
    await page.keyboard.press('Enter');
    await expect(chartState(page)).toContainText('This date has its own chart');
    await expect(page.getByRole('button', { name: 'Use the event plan for this date' })).toBeVisible();
    await expect(chartNav(page).getByRole('link').nth(2)).toContainText('Own chart');
    // Its copy is on sale with the event plan's prices.
    await expect(page.getByText('On sale', { exact: true })).toBeVisible();
    await expect(page.getByText('8 of 8 seats have a price')).toBeVisible();
    await expectAccessible(page);
    // Persisted.
    await page.reload();
    await expect(chartState(page)).toContainText('This date has its own chart');

    // A buyer takes Table 1 · 1 on date 1 (the event plan); another takes the same seat on date 2.
    const one = `Night One ${Date.now()}`;
    const two = `Night Two ${Date.now()}`;
    const first = await buySeat(browser, slug, 0, 'Table 1 · 1', one);
    await expect(first.getByText('Seat: Table 1 · 1').first()).toBeVisible();
    const second = await buySeat(browser, slug, 1, 'Table 1 · 1', two);
    await expect(second.getByText('Seat: Table 1 · 1').first()).toBeVisible();

    // Taken on both dates now; a neighbour is still free on each.
    const guest = await (await browser.newContext()).newPage();
    for (const nth of [0, 1]) {
      await guest.goto(`/events/${slug}`);
      await guest.getByRole('navigation', { name: 'Choose a date' }).getByRole('link').nth(nth).click();
      await expect(seatBox(guest, 'Table 1 · 1')).toBeDisabled();
      await expect(seatBox(guest, 'Table 1 · 2')).toBeEnabled();
    }

    // The attendee list shows each buyer's seat for their own date.
    const url = page.url();
    await page.goto(`${base}/attendees`);
    await expect(page.getByRole('row').filter({ hasText: one })).toContainText('Table 1 · 1');
    await expect(page.getByRole('row').filter({ hasText: two })).toContainText('Table 1 · 1');
    await page.goto(url);

    // Date 2's chart is locked now: going back to the event plan is refused, with the reason.
    await page.reload();
    await expect(page.getByText('Locked — seats have been sold', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Use the event plan for this date' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Seats have been sold on this chart' }),
    ).toBeVisible();
    await expect(chartState(page)).toContainText('This date has its own chart');

    // Arabic, right to left.
    await page.goto(`/ar${base}/seating${new URL(page.url()).search}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('navigation', { name: 'مخطط المقاعد حسب التاريخ' })).toBeVisible();
    await expect(page.getByTestId('date-chart-state')).toContainText('لهذا التاريخ مخطط خاص');
    await expectAccessible(page);
  });

  test('a date back on the event plan; the box office and guest seating follow the chosen date', async ({
    page,
  }) => {
    await signIn(page);
    const { base } = await twoDateGala(page, unique('Run Box'));
    await page.goto(`${base}/seating`);
    // Date 2 gets its own chart, then goes back to the event plan (nothing sold on it yet).
    await chartNav(page).getByRole('link').nth(2).click();
    await expect(chartNav(page).getByRole('link').nth(2)).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Give this date its own chart' }).click();
    await expect(chartState(page)).toContainText('This date has its own chart');
    await page.getByRole('button', { name: 'Use the event plan for this date' }).click();
    await expect(chartState(page)).toContainText('This date uses the event plan');
    await expect(chartNav(page).getByRole('link').nth(2)).toContainText('Uses the event plan');
    await chartNav(page).getByRole('link').nth(1).click();
    await expect(chartNav(page).getByRole('link').nth(1)).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Give this date its own chart' }).click();
    await expect(chartState(page)).toContainText('This date has its own chart');

    // The box office sells date 1's own seats once that date is chosen.
    await page.goto(`${base}/tickets-orders`);
    const box = page.getByRole('region', { name: 'Box office' });
    const dates = page.getByRole('navigation', { name: 'Seats for date' });
    await expect(dates).toBeVisible();
    await dates.getByRole('link').nth(1).click();
    await expect(dates.getByRole('link').nth(1)).toHaveAttribute('aria-current', 'page');
    await seatBox(page, 'Table 2 · 4').check();
    await box.getByLabel("Buyer's name").fill(`Door ${Date.now()}`);
    await box.getByLabel(/Buyer's email/).fill(`door.${Date.now()}@example.test`);
    await box.getByLabel('Paid by').selectOption('cash');
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText(/^Sale recorded with 1 seat/)).toBeVisible();
    await expect(seatBox(page, 'Table 2 · 4')).toBeDisabled();
    // On the event plan (date 2) the seat is still free.
    await dates.getByRole('link').first().click();
    await expect(dates.getByRole('link').first()).toHaveAttribute('aria-current', 'page');
    await expect(seatBox(page, 'Table 2 · 4')).toBeEnabled();
    await expectAccessible(page);

    // The guest-seating view follows the date too.
    await page.goto(`${base}/seating/assign`);
    await expect(chartNav(page)).toBeVisible();
    await chartNav(page).getByRole('link').nth(1).click();
    await expect(page.getByRole('link', { name: 'Assign guests' })).toHaveAttribute('href', /\?date=/);
    await expectAccessible(page);
  });

  test('a viewer sees the charts but has no controls, and a stale page’s change is refused', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base } = await twoDateGala(page, unique('Viewer Nights'));
    await page.goto(`${base}/seating`);
    await chartNav(page).getByRole('link').nth(1).click();
    await expect(page.getByRole('button', { name: 'Give this date its own chart' })).toBeVisible();
    const url = page.url();

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(url);
    await expect(chartState(viewer)).toContainText('This date uses the event plan');
    await expect(viewer.getByRole('button', { name: 'Give this date its own chart' })).toHaveCount(0);
    await expect(
      viewer.getByRole('region', { name: 'Floor plan image' }).getByLabel('Floor plan image'),
    ).toHaveCount(0);
    await expectAccessible(viewer);

    // The owner's page, now signed in as the viewer: the server refuses.
    await signIn(page, VIEWER);
    await page.getByRole('button', { name: 'Give this date its own chart' }).click();
    await expect(page.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
    await signIn(page);
    await page.goto(url);
    await expect(chartState(page)).toContainText('This date uses the event plan');
  });
});
