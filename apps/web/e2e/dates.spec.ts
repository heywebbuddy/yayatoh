import { type Browser, expect, type Page, test } from '@playwright/test';
import { continueToPayment, expectAccessible, pickOption, signIn } from './helpers.ts';

/**
 * M1.4b: multi-date events — recurring schedules (preview, validation, DST), editing one date or
 * this and following, cancelling with its impact, buyers picking a date, per-date check-in.
 */

const TZ = 'America/Chicago';
const VIEWER = 'jordan@lakeside.test';
const tagOf = () => `${test.info().project.name.replace(/[^a-z0-9]/g, '')}${Date.now()}`;

/** The console's date label (same Intl options as the Dates page). */
const consoleLabel = (startLocal: string, endLocal: string) =>
  new Intl.DateTimeFormat('en', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatRange(chicagoInstant(startLocal), chicagoInstant(endLocal));

/** A Chicago wall-clock `YYYY-MM-DDTHH:mm` as an instant (test data avoids DST gaps). */
function chicagoInstant(local: string): Date {
  const guess = new Date(`${local}:00Z`);
  const offset = (d: Date) => {
    const p: Record<string, string> = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
    const n = (k: string) => Number(p[k]);
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - d.getTime();
  };
  return new Date(guess.getTime() - offset(new Date(guess.getTime() - offset(guess))));
}

/** `YYYY-MM-DDTHH:mm` wall-clock time in Chicago, `offsetH` hours from now. */
function chicagoFromNow(offsetH: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(Date.now() + offsetH * 3_600_000))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

async function createEvent(page: Page, name: string, starts: string, ends: string): Promise<string> {
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await pickOption(page.getByLabel('Time zone'), TZ);
  await page.getByLabel('Starts', { exact: true }).fill(starts);
  await page.getByLabel('Ends', { exact: true }).fill(ends);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  return new URL(page.url()).pathname;
}

async function addWeekly(page: Page, base: string, count: number) {
  await page.goto(`${base}/dates`);
  const repeat = page.getByRole('region', { name: 'Add a repeating schedule' });
  await repeat.getByLabel('Number of dates', { exact: true }).fill(String(count));
  await repeat.getByRole('button', { name: 'Preview dates' }).click();
  await repeat.getByRole('button', { name: `Save ${count} dates` }).click();
  await expect(repeat.getByText(`${count} dates added`)).toBeVisible();
}

async function addTicketType(page: Page, base: string, name: string) {
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('50');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}

async function publish(page: Page, base: string) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
}

/** A guest buys one free ticket for a date on the public page; returns the order page. */
async function buyForDate(browser: Browser, slug: string, dateLabel: string, pass: string, who: string) {
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/events/${slug}`);
  await guest.getByRole('link', { name: dateLabel }).click();
  await expect(guest).toHaveURL(/\?date=/);
  await pickOption(guest.getByLabel(`Quantity — ${pass}`), '1');
  await guest.getByLabel('Full name').fill(who);
  await guest
    .getByLabel('Email for your tickets')
    .fill(`${who.replace(/\W/g, '').toLowerCase()}@example.test`);
  await continueToPayment(guest, `${who.replace(/\W/g, '').toLowerCase()}@example.test`);
  await expect(guest).toHaveURL(/\/orders\//);
  return guest;
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe('multi-date events', () => {
  test('a weekly schedule: validation errors, a DST-proof preview, save and reload', async ({ page }) => {
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Weekly Jazz ${tag}`, '2027-03-03T19:00', '2027-03-03T22:00');
    await page.goto(`${base}/dates`);
    await expect(page.getByText('This event has a single date')).toBeVisible();
    await expectAccessible(page);
    expect(await noSideScroll(page)).toBe(true);

    const repeat = page.getByRole('region', { name: 'Add a repeating schedule' });
    // The form starts from the event: first date, times and weekday.
    await expect(repeat.getByLabel('First date')).toHaveAttribute('data-value', '2027-03-03');
    await expect(repeat.getByLabel('Start time')).toHaveAttribute('data-value', '19:00');
    await expect(repeat.getByLabel('Wednesday')).toBeChecked();

    await repeat.getByLabel('On a date').check();
    await repeat.getByRole('button', { name: 'Preview dates' }).click();
    await expect(repeat.getByText('Choose an end: a last date or a number of dates.')).toBeVisible();
    await repeat.getByLabel('Last date').fill('2027-01-01');
    await repeat.getByRole('button', { name: 'Preview dates' }).click();
    await expect(repeat.getByText('The last date is before the first date.')).toBeVisible();
    await expectAccessible(page);
    await repeat.getByLabel('After a number of dates').check();
    await repeat.getByLabel('Number of dates', { exact: true }).fill('0');
    await repeat.getByRole('button', { name: 'Preview dates' }).click();
    await expect(repeat.getByText('Enter a number of dates from 1 to 366.')).toBeVisible();
    await repeat.getByLabel('Number of dates', { exact: true }).fill('400');
    await repeat.getByRole('button', { name: 'Preview dates' }).click();
    await expect(repeat.getByText('Too many dates: an event can have at most 366.')).toBeVisible();
    await repeat.getByLabel('Repeat every').fill('0');
    await repeat.getByLabel('Number of dates', { exact: true }).fill('4');
    await repeat.getByRole('button', { name: 'Preview dates' }).click();
    await expect(repeat.getByText('Enter a whole number from 1 to 52.')).toBeVisible();
    await repeat.getByLabel('Repeat every').fill('1');

    // Keyboard: the preview button works from the keyboard.
    await repeat.getByRole('button', { name: 'Preview dates' }).focus();
    await page.keyboard.press('Enter');
    await expect(repeat.getByRole('heading', { name: '4 dates will be added' })).toBeVisible();
    // 14 March 2027 is the US spring-forward: the 17th and 24th are still at 7 pm.
    for (const day of ['03', '10', '17', '24'])
      await expect(
        repeat.getByText(consoleLabel(`2027-03-${day}T19:00`, `2027-03-${day}T22:00`), { exact: true }),
      ).toBeVisible();
    await expectAccessible(page);

    await repeat.getByRole('button', { name: 'Save 4 dates' }).click();
    await expect(repeat.getByText('4 dates added')).toBeVisible();
    const table = page.getByRole('table', { name: '4 dates' });
    await expect(table.getByRole('row')).toHaveCount(5);
    await page.reload();
    await expect(page.getByRole('table', { name: '4 dates' }).getByRole('row')).toHaveCount(5);
    await expect(
      page.getByRole('cell', { name: consoleLabel('2027-03-17T19:00', '2027-03-17T22:00'), exact: true }),
    ).toBeVisible();
    await expectAccessible(page);
    expect(await noSideScroll(page)).toBe(true);
  });

  test('edit one date, then this and all later dates; an end before the start is refused', async ({
    page,
  }) => {
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Edit Dates ${tag}`, '2027-03-03T19:00', '2027-03-03T22:00');
    await addWeekly(page, base, 4);

    await page
      .getByRole('link', { name: `Edit ${consoleLabel('2027-03-10T19:00', '2027-03-10T22:00')}` })
      .click();
    const edit = page.getByRole('region', { name: /^Edit / });
    await expect(edit).toBeVisible();
    await expectAccessible(page);
    await edit.getByLabel('Ends', { exact: true }).fill('2027-03-10T17:00');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit.getByText('The end must be after the start.')).toBeVisible();
    await edit.getByLabel('Starts', { exact: true }).fill('2027-03-10T18:00');
    await edit.getByLabel('Ends', { exact: true }).fill('2027-03-10T21:00');
    await expect(edit.getByLabel('This date only')).toBeChecked();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit.getByText('1 date updated')).toBeVisible();
    await expect(
      page.getByRole('cell', { name: consoleLabel('2027-03-10T18:00', '2027-03-10T21:00'), exact: true }),
    ).toBeVisible();

    await page
      .getByRole('link', { name: `Edit ${consoleLabel('2027-03-17T19:00', '2027-03-17T22:00')}` })
      .click();
    const later = page.getByRole('region', {
      name: `Edit ${consoleLabel('2027-03-17T19:00', '2027-03-17T22:00')}`,
    });
    await expect(later).toBeVisible();
    await later.getByLabel('Starts', { exact: true }).fill('2027-03-17T20:00');
    await later.getByLabel('Ends', { exact: true }).fill('2027-03-17T23:30');
    await later.getByLabel('This date and all later dates').check();
    await later.getByRole('button', { name: 'Save changes' }).click();
    // Saved: the panel is now titled with the date's new times.
    const saved = page.getByRole('region', { name: /^Edit / });
    await expect(saved.getByText('2 dates updated')).toBeVisible();
    for (const day of ['17', '24'])
      await expect(
        page.getByRole('cell', {
          name: consoleLabel(`2027-03-${day}T20:00`, `2027-03-${day}T23:30`),
          exact: true,
        }),
      ).toBeVisible();
    // Earlier dates are untouched.
    await expect(
      page.getByRole('cell', { name: consoleLabel('2027-03-03T19:00', '2027-03-03T22:00'), exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('cell', { name: consoleLabel('2027-03-24T20:00', '2027-03-24T23:30'), exact: true }),
    ).toBeVisible();
  });

  test('buyers pick a date, the ticket shows it; cancelling a date shows its sales', async ({
    page,
    browser,
  }) => {
    // A long flow (set up dates, two purchases, cancel a date): ~17 s alone, more beside the other
    // projects, so it gets its own budget like the other end-to-end journeys.
    test.setTimeout(90_000);
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Picked ${tag}`, '2027-03-03T19:00', '2027-03-03T22:00');
    const slug = base.split('/').pop() as string;
    await addWeekly(page, base, 3);
    // A single extra date with room for one ticket.
    const add = page.getByRole('region', { name: 'Add a date' });
    await add.getByLabel('Starts', { exact: true }).fill('2027-04-01T12:00');
    await add.getByLabel('Ends', { exact: true }).fill('2027-04-01T14:00');
    await add.getByLabel('Capacity').fill('1');
    await add.getByRole('button', { name: 'Add date' }).click();
    await expect(add.getByText('1 date added')).toBeVisible();
    await addTicketType(page, base, 'Day pass');
    await publish(page, base);

    // The guest sees the dates first; tickets only once a date is chosen.
    const second = consoleLabel('2027-03-10T19:00', '2027-03-10T22:00');
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/events/${slug}`);
    await expect(anon.getByRole('heading', { name: 'Choose a date', level: 2 })).toBeVisible();
    await expect(anon.getByText('Choose a date first', { exact: true })).toBeVisible();
    await expectAccessible(anon);
    expect(await noSideScroll(anon)).toBe(true);
    // Keyboard: focus the date link and press Enter.
    await anon.getByRole('link', { name: second }).focus();
    await anon.keyboard.press('Enter');
    await expect(anon).toHaveURL(/\?date=/);
    await expect(anon.getByRole('link', { name: second })).toHaveAttribute('aria-current', 'true');
    await expect(anon.getByText(/^Tickets for Wednesday, March 10/)).toBeVisible();
    await expectAccessible(anon);

    const guest = await buyForDate(browser, slug, second, 'Day pass', `Rae ${tag}`);
    const onDate = new Intl.DateTimeFormat('en', {
      timeZone: TZ,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(chicagoInstant('2027-03-10T19:00'));
    await expect(guest.getByText(`Valid on ${onDate}`)).toBeVisible();
    await expectAccessible(guest);

    // The one-place date sells out and says so.
    const small = consoleLabel('2027-04-01T12:00', '2027-04-01T14:00');
    await buyForDate(browser, slug, small, 'Day pass', `Sol ${tag}`);
    await anon.goto(`/events/${slug}`);
    await expect(anon.getByRole('link', { name: small })).toHaveCount(0);
    await expect(anon.getByRole('listitem').filter({ hasText: 'Sold out' })).toBeVisible();

    // Cancel the second date: the impact (1 ticket sold), no automatic refund.
    await page.goto(`${base}/dates`);
    // Columns: date, capacity, tickets sold, status, actions.
    await expect(page.getByRole('row').filter({ hasText: second }).getByRole('cell').nth(2)).toHaveText('1');
    await page.getByRole('link', { name: `Cancel ${second}` }).click();
    const cancel = page.getByRole('region', { name: `Cancel ${second}?` });
    await expect(cancel.getByText('1 ticket has been sold for this date.')).toBeVisible();
    await expect(cancel.getByText(/Refunds are not automatic/)).toBeVisible();
    await expect(cancel.getByRole('link', { name: 'Review orders' })).toHaveAttribute(
      'href',
      /tickets-orders/,
    );
    await expectAccessible(page);
    await cancel.getByRole('button', { name: 'Cancel this date' }).click();
    await expect(page.getByText(/The date was cancelled/)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: second })).toContainText('Cancelled');
    await expect(page.getByRole('link', { name: `Cancel ${second}` })).toHaveCount(0);

    // A date without sales says so; "Keep this date" backs out.
    const third = consoleLabel('2027-03-17T19:00', '2027-03-17T22:00');
    await page.getByRole('link', { name: `Cancel ${third}` }).click();
    await expect(page.getByText('No tickets have been sold for this date.')).toBeVisible();
    await page.getByRole('link', { name: 'Keep this date' }).click();
    await expect(page.getByRole('row').filter({ hasText: third })).toContainText('Scheduled');

    // Publicly the cancelled date is marked and not selectable.
    await anon.goto(`/events/${slug}`);
    await expect(anon.getByRole('link', { name: second })).toHaveCount(0);
    await expect(anon.getByRole('listitem').filter({ hasText: 'Cancelled' })).toBeVisible();
  });

  test('the scanner admits a ticket on its own date and rejects it on another', async ({ page, browser }) => {
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Two Nights ${tag}`, chicagoFromNow(-1), chicagoFromNow(3));
    const slug = base.split('/').pop() as string;
    await page.goto(`${base}/dates`);
    const add = page.getByRole('region', { name: 'Add a date' });
    const tonight = [chicagoFromNow(-1), chicagoFromNow(3)] as const;
    const tomorrow = [chicagoFromNow(47), chicagoFromNow(51)] as const;
    for (const [s, e] of [tonight, tomorrow]) {
      await add.getByLabel('Starts', { exact: true }).fill(s);
      await add.getByLabel('Ends', { exact: true }).fill(e);
      await add.getByRole('button', { name: 'Add date' }).click();
      await expect(add.getByText('1 date added')).toBeVisible();
    }
    await addTicketType(page, base, 'Night pass');
    await publish(page, base);
    const codeOf = async (p: Page) =>
      ((await p.locator('.tracking-\\[0\\.2em\\]').first().textContent()) ?? '').trim();
    const later = await buyForDate(browser, slug, consoleLabel(...tomorrow), 'Night pass', `Tom ${tag}`);
    const now = await buyForDate(browser, slug, consoleLabel(...tonight), 'Night pass', `Tia ${tag}`);

    await page.goto(`${base}/onsite`);
    const field = page.getByLabel('Ticket code');
    const result = page.getByRole('status').filter({ has: page.locator('[data-result]') });
    await field.fill(await codeOf(later));
    await field.press('Enter');
    await expect(result).toContainText('This ticket is for another date');
    await expectAccessible(page);
    await field.fill(await codeOf(now));
    await field.press('Enter');
    await expect(result).toContainText('Welcome in');
  });

  test('a ticket type can sell for chosen dates only; the box office sells one date', async ({
    page,
    browser,
  }) => {
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Matinee ${tag}`, '2027-03-03T19:00', '2027-03-03T22:00');
    const slug = base.split('/').pop() as string;
    await addWeekly(page, base, 2);
    const first = consoleLabel('2027-03-03T19:00', '2027-03-03T22:00');
    const second = consoleLabel('2027-03-10T19:00', '2027-03-10T22:00');
    await addTicketType(page, base, 'Any night');
    // A pass for the second date only.
    await page.getByLabel('Name', { exact: true }).fill('Closing night');
    await page.getByLabel('Price (USD)').fill('0');
    await page.getByLabel('Quantity available').fill('10');
    const valid = page.getByRole('group', { name: 'Sells for these dates' });
    await expect(valid.getByText('Leave all unticked to sell for every date.')).toBeVisible();
    await valid.getByLabel(second).check();
    await page.getByRole('button', { name: 'Add ticket type' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Closing night' })).toContainText('1 date');
    await expect(page.getByRole('row').filter({ hasText: 'Any night' })).toContainText('All dates');
    await expectAccessible(page);
    await publish(page, base);

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/events/${slug}`);
    await guest.getByRole('link', { name: first }).click();
    await expect(guest.getByLabel('Quantity — Any night')).toBeVisible();
    await expect(guest.getByLabel('Quantity — Closing night')).toHaveCount(0);
    await guest.goto(`/events/${slug}`);
    await guest.getByRole('link', { name: second }).click();
    await expect(guest.getByLabel('Quantity — Closing night')).toBeVisible();

    // Box office: the date is chosen first; a pass not sold that night is refused.
    await page.goto(`${base}/tickets-orders`);
    const office = page.getByRole('region', { name: 'Box office' });
    await pickOption(office.getByLabel('Date', { exact: true }), { label: first });
    await office.getByLabel(/^Closing night/).fill('1');
    await office.getByLabel("Buyer's name").fill(`Walk ${tag}`);
    await office.getByLabel("Buyer's email").fill(`walk${tag}@example.test`);
    await office.getByRole('button', { name: 'Record sale' }).click();
    await expect(office.getByText("One of these tickets isn't sold for this date.")).toBeVisible();
    await pickOption(office.getByLabel('Date', { exact: true }), { label: second });
    await office.getByRole('button', { name: 'Record sale' }).click();
    await expect(office.getByText('Sale recorded. The tickets are on their way.')).toBeVisible();
    await page.goto(`${base}/dates`);
    await expect(page.getByRole('row').filter({ hasText: second }).getByRole('cell').nth(2)).toHaveText('1');
  });

  test('viewers see dates but cannot add, edit or cancel them (even by URL)', async ({ page, browser }) => {
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `Viewer Dates ${tag}`, '2027-05-05T19:00', '2027-05-05T22:00');
    await addWeekly(page, base, 2);
    const href = await page
      .getByRole('link', { name: `Cancel ${consoleLabel('2027-05-05T19:00', '2027-05-05T22:00')}` })
      .getAttribute('href');

    const viewer = await (await browser.newContext()).newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/dates`);
    await expect(viewer.getByRole('table', { name: '2 dates' })).toBeVisible();
    await expect(viewer.getByRole('heading', { name: 'Add a date' })).toHaveCount(0);
    await expect(viewer.getByRole('heading', { name: 'Add a repeating schedule' })).toHaveCount(0);
    await expect(viewer.getByRole('link', { name: /^Edit / })).toHaveCount(0);
    await expect(viewer.getByRole('combobox', { name: 'Series' })).toHaveCount(0);
    await viewer.goto(href as string);
    await expect(viewer.getByRole('button', { name: 'Cancel this date' })).toHaveCount(0);
    await expectAccessible(viewer);
  });

  test('Arabic: the dates page and the public date picker render right to left', async ({
    page,
    browser,
  }) => {
    const tag = tagOf();
    await signIn(page);
    const base = await createEvent(page, `RTL Dates ${tag}`, '2027-06-02T19:00', '2027-06-02T22:00');
    const slug = base.split('/').pop() as string;
    await addWeekly(page, base, 2);
    await addTicketType(page, base, 'RTL pass');
    await publish(page, base);
    await page.goto(`/ar${base}/dates`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'المواعيد', level: 1 })).toBeVisible();
    await expectAccessible(page);
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/ar/events/${slug}`);
    await expect(guest.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(guest.getByRole('heading', { name: 'اختر موعدًا', level: 2 })).toBeVisible();
    await expectAccessible(guest);
    expect(await noSideScroll(guest)).toBe(true);
  });
});
