import { expect, type Page, test } from '@playwright/test';

/** A unique name per test and viewport project (projects run in parallel on one database). */
export const unique = (what: string) => `${what} ${Date.now()} ${test.info().project.name.split('-')[0]}`;

/** A new event (a gala: its profile shows Seating) as the signed-in Lakeside owner; its console path. */
export async function createGala(
  page: Page,
  name: string,
  { starts = '2027-12-04T18:00', ends = '2027-12-04T23:00' }: { starts?: string; ends?: string } = {},
) {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption('gala');
  await page.getByLabel('Starts', { exact: true }).fill(starts);
  await page.getByLabel('Ends', { exact: true }).fill(ends);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

/** Publish the event (from its overview page). */
export async function publishEvent(page: Page, base: string) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
}

export async function addTicketType(page: Page, base: string, name: string, price: string, quantity = 50) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill(price);
  await page.getByLabel('Quantity available').fill(String(quantity));
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

/** A plan from numbers (rows of seats and/or round tables). */
export async function quickPlan(
  page: Page,
  base: string,
  p: { rows?: number; seatsPerRow?: number; tables?: number; seatsPerTable?: number; stage?: boolean },
) {
  await page.goto(`${base}/seating`);
  await page.getByLabel('Rows').fill(String(p.rows ?? 0));
  await page.getByLabel('Seats per row').fill(String(p.seatsPerRow ?? 1));
  await page.getByLabel('Round tables').fill(String(p.tables ?? 0));
  await page.getByLabel('Seats per table').fill(String(p.seatsPerTable ?? 8));
  if (p.stage === false) await page.getByLabel('Add a stage at the front').uncheck();
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('application', { name: 'Seating plan' })).toBeVisible();
}

/** Price every row and table as one ticket type, then put the seats on sale. */
export async function priceAllAndPublish(page: Page, base: string, ticketType: string) {
  await page.goto(`${base}/seating`);
  const prices = page.getByRole('region', { name: 'Prices' });
  const boxes = prices.getByRole('checkbox');
  await expect(boxes.first()).toBeVisible();
  // Many rows (the 5,000-seat plan): tick them all at once.
  await boxes.evaluateAll((els) => {
    for (const el of els) if (!(el as HTMLInputElement).checked) (el as HTMLInputElement).click();
  });
  await prices.getByLabel('Sells as').selectOption({ label: ticketType });
  await prices.getByRole('button', { name: 'Set price' }).click();
  await expect(prices.getByText('Prices updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Put seats on sale' }).click();
  await expect(page.getByText('On sale', { exact: true })).toBeVisible();
}

/**
 * A published gala with a plan on sale: `tables` round tables of `seatsPerTable` (and optional
 * rows), every seat priced as "Table seat" ($50). Returns the console path and public slug.
 */
export async function seatedGala(
  page: Page,
  name: string,
  plan: { rows?: number; seatsPerRow?: number; tables?: number; seatsPerTable?: number } = {
    tables: 2,
    seatsPerTable: 4,
  },
) {
  const base = await createGala(page, name);
  await addTicketType(page, base, 'Table seat', '50', 5_000);
  await quickPlan(page, base, plan);
  await priceAllAndPublish(page, base, 'Table seat');
  await publishEvent(page, base);
  return { base, slug: base.split('/').pop() as string };
}

export async function addGuests(page: Page, base: string, names: readonly string[]) {
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

/** The seat checkbox for a label in the buyer's (or box office's) seat list. */
export const seatBox = (page: Page, label: string) =>
  page.getByRole('checkbox', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(`) });

/** Wait until a seat list follows its live stream. */
export async function waitLive(page: Page) {
  await expect(page.locator('section[data-live]').first()).toHaveAttribute('data-live', 'live', {
    timeout: 15_000,
  });
}

/** Start checkout for seats (they are held while the buyer pays). */
export async function holdSeats(page: Page, slug: string, labels: readonly string[], who: string) {
  await page.goto(`/events/${slug}`);
  for (const l of labels) await seatBox(page, l).check();
  await page.getByLabel('Full name').fill(who);
  await page
    .getByLabel('Email for your tickets')
    .fill(`${who.toLowerCase().replace(/\W+/g, '.')}@example.test`);
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
}
