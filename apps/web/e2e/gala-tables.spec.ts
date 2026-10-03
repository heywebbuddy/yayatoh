import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  continueToPayment,
  expectAccessible,
  expectAccessibleBothModes,
  signIn,
  WEDDING,
  WEDDING_OWNER,
} from './helpers.ts';
import { addGuests, createGala, publishEvent, quickPlan, unique } from './seating-helpers.ts';

/**
 * M4.2b gala tables and sponsors: a host sells a "Table of 4"; the buyer pays (fake provider) and
 * names their guests through the table's claim link; the guests show on Guests, in seating and on
 * Tables & Sponsors, where the host names the rest by hand and sends reminders. Hosted tables carry
 * a sponsor: the editor always shows it, the seat finder only once it is shown to guests.
 */
const VIEWER = 'jordan@lakeside.test';
const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;

/** Tickets & Orders: a table ticket (price per table, `size` seats). */
async function addTableTicket(page: Page, base: string, name: string, price: string, size: number) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill(price);
  await page.getByLabel('Quantity available').fill('10');
  await page.getByLabel('Seats per table').fill(String(size));
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`Table of ${size}`);
}

/** A buyer (own browser) buys one table through checkout and the fake provider; returns their page on the order. */
async function buyTable(browser: Browser, slug: string, ticket: string, buyer: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await expect(
    guest.getByText('Seats 4 guests. After paying, you name them with your table’s link.'),
  ).toBeVisible();
  await guest.getByLabel(`Quantity — ${ticket}`).selectOption('1');
  await guest.getByLabel('Full name').fill(buyer);
  await guest.getByLabel('Email for your tickets').fill(emailOf(buyer));
  await continueToPayment(guest, emailOf(buyer));
  await expect(guest.getByRole('heading', { name: 'Pay for your order' })).toBeVisible();
  await guest.getByRole('button', { name: 'Pay now (test)' }).click();
  await expect(guest).toHaveURL(/\/orders\//);
  await expect(guest.getByText('Paid', { exact: true })).toBeVisible();
  return guest;
}

const nameForm = (page: Page) => ({
  first: page.getByLabel('First name'),
  last: page.getByLabel('Last name (optional)'),
  email: page.getByLabel('Email for their ticket (optional)'),
});

test.describe('gala tables and sponsors (M4.2b)', () => {
  test('buy a table, name guests through its link, see them on Guests and Tables & Sponsors', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const name = unique('Table Gala');
    const ticket = `Table of 4 ${test.info().project.name.split('-')[0]}`;
    const buyer = `Chair ${name}`;
    await signIn(page);
    const base = await createGala(page, name);
    // Tables & Sponsors before anything is sold: what to do next.
    await page.goto(`${base}/tables-sponsors`);
    await expect(page.getByRole('heading', { name: 'Tables & Sponsors', level: 1 })).toBeVisible();
    await expect(page.getByText('No tables sold yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add a table ticket on Tickets & Orders' })).toBeVisible();
    await expect(page.getByText('No floor plan yet')).toBeVisible();
    await expectAccessibleBothModes(page);
    // The table ticket: a size out of range is refused, 4 is fine.
    await page.goto(`${base}/tickets-orders`);
    await page.getByLabel('Name', { exact: true }).fill('Too big');
    await page.getByLabel('Price (USD)').fill('100');
    await page.getByLabel('Quantity available').fill('5');
    await page.getByLabel('Seats per table').fill('30');
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Too big' })).toHaveCount(0);
    await addTableTicket(page, base, ticket, '400', 4);
    await publishEvent(page, base);
    const slug = base.split('/').pop() as string;

    const guest = await buyTable(browser, slug, ticket, buyer);
    const tables = guest.getByRole('region', { name: 'Your tables' });
    await expect(tables).toContainText('0 of 4 seats named');
    await expectAccessible(guest);
    await tables.getByRole('link', { name: `Name guests at ${ticket} #1` }).click();
    await expect(guest).toHaveURL(/\/tables\/[0-9a-f-]{36}~/);
    const link = guest.url();
    await expect(guest.getByRole('heading', { name: 'Name your guests', level: 1 })).toBeVisible();
    await expect(guest.getByText('4 names missing')).toBeVisible();
    await expectAccessibleBothModes(guest);

    // Inline validation: a first name is required; a malformed email is refused.
    const f = nameForm(guest);
    await guest.getByRole('button', { name: 'Add guest' }).click();
    await expect(guest.getByText('Enter the guest’s first name.')).toBeVisible();
    await expect(f.first).toHaveAttribute('aria-invalid', 'true');
    await f.first.fill('Ada');
    await f.email.fill('not-an-email');
    await guest.getByRole('button', { name: 'Add guest' }).click();
    await expect(guest.getByText('Enter a valid email address, or leave it empty.')).toBeVisible();

    // The company (the party), then a guest with their own ticket.
    await guest.getByLabel('Company or sponsor name').fill(`Acme ${name}`);
    await guest.getByRole('button', { name: 'Save name' }).click();
    await expect(guest.getByText('Name saved.')).toBeVisible();
    await f.first.fill('Ada');
    await f.last.fill(`Lovelace ${name}`);
    await f.email.fill(emailOf(`ada ${name}`));
    await guest.getByRole('button', { name: 'Add guest' }).click();
    await expect(guest.getByText(`Ada Lovelace ${name} has a seat at the table.`)).toBeVisible();
    const seats = guest.getByRole('region', { name: 'Seats' });
    await expect(seats.getByText(`Ada Lovelace ${name}`)).toBeVisible();
    await expect(guest.getByText('3 names missing')).toBeVisible();

    // Keyboard only: a second guest, typed and sent with Enter.
    await f.first.focus();
    await guest.keyboard.type('Grace');
    await guest.keyboard.press('Tab');
    await expect(f.last).toBeFocused();
    await guest.keyboard.type(`Hopper ${name}`);
    await guest.keyboard.press('Enter');
    await expect(guest.getByText(`Grace Hopper ${name} has a seat at the table.`)).toBeVisible();

    // Persisted: the link shows both after a reload; resending the link is throttled.
    await guest.reload();
    await expect(seats.getByText(`Ada Lovelace ${name}`)).toBeVisible();
    await expect(seats.getByText(`Grace Hopper ${name}`)).toBeVisible();
    await expect(guest.getByText('2 of 4 seats named')).toBeVisible();
    await expect(guest.getByLabel('Company or sponsor name')).toHaveValue(`Acme ${name}`);
    await guest.getByRole('button', { name: 'Email me this link' }).click();
    await expect(
      guest.getByText(/^(We sent the link to your email\.|We just sent it\. Try again in a minute\.)$/),
    ).toBeVisible();
    await expectAccessibleBothModes(guest);

    // A forged link is a 404.
    const forged = await guest.goto(link.replace(/~.*$/, '~forged'));
    expect(forged?.status()).toBe(404);

    // The host: the guests are on Guests (the gala's word for attendees) with their names.
    await page.goto(`${base}/attendees`);
    await expect(page.getByRole('row').filter({ hasText: `Ada Lovelace ${name}` })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `Grace Hopper ${name}` })).toBeVisible();

    // Tables & Sponsors: the table, its party, 2 named, 2 missing; each seat shows its ticket.
    await page.goto(`${base}/tables-sponsors`);
    const row = page.getByRole('row').filter({ hasText: `${ticket} #1` });
    await expect(row).toContainText(`Acme ${name}`);
    await expect(row).toContainText(buyer);
    await expect(row).toContainText('2 names missing');
    const card = page.getByRole('list', { name: `Seats at ${ticket} #1 · Acme ${name}` });
    await expect(card.getByText(`Ada Lovelace ${name}`)).toBeVisible();
    await expect(card.getByText(/^Ticket [A-Z0-9]+$/)).toHaveCount(4);
    await expect(card.getByText('Not named yet')).toHaveCount(2);
    await expectAccessibleBothModes(page);

    // The host names a guest by hand (keyboard: open the disclosure, fill, Enter).
    const disclosure = page.getByText(`Name a guest at ${ticket} #1 · Acme ${name}`);
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('First name').fill('Hedy');
    await page.getByLabel('Last name (optional)').fill(`Lamarr ${name}`);
    await page.getByLabel('Last name (optional)').press('Enter');
    await expect(page.getByText(`Hedy Lamarr ${name} has a seat at the table.`)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: `${ticket} #1` })).toContainText('1 name missing');

    // Naming reminders: sent once, then skipped within the hour.
    await page.getByRole('button', { name: 'Send naming reminders' }).click();
    await expect(page.getByText('Reminder sent to 1 buyer.')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Send naming reminders' }).click();
    await expect(
      page.getByText('No reminders sent. 1 table skipped (complete, closed or just reminded).'),
    ).toBeVisible();

    // In seating: the named guests are there to seat.
    await quickPlan(page, base, { tables: 1, seatsPerTable: 4 });
    await page.goto(`${base}/seating/assign`);
    await expect(page.getByRole('checkbox', { name: `Ada Lovelace ${name}` })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `Hedy Lamarr ${name}` })).toBeVisible();
    await guest.context().close();
  });

  test('hosted table sponsors show in the editor, and in the seat finder only once shown to guests', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const name = unique('Sponsor Gala');
    const shown = `Shown ${name}`;
    const quiet = `Quiet ${name}`;
    await signIn(page);
    const base = await createGala(page, name);
    await publishEvent(page, base);
    const slug = base.split('/').pop() as string;
    await quickPlan(page, base, { tables: 2, seatsPerTable: 4, stage: false });
    await addGuests(page, base, [shown, quiet]);

    await page.goto(`${base}/tables-sponsors`);
    const t1 = page.getByRole('form', { name: 'Sponsor of Table 1' });
    // Inline validation: a sponsor needs a name.
    await t1.getByRole('button', { name: 'Save sponsor' }).click();
    await expect(t1.getByText('Enter the sponsor’s name.')).toBeVisible();
    await t1.getByLabel('Sponsor name').fill('Acme Corp');
    await t1.getByLabel('Show the sponsor to guests').check();
    await t1.getByRole('button', { name: 'Save sponsor' }).click();
    await expect(t1.getByText('Sponsor saved for Table 1.')).toBeVisible();
    const t2 = page.getByRole('form', { name: 'Sponsor of Table 2' });
    // Keyboard only: type the name, Enter (not shown to guests).
    await t2.getByLabel('Sponsor name').focus();
    await page.keyboard.type('Secret Sponsor');
    await page.keyboard.press('Enter');
    await expect(t2.getByText('Sponsor saved for Table 2.')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-plan-table="Table 1"]')).toContainText('Sponsored by Acme Corp');
    await expect(page.locator('[data-plan-table="Table 1"]')).toContainText('Shown to guests');
    await expect(page.locator('[data-plan-table="Table 2"]')).toContainText('Hidden from guests');
    await expectAccessibleBothModes(page);

    // The seating editor shows both sponsors on their tables (the list beside the plan).
    await page.goto(`${base}/seating`);
    await expect(page.getByText('Sponsor: Acme Corp')).toBeVisible();
    await expect(page.getByText('Sponsor: Secret Sponsor')).toBeVisible();

    // Seat a guest at each table, put the plan on sale and open the finder by name.
    for (const [who, table] of [
      [shown, 'Table 1'],
      [quiet, 'Table 2'],
    ] as const) {
      await page.goto(`${base}/seating/assign`);
      await page.getByRole('checkbox', { name: who }).check();
      const item = page.getByLabel('Table or row');
      const option = item.locator('option', { hasText: new RegExp(`^${table} — `) });
      await item.selectOption({ label: (await option.textContent()) ?? '' });
      await page.getByRole('button', { name: 'Seat them' }).click();
      await expect(page.getByRole('region', { name: table, exact: true })).toContainText(who);
    }
    await page.goto(`${base}/seating/finder`);
    await page.getByLabel('Show guests the venue map and seat finder').check();
    await page.getByLabel('Instantly, by full name').check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Seat finder settings saved.')).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    const look = async (who: string) => {
      await guest.goto(`/events/${slug}/seat-finder`);
      await guest.getByLabel('Full name').fill(who);
      await guest.getByRole('button', { name: 'Find my seat' }).click();
      await expect(guest.getByRole('region', { name: 'Your seat', exact: true })).toBeVisible();
    };
    // A draft plan (not on sale): no sponsor is shown yet.
    await look(shown);
    await expect(guest.getByText('Hosted by Acme Corp')).toHaveCount(0);
    await page.goto(`${base}/seating`);
    await page.getByRole('button', { name: 'Put seats on sale' }).click();
    await expect(page.getByText('On sale', { exact: true })).toBeVisible();
    await look(shown);
    await expect(guest.getByText('Hosted by Acme Corp')).toBeVisible();
    await expectAccessible(guest);
    await look(quiet);
    await expect(guest.getByText(/Hosted by/)).toHaveCount(0);
    await expect(guest.getByText('Secret Sponsor')).toHaveCount(0);
    await guest.context().close();
  });

  test('a viewer reads Tables & Sponsors without its controls; a wedding has no such page', async ({
    page,
  }) => {
    const name = unique('Viewer Gala');
    await signIn(page);
    const base = await createGala(page, name);
    await quickPlan(page, base, { tables: 1, seatsPerTable: 4, stage: false });
    await signIn(page, VIEWER);
    await page.goto(`${base}/tables-sponsors`);
    await expect(page.getByRole('heading', { name: 'Tables & Sponsors', level: 1 })).toBeVisible();
    await expect(page.locator('[data-plan-table="Table 1"]')).toContainText('No sponsor yet');
    await expect(page.getByRole('button', { name: 'Save sponsor' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send naming reminders' })).toHaveCount(0);
    // Batch 3h: the read-only notice says why.
    await expect(page.getByText('You can see the tables and sponsors.', { exact: false })).toBeVisible();
    await expectAccessibleBothModes(page);
    // A wedding's profile has no Tables & Sponsors: its URL is a 404.
    await signIn(page, WEDDING_OWNER);
    const res = await page.goto(`${WEDDING}/tables-sponsors`);
    expect(res?.status()).toBe(404);
  });

  test('Arabic (RTL): Tables & Sponsors and the naming link', async ({ page, browser }) => {
    test.setTimeout(150_000);
    const name = unique('Rtl Gala');
    const ticket = `Table of 4 ${test.info().project.name.split('-')[0]}`;
    await signIn(page);
    const base = await createGala(page, name);
    await addTableTicket(page, base, ticket, '400', 4);
    await publishEvent(page, base);
    await page.goto(`/ar${base}/tables-sponsors`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('لم تُبع أي طاولة بعد')).toBeVisible();
    await expectAccessibleBothModes(page);
    const guest = await buyTable(browser, base.split('/').pop() as string, ticket, `Rtl ${name}`);
    const href = await guest
      .getByRole('region', { name: 'Your tables' })
      .getByRole('link')
      .first()
      .getAttribute('href');
    await guest.goto(`/ar${href}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: 'أدخل أسماء ضيوفك', level: 1 })).toBeVisible();
    await guest.getByLabel('الاسم الأول').fill('ليلى');
    await guest.getByRole('button', { name: 'إضافة الضيف' }).click();
    await expect(guest.getByText('أصبح لـ ليلى مقعد على الطاولة.')).toBeVisible();
    await expectAccessibleBothModes(guest);
    await guest.context().close();
  });
});
