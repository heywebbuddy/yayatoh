import { expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, expectPicked, pickOption, signIn } from './helpers.ts';
import { createGala, seatBox, seatedGala, unique, waitLive } from './seating-helpers.ts';

const VIEWER = 'jordan@lakeside.test';

/** Mark seats of a row or table accessible in the plan editor's list (autosaved). */
async function markAccessible(page: Page, base: string, item: string, labels: string) {
  await page.goto(`${base}/seating`);
  const field = page.getByLabel(`Accessible seats of ${item}`);
  await field.fill(labels);
  await field.press('Enter');
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
}

/** Offer best available (and, optionally, mark the suggested companion seats) on the organizer page. */
async function offerBestAvailable(page: Page, base: string, { companions = false } = {}) {
  await page.goto(`${base}/seating/best-available`);
  const offer = page.getByLabel('Offer “Best available” to buyers and the box office');
  if (!(await offer.isChecked())) await offer.check();
  await page.getByRole('button', { name: 'Save best available' }).click();
  await expect(page.getByText('Best available settings saved.')).toBeVisible();
  if (companions) {
    await page.getByRole('button', { name: 'Tick the seats next to accessible seats' }).click();
    await page.getByRole('button', { name: 'Save companion seats' }).click();
    await expect(page.getByText(/^Companion seats saved: \d+\.$/)).toBeVisible();
  }
}

async function setRules(page: Page, base: string, r: { adaDays?: string; companion?: string }) {
  await page.goto(`${base}/seating/rules`);
  const ada = page.getByRole('group', { name: 'Accessible seats' });
  if (r.adaDays) {
    await ada.getByLabel('Keep accessible seats for guests who need them').check();
    await ada.getByLabel('Until how many days before the event').fill(r.adaDays);
    await ada.getByRole('radio', { name: 'Enforce' }).check();
  }
  const companion = page.getByRole('group', { name: 'Companion seats' });
  if (r.companion) {
    await companion.getByLabel('Sell companion seats only with an accessible seat').check();
    await companion.getByLabel('Companion seats per accessible seat').fill(r.companion);
    await companion.getByRole('radio', { name: 'Enforce' }).check();
  }
  await page.getByRole('button', { name: 'Save rules' }).click();
}

/** The buyer's details, by keyboard. */
async function buyerDetails(page: Page, who: string) {
  const email = `${who.toLowerCase().replace(/\W+/g, '.')}@example.test`;
  await page.getByLabel('Full name').focus();
  await page.keyboard.type(who);
  await page.getByLabel('Email for your tickets').focus();
  await page.keyboard.type(email);
  return email;
}

const result = (page: Page) => page.getByTestId('best-result');

test.describe('best available and the ADA engine (M6.11a)', () => {
  // Each test builds its own seated event through the UI first.
  test.describe.configure({ timeout: 180_000 });

  test('an organizer offers best available, scores sections, marks companion seats and sets the companion rule; viewers read only', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    // No plan yet: the page says what to do next.
    const bare = await createGala(page, unique('Bare Best Gala'));
    await page.goto(`${bare}/seating/best-available`);
    await expect(
      page.getByText(
        'This event has no seating plan yet. Create one first, then set up best available here.',
      ),
    ).toBeVisible();
    await expectAccessible(page);

    const { base, slug } = await seatedGala(page, unique('Best Setup Gala'), { rows: 4, seatsPerRow: 10 });
    await markAccessible(page, base, 'C', '1, 10');
    await page
      .getByRole('navigation', { name: 'Seating views' })
      .getByRole('link', { name: 'Best available' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Best available and companion seats', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(/^This plan has no sections: seats are ranked by their distance/),
    ).toBeVisible();
    await expectAccessible(page);

    // A plan with sections (as legacy imports bring): each gets a score field.
    expect((await page.request.post(`/api/dev/seating-sections?event=${slug}`)).status()).toBe(200);
    await page.reload();
    const front = page.getByLabel('Score for Front');
    await front.fill('150');
    await page.getByLabel('Offer “Best available” to buyers and the box office').check();
    await page.getByRole('button', { name: 'Save best available' }).click();
    await expect(page.getByText('Enter a whole number from 0 to 100, or leave it blank.')).toBeVisible();
    await expect(front).toHaveAttribute('aria-invalid', 'true');
    await expect(front).toHaveValue('150');
    await expect(
      page.getByRole('alert').filter({ hasText: 'Please fix the highlighted field.' }),
    ).toBeVisible();
    await expectAccessible(page);
    await front.fill('');
    await page.getByLabel('Score for Back').fill('90');
    await page.getByRole('button', { name: 'Save best available' }).click();
    await expect(page.getByText('Best available settings saved.')).toBeVisible();

    // Companion seats: only rows with an accessible seat are listed; the engine suggests neighbours.
    const rowC = page.getByRole('group', { name: 'Row C' });
    await expect(page.getByRole('group', { name: 'Row A' })).toHaveCount(0);
    await expect(rowC.getByText('Seat 1 · accessible')).toBeVisible();
    await page.getByRole('button', { name: 'Tick the seats next to accessible seats' }).click();
    await expect(rowC.getByRole('checkbox', { name: /^Seat 2\b/ })).toBeChecked();
    await expect(rowC.getByRole('checkbox', { name: /^Seat 9\b/ })).toBeChecked();
    // Keyboard: one more, by Space.
    await rowC.getByRole('checkbox', { name: /^Seat 3\b/ }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Save companion seats' }).click();
    await expect(page.getByText('Companion seats saved: 3.')).toBeVisible();
    await expectAccessible(page);

    // It persisted.
    await page.reload();
    await expect(page.getByLabel('Offer “Best available” to buyers and the box office')).toBeChecked();
    await expect(page.getByLabel('Score for Back')).toHaveValue('90');
    await expect(page.getByLabel('Score for Front')).toHaveValue('');
    await expect(rowC.getByRole('checkbox', { name: /^Seat 3\b/ })).toBeChecked();
    await expect(rowC.getByRole('checkbox', { name: /^Seat 4\b/ })).not.toBeChecked();

    // The companion rule, on the Rules tab: a bad number is explained, then it is saved.
    await setRules(page, base, { companion: '5' });
    await expect(page.getByText('Enter a whole number from 1 to 3.')).toBeVisible();
    await expect(page.getByLabel('Companion seats per accessible seat')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await page.getByLabel('Companion seats per accessible seat').fill('1');
    await page.getByRole('button', { name: 'Save rules' }).click();
    await expect(page.getByText('Seating rules saved.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Rules in force' })).toContainText(
      'Companion seats sold only with an accessible seat, up to 1 each · enforced',
    );
    await expectAccessible(page);

    // A viewer reads, never changes; a stale page's save is refused.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/seating/best-available`);
    await expect(viewer.getByText('You can see these settings but not change them.')).toBeVisible();
    await expect(viewer.getByText('Best available is offered to buyers and the box office.')).toBeVisible();
    await expect(viewer.getByText(/^Companion seats \(3\): /)).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Save best available' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Save companion seats' })).toHaveCount(0);
    await expectAccessible(viewer);
    await page.goto(`${base}/seating/best-available`);
    await signIn(page, VIEWER);
    await page.getByRole('button', { name: 'Save companion seats' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'You can see these settings but not change them.' }),
    ).toBeVisible();

    // Arabic, right to left.
    await signIn(page);
    await page.goto(`/ar${base}/seating/best-available`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('heading', { name: 'أفضل المقاعد المتاحة ومقاعد المرافقين', level: 1 }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('a buyer buys 4 best available seats, by keyboard only', async ({ page, browser }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Best Four Gala'), { rows: 3, seatsPerRow: 10 });
    await offerBestAvailable(page, base);

    const buyer = await (await browser.newContext()).newPage();
    await buyer.goto(`/events/${slug}`);
    const best = buyer.getByRole('radio', { name: 'Best available: we find the best seats together' });
    await expect(best).toBeChecked();
    // Nothing found yet: the buyer is told what to do.
    const who = `Bea Best ${Date.now()}`;
    const email = await buyerDetails(buyer, who);
    await buyer.getByRole('button', { name: 'Continue to payment' }).focus();
    await buyer.keyboard.press('Enter');
    await expect(
      buyer.getByText('Find your seats first: choose how many, then press Find seats.'),
    ).toBeVisible();
    // Keyboard: how many, then Find seats.
    await buyer.getByLabel('Number of seats').focus();
    await buyer.keyboard.type('4');
    await expectPicked(buyer.getByLabel('Number of seats'), '4');
    await buyer.keyboard.press('Tab');
    await expect(buyer.getByRole('button', { name: 'Find seats' })).toBeFocused();
    await buyer.keyboard.press('Enter');
    // The best block: the front row (nearest the stage), in the middle.
    await expect(result(buyer)).toContainText('4 seats together:');
    await expect(result(buyer).getByRole('list', { name: 'Your seats' })).toHaveText(
      /Row A · 4\s*Row A · 5\s*Row A · 6\s*Row A · 7/,
    );
    await expect(result(buyer)).toContainText('Held for you for 10 minutes while you check out.');
    await expectAccessible(buyer);
    await continueToPayment(buyer, email);
    await expect(buyer.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();

    // Those seats are held: the organizer's plan says so, and the next buyer gets the next best.
    const next = await (await browser.newContext()).newPage();
    await next.goto(`/events/${slug}`);
    await pickOption(next.getByLabel('Number of seats'), '4');
    await next.getByRole('button', { name: 'Find seats' }).click();
    await expect(result(next).getByRole('list', { name: 'Your seats' })).toHaveText(
      /Row B · 4\s*Row B · 5\s*Row B · 6\s*Row B · 7/,
    );
    // Giving them back frees them.
    await next.getByRole('button', { name: 'Give these seats back' }).click();
    await expect(result(next)).toHaveCount(0);
    // Found again, then choosing by hand instead: that hold is given back too.
    await next.getByRole('button', { name: 'Find seats' }).click();
    await expect(result(next)).toContainText('4 seats together:');
    await next.getByRole('radio', { name: 'Choose my seats' }).check();
    await waitLive(next);
    await expect(seatBox(next, 'Row B · 5')).toBeEnabled();
    await expect(seatBox(next, 'Row A · 5')).toBeDisabled();

    // Arabic, right to left.
    await next.goto(`/ar/events/${slug}`);
    await expect(next.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      next.getByRole('radio', { name: 'أفضل المقاعد المتاحة: نجد لك أفضل المقاعد متجاورة' }),
    ).toBeChecked();
    await expectAccessible(next);
  });

  test('when no block fits, the party is split and told; too many is explained', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Best Split Gala'), { rows: 2, seatsPerRow: 5 });
    await offerBestAvailable(page, base);
    const buyer = await (await browser.newContext()).newPage();
    await buyer.goto(`/events/${slug}`);
    await pickOption(buyer.getByLabel('Number of seats'), '6');
    await buyer.getByRole('button', { name: 'Find seats' }).click();
    await expect(result(buyer)).toContainText(
      "We couldn't seat your party of 6 together, so your seats are in separate places (groups: 2). You can choose your seats instead.",
    );
    await expect(result(buyer).getByRole('listitem')).toHaveCount(6);
    await expectAccessible(buyer);
    await pickOption(buyer.getByLabel('Number of seats'), '11');
    await buyer.getByRole('button', { name: 'Find seats again' }).click();
    await expect(
      buyer.getByText(
        'Not enough free seats at this price for 11. Try fewer seats or another price, or choose your seats.',
      ),
    ).toBeVisible();
    await expectAccessible(buyer);
  });

  test('a wheelchair user gets an accessible seat with a companion seat; enforced rules keep them for those who need them', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Access Gala'), { rows: 2, seatsPerRow: 10 });
    await markAccessible(page, base, 'B', '1, 10');
    await offerBestAvailable(page, base, { companions: true });
    await setRules(page, base, { adaDays: '7', companion: '1' });
    await expect(page.getByText('Seating rules saved.')).toBeVisible();

    const buyer = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await buyer.goto(`/events/${slug}`);
    // Choosing by hand: kept-back seats can't be taken, and a companion seat alone is refused.
    await buyer.getByRole('radio', { name: 'Choose my seats' }).check();
    await waitLive(buyer);
    await expect(
      buyer.getByText(
        /If you need one, tick “Someone in my party uses a wheelchair” and use Best available\.$/,
      ),
    ).toBeVisible();
    await expect(seatBox(buyer, 'Row B · 1')).toBeDisabled();
    await expect(buyer.locator('label').filter({ hasText: 'Row B · 2' })).toContainText('Companion seat');
    await seatBox(buyer, 'Row B · 2').check();
    await expect(
      buyer.getByText(
        'Companion seats without an accessible seat: Row B · 2. They are sold only with an accessible seat (up to 1 each): add one, or choose other seats.',
      ),
    ).toBeVisible();
    await expectAccessible(buyer);
    await seatBox(buyer, 'Row B · 2').uncheck();

    // Best available, for a party with a wheelchair user (keyboard).
    await buyer.getByRole('radio', { name: 'Best available: we find the best seats together' }).check();
    const need = buyer.getByLabel('Someone in my party uses a wheelchair and needs an accessible seat');
    await need.focus();
    await buyer.keyboard.press('Space');
    await expect(need).toBeChecked();
    await expect(
      buyer.getByText("We'll look for a wheelchair-accessible seat with companion seats next to it."),
    ).toBeVisible();
    await pickOption(buyer.getByLabel('Number of seats'), '2');
    await buyer.getByRole('button', { name: 'Find seats' }).click();
    await expect(result(buyer).getByRole('list', { name: 'Your seats' })).toHaveText(
      /Row B · 1 \(wheelchair-accessible\)\s*Row B · 2 \(companion seat\)/,
    );
    await expectAccessible(buyer);
    const email = await buyerDetails(buyer, `Wheel Chair ${Date.now()}`);
    await continueToPayment(buyer, email);
    await expect(buyer.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();

    // Everyone else: never the kept-back seats.
    const other = await (await browser.newContext()).newPage();
    await other.goto(`/events/${slug}`);
    await pickOption(other.getByLabel('Number of seats'), '2');
    await other.getByRole('button', { name: 'Find seats' }).click();
    await expect(result(other).getByRole('list', { name: 'Your seats' })).toHaveText(/Row A · 5\s*Row A · 6/);
    // The other accessible seat goes to the next wheelchair user; then none is left.
    const third = await (await browser.newContext()).newPage();
    await third.goto(`/events/${slug}`);
    await third.getByLabel('Someone in my party uses a wheelchair and needs an accessible seat').check();
    await pickOption(third.getByLabel('Number of seats'), '1');
    await third.getByRole('button', { name: 'Find seats' }).click();
    await expect(result(third).getByRole('list', { name: 'Your seats' })).toHaveText(
      'Row B · 10 (wheelchair-accessible)',
    );
    const fourth = await (await browser.newContext()).newPage();
    await fourth.goto(`/events/${slug}`);
    await fourth.getByLabel('Someone in my party uses a wheelchair and needs an accessible seat').check();
    await fourth.getByRole('button', { name: 'Find seats' }).click();
    await expect(
      fourth.getByText(
        'No wheelchair-accessible seat is free at this price. Try another price, or contact the organizer.',
      ),
    ).toBeVisible();
    await expectAccessible(fourth);
  });

  test('the box office sells best available to a buyer who needs an accessible seat; viewers cannot sell', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base } = await seatedGala(page, unique('Door Access Gala'), { rows: 1, seatsPerRow: 6 });
    await markAccessible(page, base, 'A', '1');
    await offerBestAvailable(page, base, { companions: true });
    await setRules(page, base, { companion: '1' });
    await expect(page.getByText('Seating rules saved.')).toBeVisible();

    await page.goto(`${base}/tickets-orders`);
    const box = page.getByRole('region', { name: 'Box office' });
    await expect(
      box.getByRole('radio', { name: 'Best available: we find the best seats together' }),
    ).toBeChecked();
    const name = `Door Wheel ${Date.now()}`;
    await box.getByLabel("Buyer's name").fill(name);
    await box.getByLabel(/Buyer's email/).fill(`${name.toLowerCase().replace(/\W+/g, '.')}@example.test`);
    // Nothing found: refused, with what to do.
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(
      box.getByText('Find your seats first: choose how many, then press Find seats.'),
    ).toBeVisible();
    await box.getByLabel('The buyer needs a wheelchair-accessible seat').check();
    await pickOption(box.getByLabel('Number of seats'), '2');
    await box.getByRole('button', { name: 'Find seats' }).click();
    await expect(result(page).getByRole('list', { name: 'Your seats' })).toHaveText(
      /Row A · 1 \(wheelchair-accessible\)\s*Row A · 2 \(companion seat\)/,
    );
    await expectAccessible(page);
    await box.getByRole('button', { name: 'Record sale' }).click();
    await expect(box.getByText('Sale recorded with 2 seats. The tickets are on their way.')).toBeVisible();
    await box.getByRole('link', { name: 'Open the order' }).click();
    await expect(
      page.getByRole('table', { name: 'Tickets' }).getByText('Table seat · Row A · 1'),
    ).toBeVisible();

    // Viewers get no box office.
    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/tickets-orders`);
    await expect(viewer.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(viewer.getByRole('region', { name: 'Box office' })).toHaveCount(0);
  });
});
