import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  ageSession,
  confirmStepUp,
  expectAccessible,
  lastEmailedCode,
  personaCode,
  signIn,
} from './helpers.ts';

/**
 * M3.10a waitlists with timed offers: join a sold-out pass from the event page (email code), the
 * organizer frees a ticket, the offer is emailed and bought through the normal checkout; a lapsed
 * offer passes to the next person, who may decline; rejoining goes to the back of the line; the
 * organizer's console (counts, pause, manual offer, remove, export with step-up); viewers denied.
 */

const ORG = 'lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;
const emailOf = (who: string) => `${who.toLowerCase().replace(/\W+/g, '.')}@example.test`;

interface Mail {
  subject: string;
  html: string;
}

/** A published event next month with one free pass of `quantity` places; its console path. */
async function eventWithPass(page: Page, name: string, quantity: number) {
  await page.goto(`/o/${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  const d = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('Starts', { exact: true }).fill(`${d}T19:00`);
  await page.getByLabel('Ends', { exact: true }).fill(`${d}T23:00`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill(String(quantity));
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Pass' })).toBeVisible();
  return { base, slug: base.split('/').pop() as string };
}

/** A guest takes one free ticket (selling the pass out). */
async function buyOne(browser: Browser, slug: string, who: string) {
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(`/events/${slug}`);
  await buyer.getByLabel('Quantity — Pass').selectOption('1');
  await buyer.getByLabel('Full name').fill(who);
  await buyer.getByLabel('Email for your tickets').fill(emailOf(who));
  await buyer.getByRole('button', { name: 'Continue to payment' }).click();
  const field = buyer.getByLabel('Verification code', { exact: true });
  await field.fill(await lastEmailedCode(buyer, emailOf(who)));
  await buyer.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(buyer).toHaveURL(/\/orders\//);
  await buyer.close();
}

/** From the event page: "Join the waitlist" → name, email → the emailed code → place in line. */
async function joinFromEventPage(page: Page, slug: string, who: string, opts: { axe?: boolean } = {}) {
  await page.goto(`/events/${slug}`);
  const card = page.getByRole('listitem').filter({ hasText: 'Pass' });
  await expect(card).toContainText('Sold out');
  const join = page.getByRole('link', { name: 'Join the waitlist — Pass' });
  // By keyboard: focus the link and follow it.
  await join.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/events/${slug}/waitlist\\?pass=`));
  await expect(page.getByRole('heading', { name: 'Join the waitlist', level: 1 })).toBeVisible();
  if (opts.axe) await expectAccessible(page);
  const form = page.getByRole('form', { name: 'Join the waitlist' });
  await form.getByRole('button', { name: 'Join the waitlist' }).click();
  await expect(form.getByText('Enter your name.')).toBeVisible();
  await form.getByLabel('Full name').fill(who);
  await form.getByLabel('Email for your offer').fill(emailOf(who));
  await form.getByRole('button', { name: 'Join the waitlist' }).click();
  const code = form.getByLabel('Verification code', { exact: true });
  await expect(code).toBeVisible();
  if (opts.axe) await expectAccessible(page);
  await code.fill(await lastEmailedCode(page, emailOf(who)));
  await code.press('Enter');
  const done = page.getByRole('status').filter({ hasText: "You're on the waitlist" });
  await expect(done).toBeVisible();
  const text = (await done.textContent()) ?? '';
  await page.getByRole('link', { name: 'See my place in line' }).click();
  await expect(page).toHaveURL(/\/waitlist\/[0-9a-f-]{36}~/);
  return { text, link: new URL(page.url()).pathname };
}

/** Run the waitlist sweeper for this event only (`hours` later), as the worker would. */
async function sweep(page: Page, slug: string, hours = 0) {
  const res = await page.request.post('/api/dev/waitlist/sweep', {
    form: { org: ORG, event: slug, hours: String(hours) },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { expired: number; offered: number };
}

async function mailbox(page: Page, to: string): Promise<Mail[]> {
  await page.request.post('/api/dev/outbox/drain', { form: { org: ORG } });
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  return res.json();
}

/**
 * The waitlist link in the newest email to `to` whose subject starts with `subject`. The dev drain
 * works through the whole seeded org's recent events, which takes a while when the full suite runs.
 */
async function linkFromMail(page: Page, to: string, subject: string): Promise<string> {
  let link = '';
  await expect
    .poll(
      async () => {
        const mail = (await mailbox(page, to)).filter((m) => m.subject.startsWith(subject)).at(-1);
        link = /href="(https?:\/\/[^"]+\/waitlist\/[^"]+)"/.exec(mail?.html ?? '')?.[1] ?? '';
        return link;
      },
      { timeout: 30_000 },
    )
    .toMatch(/\/waitlist\/[0-9a-f-]{36}~/);
  return new URL(link.replace(/&amp;/g, '&')).pathname;
}

/** The organizer cancels one guest's ticket (Attendees → bulk "Cancel tickets"), freeing a place. */
async function cancelTicketOf(page: Page, base: string, who: string) {
  await page.goto(`${base}/attendees`);
  await page.getByLabel(`Select ${who}`).check();
  const bulk = page.getByRole('form', { name: 'Bulk actions' });
  await bulk.getByLabel('Action', { exact: true }).selectOption({ label: 'Cancel tickets (no refund)' });
  await bulk.getByRole('button', { name: 'Review cancellation…' }).click();
  await page.getByRole('button', { name: 'Cancel tickets for 1 person' }).click();
  await expect(page.getByRole('region', { name: 'Cancelled tickets' }).getByRole('status')).toHaveText(
    'Cancelled 1 ticket.',
  );
}

const guestPage = async (browser: Browser, locale?: string) =>
  (await browser.newContext(locale ? { locale } : {})).newPage();

test.describe('waitlists (M3.10a)', () => {
  test('join from the sold-out page, the organizer frees a ticket, the guest gets and uses the offer', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const s = stamp();
    const name = `Waitlist Night ${s}`;
    const [buyer, amy] = [`Buyer ${s}`, `Amy ${s}`];
    await signIn(page);
    const { base, slug } = await eventWithPass(page, name, 1);
    await buyOne(browser, slug, buyer);

    const guest = await guestPage(browser);
    const joined = await joinFromEventPage(guest, slug, amy, { axe: true });
    expect(joined.text).toContain('number 1 in line');
    await expect(guest.getByRole('heading', { name: "You're number 1 in line" })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Leave the waitlist' })).toBeVisible();
    await expectAccessible(guest);
    // The confirmation email links to the same place; nothing personal on the public event page.
    expect(await linkFromMail(guest, emailOf(amy), `You're on the waitlist for ${name}`)).toBe(joined.link);
    await guest.goto(`/events/${slug}`);
    await expect(guest.locator('body')).not.toContainText(emailOf(amy));

    // The organizer cancels the buyer's ticket: the sweeper offers the place to Amy.
    await cancelTicketOf(page, base, buyer);
    expect((await sweep(page, slug)).offered).toBeGreaterThanOrEqual(1);
    const offerLink = await linkFromMail(guest, emailOf(amy), `Tickets are free for ${name}`);
    expect(offerLink).toBe(joined.link);
    // Nobody else can buy the held place meanwhile.
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByRole('listitem').filter({ hasText: 'Pass' })).toContainText('Sold out');

    await guest.goto(offerLink);
    await expect(guest.getByRole('heading', { name: '1 Pass ticket is held for you' })).toBeVisible();
    await expect(guest.getByText(/^Check out by /)).toBeVisible();
    await expectAccessible(guest);
    const offer = guest.getByRole('form', { name: 'Check out your offer' });
    await expect(offer.getByLabel('Full name')).toHaveValue(amy);
    await expect(offer).toContainText(`Your tickets go to ${emailOf(amy)}.`);
    // Keyboard: submit from the name field.
    await offer.getByLabel('Full name').press('Enter');
    await expect(guest).toHaveURL(/\/orders\//);
    await expect(guest.getByText('Pass').first()).toBeVisible();
    // The link now says it's done.
    await guest.goto(offerLink);
    await expect(guest.getByRole('heading', { name: "You've checked out" })).toBeVisible();
  });

  test('an expired offer passes to the next person; the first may rejoin at the back; the next declines (Arabic)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = stamp();
    const name = `Waitlist Lapse ${s}`;
    const [buyer, amy, ben] = [`Buyer ${s}`, `Amy ${s}`, `Ben ${s}`];
    await signIn(page);
    const { base, slug } = await eventWithPass(page, name, 1);
    await buyOne(browser, slug, buyer);
    const a = await joinFromEventPage(await guestPage(browser), slug, amy);
    const b = await joinFromEventPage(await guestPage(browser), slug, ben);
    expect(b.text).toContain('number 2 in line');

    await cancelTicketOf(page, base, buyer);
    await sweep(page, slug);
    const guest = await guestPage(browser);
    await guest.goto(a.link);
    await expect(guest.getByRole('heading', { name: '1 Pass ticket is held for you' })).toBeVisible();
    await guest.goto(b.link);
    await expect(guest.getByRole('heading', { name: "You're number 1 in line" })).toBeVisible();

    // A day later Amy's offer has lapsed: Ben gets it, Amy is told and may rejoin.
    await sweep(page, slug, 25);
    await linkFromMail(guest, emailOf(amy), `Your offer for ${name} has ended`);
    await guest.goto(a.link);
    await expect(guest.getByRole('heading', { name: 'Your offer has ended' })).toBeVisible();
    await expectAccessible(guest);
    const rejoin = guest.getByRole('button', { name: 'Rejoin at the back of the line' });
    await rejoin.focus();
    await guest.keyboard.press('Enter');
    await expect(guest.getByRole('heading', { name: "You're number 1 in line" })).toBeVisible();

    // Ben reads his offer in Arabic (right to left) and declines it.
    const ar = await guestPage(browser, 'ar');
    await ar.goto(`/ar${b.link}`);
    await expect(ar.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(ar.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(ar.getByRole('form', { name: 'أتمّ شراء عرضك' })).toBeVisible();
    await expectAccessible(ar);
    await ar.getByRole('button', { name: 'لا شكرًا، حرّر التذاكر' }).click();
    await expect(ar.getByRole('heading', { name: 'حرّرت التذاكر' })).toBeVisible();
    await expectAccessible(ar);
    // The place goes to Amy, back in line.
    await sweep(page, slug);
    await guest.goto(a.link);
    await expect(guest.getByRole('heading', { name: '1 Pass ticket is held for you' })).toBeVisible();
  });

  test('the organizer manages the list (counts, pause, manual offer, remove, export); a viewer is denied', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const s = stamp();
    const name = `Waitlist Console ${s}`;
    const [buyer, amy, ben] = [`Buyer ${s}`, `Amy ${s}`, `Ben ${s}`];
    await signIn(page);
    const { base, slug } = await eventWithPass(page, name, 1);
    await buyOne(browser, slug, buyer);
    await joinFromEventPage(await guestPage(browser), slug, amy);
    await joinFromEventPage(await guestPage(browser), slug, ben);

    await page.goto(`${base}/tickets-orders`);
    await page.getByRole('link', { name: 'Waitlists', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Waitlists', level: 1 })).toBeVisible();
    const lists = page.getByRole('table', { name: 'Waitlists' });
    await expect(lists.getByRole('row').nth(1)).toContainText('2 people · 2 tickets');
    const people = page.getByRole('table', { name: 'People on Pass' });
    await expect(people.getByRole('row').nth(1)).toContainText(amy);
    await expect(people.getByRole('row').nth(2)).toContainText(ben);
    await expectAccessible(page);

    // Pause automatic offers and shorten the window; a bad window is refused.
    const settings = page.getByRole('form', { name: 'Waitlist settings' });
    await settings.getByLabel('Offer holds tickets for (hours)').fill('500');
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(settings.getByText('Enter between 0.25 and 168 hours.')).toBeVisible();
    await settings.getByLabel('Offer freed tickets automatically, in line order').uncheck();
    await settings.getByLabel('Offer holds tickets for (hours)').fill('2');
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(settings.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(lists.getByRole('row').nth(1)).toContainText('Paused');

    // Nothing free yet: a manual offer is refused.
    await page.getByRole('button', { name: `Offer now to ${ben}` }).click();
    await expect(page.getByText('Not enough tickets are free for this offer.')).toBeVisible();
    // Free a place; paused, so the sweeper offers nothing; the organizer offers Ben (second) by keyboard.
    await cancelTicketOf(page, base, buyer);
    expect((await sweep(page, slug)).offered).toBe(0);
    await page.goto(`${base}/tickets-orders/waitlists`);
    await page.getByRole('button', { name: `Offer now to ${ben}` }).focus();
    await page.keyboard.press('Enter');
    await expect(people.getByRole('row').filter({ hasText: ben })).toContainText('Offer open until');
    await page.getByRole('button', { name: `Offer now to ${amy}` }).click();
    await expect(page.getByText('Not enough tickets are free for this offer.')).toBeVisible();
    // Remove Amy.
    await page.getByRole('button', { name: `Remove ${amy}` }).click();
    await expect(people.getByRole('row').filter({ hasText: amy })).toContainText('Removed');
    await expectAccessible(page);

    // Export: a recent step-up first, then the CSV.
    await ageSession(page);
    await page.reload();
    await page.getByRole('button', { name: 'Export CSV' }).click();
    await confirmStepUp(page, personaCode());
    const download = page.getByRole('link', { name: 'Download' });
    await expect(download).toBeVisible();
    const res = await page.request.get((await download.getAttribute('href')) ?? '');
    expect(res.headers()['content-type']).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain(emailOf(ben));
    expect(csv).toContain('Offer open');
    expect(csv).toContain('Removed');

    // A viewer sees no link and gets "not found" at the address.
    const viewer = await guestPage(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/tickets-orders`);
    await expect(viewer.getByRole('link', { name: 'Waitlists', exact: true })).toHaveCount(0);
    const denied = await viewer.goto(`${base}/tickets-orders/waitlists`);
    expect(denied?.status()).toBe(404);
  });
});
