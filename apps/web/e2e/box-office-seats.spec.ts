import { expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';
import { holdSeats, seatBox, seatedGala, unique, waitLive } from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';

const boxOffice = (page: Page) => page.getByRole('region', { name: 'Box office' });

async function buyer(page: Page, name: string) {
  const box = boxOffice(page);
  await box.getByLabel("Buyer's name").fill(name);
  await box.getByLabel(/Buyer's email/).fill(`${name.toLowerCase().replace(/\W+/g, '.')}@example.test`);
}

test.describe('box office seat choice (M1.7f)', () => {
  // Each test builds its own seated event through the UI first.
  test.describe.configure({ timeout: 120_000 });

  test('an organizer sells a chosen seat at the door; the ticket names it and the seat is taken', async ({
    page,
  }) => {
    await signIn(page);
    const { base } = await seatedGala(page, unique('Door Gala'));
    await page.goto(`${base}/tickets-orders`);
    const box = boxOffice(page);
    // Seated passes are sold by choosing seats (no quantity box), with the same list and map.
    await expect(box.getByText(/^Table seat · .*: choose seats below$/)).toBeVisible();
    await expect(box.getByRole('spinbutton', { name: /^Table seat/ })).toHaveCount(0);
    await expect(box.getByRole('heading', { name: 'Choose your seats' })).toBeVisible();
    await waitLive(page);
    // Nothing chosen: refused, and what was typed stays.
    const name = `Walk Up ${Date.now()}`;
    await buyer(page, name);
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Choose at least one ticket.')).toBeVisible();
    await expect(box.getByLabel("Buyer's name")).toHaveValue(name);
    // Keyboard: tick a seat with Space.
    await seatBox(page, 'Table 1 · 2').focus();
    await page.keyboard.press('Space');
    await expect(box.getByRole('status').filter({ hasText: '1 seat selected' })).toBeVisible();
    await box.getByLabel('Paid by').selectOption('cash');
    await expectAccessible(page);
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Sale recorded with 1 seat. The tickets are on their way.')).toBeVisible();
    // The seat is taken at once, and the choice starts afresh.
    await expect(seatBox(page, 'Table 1 · 2')).toBeDisabled();
    await expect(box.getByRole('status').filter({ hasText: 'No seats selected' })).toBeVisible();
    await box.getByRole('link', { name: 'Open the order' }).click();
    await expect(page.getByRole('heading', { name: `Order from ${name}` })).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Tickets' }).getByText('Table seat · Table 1 · 2'),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('a seat taken meanwhile: the live list drops it, and a stale choice is refused with nothing sold', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Race Gala'));
    // Two box office screens: one follows the live stream, one has lost it (a stale page).
    const live = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await signIn(live);
    await live.goto(`${base}/tickets-orders`);
    await waitLive(live);
    await page.route('**/seating/stream', (r) => r.abort());
    await page.goto(`${base}/tickets-orders`);
    for (const p of [page, live]) {
      await seatBox(p, 'Table 2 · 2').check();
      await seatBox(p, 'Table 2 · 3').check();
    }
    await buyer(page, `Stale Door ${Date.now()}`);
    // A buyer online takes one of them.
    const online = await (await browser.newContext()).newPage();
    await holdSeats(online, slug, ['Table 2 · 2'], `Olive Online ${Date.now()}`);
    // The live screen drops it and says so.
    await expect(seatBox(live, 'Table 2 · 2')).toBeDisabled();
    await expect(live.getByTestId('seat-notice')).toHaveText(
      'Seat Table 2 · 2 was just taken by someone else and is no longer in your choice.',
    );
    // The stale screen still offers it; the sale is refused as a whole and the buyer kept.
    await boxOffice(page).getByRole('button', { name: 'Record sale' }).click();
    await expect(
      boxOffice(page)
        .getByRole('alert')
        .filter({ hasText: 'Some of those seats were just taken. Please choose others.' }),
    ).toBeVisible();
    await expect(boxOffice(page).getByLabel("Buyer's name")).toHaveValue(/^Stale Door/);
    await expect(seatBox(page, 'Table 2 · 2')).toBeDisabled();
    // Nothing was sold: the other seat is still free everywhere.
    await expect(seatBox(live, 'Table 2 · 3')).toBeEnabled();
    await expectAccessible(page);
  });

  test('an enforced seating rule needs the override, which is then sold and recorded', async ({ page }) => {
    await signIn(page);
    const { base } = await seatedGala(page, unique('Rule Door Gala'));
    await page.goto(`${base}/seating/rules`);
    await page.getByLabel('Limit the seats in one order').check();
    await page.getByLabel('At most', { exact: true }).fill('1');
    await page.getByRole('radio', { name: 'Enforce' }).last().check();
    await page.getByRole('button', { name: 'Save rules' }).click();
    await expect(page.getByText('Seating rules saved.')).toBeVisible();

    await page.goto(`${base}/tickets-orders`);
    const box = boxOffice(page);
    await expect(box.getByText('Up to 1 seats per order.')).toBeVisible();
    await seatBox(page, 'Table 1 · 3').check();
    await seatBox(page, 'Table 1 · 4').check();
    // Staff may choose more, but see why it goes against the rules.
    await expect(box.getByText('2 seats chosen: the organizer asks for at most 1 per order.')).toBeVisible();
    await expect(
      box.getByText("This choice goes against the organizer's seating rules (see above)."),
    ).toBeVisible();
    await buyer(page, `Group Door ${Date.now()}`);
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(
      box.getByRole('alert').filter({ hasText: 'Tick the box to sell anyway, or change the seats.' }),
    ).toBeVisible();
    await expectAccessible(page);
    await box.getByLabel(/^Sell anyway/).check();
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Sale recorded with 2 seats. The tickets are on their way.')).toBeVisible();
    await expect(seatBox(page, 'Table 1 · 3')).toBeDisabled();
  });

  test('viewers have no box office, and a stale page’s sale is refused', async ({ page, browser }) => {
    await signIn(page);
    const { base } = await seatedGala(page, unique('Viewer Door Gala'));
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/tickets-orders`);
    await expect(viewer.locator('h1').first()).toBeVisible();
    await expect(boxOffice(viewer)).toHaveCount(0);
    // The owner's open page, now signed in as the viewer: the server refuses the sale.
    await page.goto(`${base}/tickets-orders`);
    await seatBox(page, 'Table 1 · 1').check();
    await buyer(page, `Nope Door ${Date.now()}`);
    await signIn(page, VIEWER);
    await boxOffice(page).getByRole('button', { name: 'Record sale' }).click();
    await expect(boxOffice(page).getByRole('alert')).toHaveText("You don't have access to this.");
  });

  test('renders right to left in Arabic', async ({ page }) => {
    await signIn(page);
    const { base } = await seatedGala(page, unique('RTL Door Gala'));
    await page.goto(`/ar${base}/tickets-orders`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const box = page.getByRole('region', { name: 'شباك التذاكر' });
    await expect(box.getByRole('heading', { name: 'اختر مقاعدك' })).toBeVisible();
    await expect(box.getByText(/اختر المقاعد أدناه/)).toBeVisible();
    await expectAccessible(page);
  });
});
