import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  lastEmailedCode,
  ownClientIp,
  signIn,
} from './helpers.ts';
import { addGuests } from './seating-helpers.ts';

/**
 * M5.8a — networking: the organizer's console (switch, meeting places with a capacity, time
 * slots, the report queue) and the attendee pages (sign in with an emailed code, opt in, the
 * directory and its search, connections, meetings with a table and a calendar file, block and
 * report). Phone first; keyboard only; axe in light and dark; Arabic RTL.
 */
const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;

interface Conf {
  readonly base: string;
  readonly slug: string;
  readonly console: string;
  readonly network: string;
  readonly tag: string;
}

/** A published conference with networking on (as the Lakeside owner, console page open). */
async function conference(page: Page, label: string, opts: { enable?: boolean } = {}): Promise<Conf> {
  const tag = stamp();
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(`${label} ${tag}`);
  await page.getByLabel('Event type').selectOption('conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(40, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  const slug = base.split('/').pop() ?? '';
  const conf = { base, slug, console: `${base}/networking`, network: `/events/${slug}/network`, tag };
  if (opts.enable !== false) {
    await page.goto(conf.console);
    await page.getByRole('button', { name: 'Turn on networking' }).click();
    await expect(page.getByText('People in the directory')).toBeVisible();
  }
  return conf;
}

async function addPlace(page: Page, name: string, kind: 'Booth' | 'Meeting point', capacity: number) {
  const form = page.getByRole('region', { name: 'Add place' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Type').selectOption({ label: kind });
  await form.getByLabel('Capacity').fill(String(capacity));
  await form.getByRole('button', { name: 'Add place' }).click();
  await expect(form.getByText('Place added.')).toBeVisible();
}

async function addSlots(page: Page, from: string, to: string, minutes: number) {
  const form = page.getByRole('region', { name: 'Add time slots' });
  await form.getByLabel('From').fill(at(40, from));
  await form.getByLabel('Until').fill(at(40, to));
  await form.getByLabel('Length of each slot (minutes)').fill(String(minutes));
  await form.getByRole('button', { name: 'Add time slots' }).click();
  await expect(form.getByText('Time slots added.')).toBeVisible();
}

const emailOf = (name: string) => `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`;

/** A fresh browser (its own client IP) signed in to the event's networking with the emailed code. */
async function attendee(browser: Browser, conf: Conf, email: string): Promise<Page> {
  const context = await browser.newContext();
  await ownClientIp(context);
  const p = await context.newPage();
  await p.goto(conf.network);
  await p.getByLabel('Your email', { exact: true }).fill(email);
  await p.getByRole('button', { name: 'Email me a code' }).click();
  await p.getByLabel('Verification code', { exact: true }).fill(await lastEmailedCode(p, email));
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  return p;
}

/** Opt in with a name, job title, company and interests. */
async function optIn(p: Page, who: { name: string; title?: string; company?: string; interests?: string }) {
  await expect(p.getByRole('heading', { name: 'Create your networking profile' })).toBeVisible();
  await p.getByLabel('Name shown to others').fill(who.name);
  if (who.title) await p.getByLabel('Job title').fill(who.title);
  if (who.company) await p.getByLabel('Company').fill(who.company);
  if (who.interests) await p.getByLabel('Interests').fill(who.interests);
  await p.getByRole('checkbox', { name: /^Show my profile to other attendees/ }).check();
  await p.getByRole('button', { name: 'Join networking' }).click();
  await expect(p.getByRole('navigation', { name: 'Networking sections' })).toBeVisible();
}

const tab = (p: Page, name: string) =>
  p
    .getByRole('navigation', { name: 'Networking sections' })
    .getByRole('link', { name: new RegExp(`^${name}`) });

const people = (p: Page) => p.getByRole('list', { name: 'People' });

test.describe('networking (M5.8a)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('the organizer turns networking on, adds places and slots with validation; viewers read only; keyboard; RTL', async ({
    page,
  }) => {
    await signIn(page);
    const conf = await conference(page, 'Net Console', { enable: false });
    // Reached from the Sessions page.
    await page.goto(`${conf.base}/sessions`);
    await page.getByRole('link', { name: 'Networking', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${conf.console}$`));
    await expect(page.getByText('Networking is off')).toBeVisible();
    await expectAccessibleBothModes(page);
    // Off: the attendee page doesn't exist yet.
    expect((await page.request.get(conf.network)).status()).toBe(404);
    // Keyboard: the one primary action.
    await page.getByRole('button', { name: 'Turn on networking' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('People in the directory')).toBeVisible();
    await expect(page.getByText('No meeting places yet. Add one below.')).toBeVisible();
    await expect(page.getByText('No time slots yet. Add some below.')).toBeVisible();
    await expect(page.getByText('No reports to review.')).toBeVisible();
    await expectAccessibleBothModes(page);

    // Places: inline validation, then a booth and a meeting point.
    const place = page.getByRole('region', { name: 'Add place' });
    await place.getByLabel('Capacity').fill('');
    await place.getByRole('button', { name: 'Add place' }).click();
    await expect(place.getByText('Enter a name.')).toBeVisible();
    await place.getByLabel('Name', { exact: true }).fill('Booth 12');
    await place.getByLabel('Capacity').fill('60');
    await place.getByRole('button', { name: 'Add place' }).click();
    await expect(place.getByText('Enter a capacity from 1 to 50.')).toBeVisible();
    await expect(place.getByLabel('Name', { exact: true })).toHaveValue('Booth 12');
    await place.getByLabel('Type').selectOption({ label: 'Booth' });
    await place.getByLabel('Capacity').fill('2');
    await place.getByRole('button', { name: 'Add place' }).click();
    await expect(place.getByText('Place added.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Booth 12', level: 3 })).toBeVisible();
    await expect(page.getByText('Booth · 2 meetings at a time · nothing booked')).toBeVisible();
    // Names are unique per event, whatever the case.
    await place.getByLabel('Name', { exact: true }).fill('booth 12');
    await place.getByLabel('Capacity').fill('1');
    await place.getByRole('button', { name: 'Add place' }).click();
    await expect(place.getByText('Another place already has this name.')).toBeVisible();
    // Keyboard only: a meeting point.
    await place.getByLabel('Name', { exact: true }).fill('');
    await place.getByLabel('Capacity').fill('');
    await place.getByLabel('Name', { exact: true }).focus();
    await page.keyboard.type('Meeting point A');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await expect(place.getByText('Place added.')).toBeVisible();
    await expect(page.getByText('Meeting point · 3 meetings at a time · nothing booked')).toBeVisible();

    // Slots: back to back, inside the event, never overlapping.
    const slots = page.getByRole('region', { name: 'Add time slots' });
    await slots.getByLabel('From').fill(at(40, '10:00'));
    await slots.getByLabel('Until').fill(at(40, '10:10'));
    await slots.getByLabel('Length of each slot (minutes)').fill('15');
    await slots.getByRole('button', { name: 'Add time slots' }).click();
    await expect(slots.getByText('The time between start and end is shorter than one slot.')).toBeVisible();
    await slots.getByLabel('From').fill(at(41, '10:00'));
    await slots.getByLabel('Until').fill(at(41, '11:00'));
    await slots.getByRole('button', { name: 'Add time slots' }).click();
    await expect(slots.getByText("Slots must fall within the event's dates and times.")).toBeVisible();
    await addSlots(page, '10:00', '10:45', 15);
    const slotList = page.getByRole('list', { name: 'Time slots' });
    await expect(slotList.getByRole('listitem')).toHaveCount(3);
    await slots.getByLabel('From').fill(at(40, '10:30'));
    await slots.getByLabel('Until').fill(at(40, '11:00'));
    await slots.getByRole('button', { name: 'Add time slots' }).click();
    await expect(slots.getByText('These slots overlap slots you already have.')).toBeVisible();
    // Delete one slot (nothing booked there).
    await slotList
      .getByRole('listitem')
      .last()
      .getByRole('button', { name: /^Delete the slot/ })
      .click();
    await expect(slotList.getByRole('listitem')).toHaveCount(2);
    // Edit a place's capacity.
    await page.getByText('Edit Booth 12').click();
    const edit = page.locator('details').filter({ hasText: 'Edit Booth 12' });
    await edit.getByLabel('Capacity').fill('4');
    await edit.getByRole('button', { name: 'Save place' }).click();
    await expect(edit.getByText('Place saved.')).toBeVisible();
    // Everything persists.
    await page.reload();
    await expect(page.getByText('Booth · 4 meetings at a time · nothing booked')).toBeVisible();
    await expect(slotList.getByRole('listitem')).toHaveCount(2);
    await expectAccessible(page);

    // The attendee page now exists, and the public event page links to it.
    await page.goto(`/events/${conf.slug}`);
    await expect(page.getByRole('link', { name: 'Networking', exact: true })).toHaveAttribute(
      'href',
      conf.network,
    );

    // A viewer sees it read-only: no forms, no buttons.
    await signIn(page, VIEWER);
    await page.goto(conf.console);
    await expect(page.getByText('You can view networking. Ask an admin to change it.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Booth 12', level: 3 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Add place' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Add time slots' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
    await expectAccessible(page);
    // Arabic, right to left.
    await page.goto(`/ar${conf.console}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'التواصل', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('attendees sign in, opt in (off by default), search the directory and connect; keyboard; RTL', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const conf = await conference(page, 'Net Directory');
    const ana = `Ana ${conf.tag}`;
    const ben = `Ben ${conf.tag}`;
    await addGuests(page, conf.base, [ana, ben]);

    // Signing in: the emailed code, keyboard only.
    const a = await (await browser.newContext()).newPage();
    await ownClientIp(a.context());
    await a.goto(conf.network);
    await expect(a.getByRole('heading', { name: 'Meet other attendees', level: 1 })).toBeVisible();
    await expect(a.getByRole('heading', { name: 'Confirm your email to start' })).toBeVisible();
    await expectAccessible(a);
    await a.getByLabel('Your email', { exact: true }).fill(emailOf(ana));
    await a.getByLabel('Your email', { exact: true }).press('Enter');
    await expect(a.getByLabel('Verification code', { exact: true })).toBeFocused();
    await a.keyboard.type(await lastEmailedCode(a, emailOf(ana)));
    await a.keyboard.press('Enter');

    // Off by default: a registered person is not in the directory until they opt in.
    await expect(a.getByText("You're not in the directory")).toBeVisible();
    await expect(a.getByRole('navigation', { name: 'Networking sections' })).toHaveCount(0);
    await expectAccessibleBothModes(a);
    // Inline validation: the consent tick and a name.
    await a.getByLabel('Name shown to others').fill('');
    await a.getByRole('button', { name: 'Join networking' }).click();
    await expect(a.getByText('Enter the name to show.')).toBeVisible();
    await a.getByLabel('Name shown to others').fill(ana);
    await a.getByRole('button', { name: 'Join networking' }).click();
    await expect(a.getByText('Tick the box to join networking.')).toBeVisible();
    await a.getByLabel('Job title').fill('Designer');
    await a.getByLabel('Company').fill('Acme Studio');
    await a.getByLabel('Interests').fill('Design, AI');
    // Keyboard: tick with Space, submit with Enter.
    await a.getByRole('checkbox', { name: /^Show my profile to other attendees/ }).focus();
    await a.keyboard.press('Space');
    await a.getByRole('button', { name: 'Join networking' }).focus();
    await a.keyboard.press('Enter');
    await expect(a.getByRole('navigation', { name: 'Networking sections' })).toBeVisible();
    // Ben is registered but hasn't opted in: he never appears.
    await expect(a.getByText('No one else has joined yet').first()).toBeVisible();
    await expect(a.getByText(ben)).toHaveCount(0);
    await expectAccessibleBothModes(a);

    // Ben opts in; now both see each other.
    const b = await attendee(browser, conf, emailOf(ben));
    await optIn(b, { name: ben, title: 'Data lead', company: 'Northwind', interests: 'Data, Hiring' });
    await expect(people(b).getByRole('link', { name: ana })).toBeVisible();
    await a.reload();
    await expect(people(a).getByRole('link', { name: ben })).toBeVisible();
    await expect(a.getByText('Data lead · Northwind')).toBeVisible();

    // Search: company, interest, nothing (with the way back), all from the keyboard.
    await a.getByLabel('Search people').fill('northwind');
    await a.getByLabel('Search people').press('Enter');
    await expect(a.getByText('1 person matches “northwind”')).toBeVisible();
    await expect(people(a).getByRole('link', { name: ben })).toBeVisible();
    await a.getByLabel('Search people').fill('hiring');
    await a.getByRole('button', { name: 'Search' }).click();
    await expect(people(a).getByRole('link', { name: ben })).toBeVisible();
    await a.getByLabel('Search people').fill('zzz-nobody');
    await a.getByRole('button', { name: 'Search' }).click();
    await expect(a.getByRole('status').filter({ hasText: 'No one matches “zzz-nobody”' })).toBeVisible();
    await expect(a.getByText('Try a shorter word, or another interest or company.')).toBeVisible();
    await expectAccessible(a);
    await a.getByRole('link', { name: 'Show everyone' }).click();
    await expect(people(a).getByRole('link', { name: ben })).toBeVisible();

    // Connect with a note.
    await people(a).getByRole('link', { name: ben }).click();
    await expect(a.getByRole('heading', { name: ben, level: 1 })).toBeVisible();
    await expectAccessibleBothModes(a);
    await a.getByLabel('Note (optional)').fill('Loved your talk!');
    await a.getByRole('button', { name: 'Send connection request' }).click();
    await expect(a.getByText(`Request sent to ${ben}.`)).toBeVisible();
    await expect(a.getByText('Request sent', { exact: true })).toBeVisible();

    // Ben answers from Connections (the tab counts what waits for him).
    await b.reload();
    await expect(tab(b, 'Connections')).toContainText('1');
    await tab(b, 'Connections').click();
    await expect(b.getByRole('heading', { name: 'Requests for you' })).toBeVisible();
    await expect(b.getByText('Loved your talk!')).toBeVisible();
    await expectAccessibleBothModes(b);
    await b.getByRole('button', { name: `Accept the request from ${ana}` }).focus();
    await b.keyboard.press('Enter');
    await expect(b.getByText(`You're now connected with ${ana}.`)).toBeVisible();
    await expect(
      b.getByRole('region', { name: 'Your connections' }).getByRole('link', { name: ana, exact: true }),
    ).toBeVisible();
    await b.reload();
    await expect(
      b.getByRole('region', { name: 'Your connections' }).getByRole('link', { name: ana, exact: true }),
    ).toBeVisible();
    await a.goto(conf.network);
    await expect(people(a).getByText('Connected')).toBeVisible();

    // Arabic, right to left.
    await b.goto(`/ar${conf.network}`);
    await expect(b.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(b.getByRole('heading', { name: 'تعرّف على مشاركين آخرين', level: 1 })).toBeVisible();
    await expectAccessible(b);

    // An address with no place at the event can't take part.
    const stranger = await attendee(browser, conf, `nobody.${conf.tag}@example.test`);
    await expect(stranger.getByText("We couldn't find a registration for this address")).toBeVisible();
    await expectAccessible(stranger);
    expect((await stranger.request.get(`${conf.network}/connections`)).url()).toMatch(/\/network$/);
  });

  test('meetings: request, accept with a table, the calendar file; a full place refuses; cancelling frees it', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const conf = await conference(page, 'Net Meetings');
    await addPlace(page, 'Booth 7', 'Booth', 1);
    await addSlots(page, '10:00', '10:30', 15);
    const names = ['Ana', 'Ben', 'Cy', 'Dee'].map((n) => `${n} ${conf.tag}`);
    const [ana = '', ben = '', cy = '', dee = ''] = names;
    await addGuests(page, conf.base, names);
    const [a, b, c, d] = await Promise.all(names.map((n) => attendee(browser, conf, emailOf(n))));
    if (!a || !b || !c || !d) throw new Error('attendees');
    for (const [p, n] of [
      [a, ana],
      [b, ben],
      [c, cy],
      [d, dee],
    ] as const)
      await optIn(p, { name: n });

    // Ana asks Ben; the form needs a slot and a place.
    await a.reload();
    await people(a).getByRole('link', { name: ben }).click();
    const meet = a.getByRole('region', { name: 'Request a meeting' });
    await expect(
      meet.getByText(`Times are in the event's time zone (America/Chicago).`, { exact: false }),
    ).toBeVisible();
    await meet.getByRole('button', { name: 'Send meeting request' }).click();
    await expect(meet.getByText('Choose a time slot.')).toBeVisible();
    await expect(meet.getByText('Choose a place.')).toBeVisible();
    await meet.getByLabel('Time slot').selectOption({ index: 1 });
    await meet.getByLabel('Place').selectOption({ label: 'Booth 7 (Booth)' });
    await meet.getByLabel('Note (optional)').fill('Coffee?');
    await meet.getByRole('button', { name: 'Send meeting request' }).click();
    await expect(a.getByText(`Meeting request sent to ${ben}.`)).toBeVisible();
    await expectAccessible(a);
    // Asking twice for the same slot is refused.
    await meet.getByLabel('Time slot').selectOption({ index: 1 });
    await meet.getByLabel('Place').selectOption({ label: 'Booth 7 (Booth)' });
    await meet.getByRole('button', { name: 'Send meeting request' }).click();
    await expect(meet.getByRole('alert')).toHaveText("You've already sent a request.");

    // Cy asks Dee for the same slot at the same booth (it holds one meeting at a time).
    await c.reload();
    await people(c).getByRole('link', { name: dee }).click();
    const cmeet = c.getByRole('region', { name: 'Request a meeting' });
    await cmeet.getByLabel('Time slot').selectOption({ index: 1 });
    await cmeet.getByLabel('Place').selectOption({ label: 'Booth 7 (Booth)' });
    await cmeet.getByRole('button', { name: 'Send meeting request' }).click();
    await expect(c.getByText(`Meeting request sent to ${dee}.`)).toBeVisible();

    // Ben accepts: the booth's table 1 is his and Ana's.
    await b.goto(`${conf.network}/meetings`);
    await expect(b.getByText('Coffee?')).toBeVisible();
    await expectAccessibleBothModes(b);
    await b.getByRole('button', { name: `Accept the meeting with ${ana}` }).click();
    await expect(b.getByText(`Meeting with ${ana} confirmed.`)).toBeVisible();
    const upcoming = b.getByRole('region', { name: 'Your meetings' });
    await expect(upcoming.getByText('At Booth 7, table 1')).toBeVisible();
    // The calendar file, for either of the two only.
    const ics = upcoming.getByRole('link', { name: `Add the meeting with ${ana} to your calendar` });
    const href = (await ics.getAttribute('href')) ?? '';
    const file = await b.request.get(href);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain('text/calendar');
    const body = await file.text();
    expect(body).toContain(`SUMMARY:Meeting with ${ana}`);
    expect(body).toContain('LOCATION:Booth 7\\, table 1');
    expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect((await c.request.get(href)).status()).toBe(404);
    await expect(upcoming.getByText('Confirmed', { exact: true })).toBeVisible();

    // Dee can't accept: the booth is full in that slot.
    await d.goto(`${conf.network}/meetings`);
    await d.getByRole('button', { name: `Accept the meeting with ${cy}` }).click();
    await expect(d.getByRole('main').getByRole('alert')).toHaveText(
      'That place is fully booked for this time slot. Pick another place or time.',
    );
    // The organizer sees one booked.
    await page.goto(conf.console);
    await expect(page.getByText('Booth · 1 meeting at a time · 1 booked')).toBeVisible();

    // Ana cancels; now Dee's acceptance goes through.
    await a.goto(`${conf.network}/meetings`);
    await a.getByRole('button', { name: `Cancel the meeting with ${ben}` }).click();
    await expect(a.getByText('Meeting cancelled.')).toBeVisible();
    await expect(a.getByText('No meetings yet', { exact: true })).toBeVisible();
    await d.reload();
    await d.getByRole('button', { name: `Accept the meeting with ${cy}` }).click();
    await expect(d.getByText(`Meeting with ${cy} confirmed.`)).toBeVisible();
    await expect(
      d.getByRole('region', { name: 'Your meetings' }).getByText('At Booth 7, table 1'),
    ).toBeVisible();
    await d.goto(`/ar${conf.network}/meetings`);
    await expect(d.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(d);
  });

  test('block and report; the organizer hides and restores; leaving networking', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const conf = await conference(page, 'Net Safety');
    const names = ['Ana', 'Ben', 'Cleo'].map((n) => `${n} ${conf.tag}`);
    const [ana = '', ben = '', cleo = ''] = names;
    await addGuests(page, conf.base, names);
    const [a, b, c] = await Promise.all(names.map((n) => attendee(browser, conf, emailOf(n))));
    if (!a || !b || !c) throw new Error('attendees');
    for (const [p, n] of [
      [a, ana],
      [b, ben],
      [c, cleo],
    ] as const)
      await optIn(p, { name: n });

    // Ana blocks Ben (keyboard: open the disclosure, then the button).
    await a.reload();
    const benHref = (await people(a).getByRole('link', { name: ben }).getAttribute('href')) ?? '';
    await people(a).getByRole('link', { name: ben }).click();
    const summary = a.getByText(`Block or report ${ben}`);
    await summary.focus();
    await a.keyboard.press('Enter');
    await expectAccessible(a);
    await a.getByRole('button', { name: `Block ${ben}` }).click();
    await expect(a.getByText("Blocked. You won't see each other in networking any more.")).toBeVisible();
    await expect(people(a).getByRole('link', { name: ben })).toHaveCount(0);
    await expect(people(a).getByRole('link', { name: cleo })).toBeVisible();
    await b.reload();
    await expect(people(b).getByRole('link', { name: ana })).toHaveCount(0);
    // His page is gone for her (and hers for him).
    expect((await a.request.get(benHref)).status()).toBe(404);
    // Unblock from My profile.
    await tab(a, 'My profile').click();
    await expect(a.getByRole('region', { name: 'People you blocked' }).getByText(ben)).toBeVisible();
    await expectAccessibleBothModes(a);
    await a.getByRole('button', { name: `Unblock ${ben}` }).click();
    await expect(a.getByText(`${ben} is unblocked.`)).toBeVisible();
    await expect(a.getByText("You haven't blocked anyone.")).toBeVisible();

    // Cleo reports Ben: a reason is needed, and details for "Something else".
    await c.reload();
    await people(c).getByRole('link', { name: ben }).click();
    await c.getByText(`Block or report ${ben}`).click();
    await c.getByRole('button', { name: `Report ${ben}` }).click();
    await expect(c.getByText('Choose a reason.')).toBeVisible();
    await c.getByLabel('Reason').selectOption({ label: 'Something else' });
    await c.getByRole('button', { name: `Report ${ben}` }).click();
    await expect(c.getByText('Tell us what happened.')).toBeVisible();
    await c.getByLabel('What happened').fill('Kept pitching after I said no.');
    await c.getByRole('button', { name: `Report ${ben}` }).click();
    await expect(c.getByText('Thanks for telling us.', { exact: false })).toBeVisible();
    await expect(people(c).getByRole('link', { name: ben })).toHaveCount(0);

    // The organizer reviews it and hides Ben.
    await page.goto(conf.console);
    const reports = page.getByRole('list', { name: 'Reports to review' });
    await expect(reports.getByText(`${cleo} reported ${ben}`)).toBeVisible();
    await expect(reports.getByText('Kept pitching after I said no.')).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: `Hide ${ben} from networking` }).click();
    await expect(page.getByText(`${ben} is hidden from networking.`)).toBeVisible();
    await expect(page.getByText('No reports to review.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Hidden people' }).getByText(ben)).toBeVisible();
    // Hidden: gone for everyone, and Ben is told.
    await a.goto(conf.network);
    await expect(people(a).getByRole('link', { name: ben })).toHaveCount(0);
    await b.goto(conf.network);
    await expect(b.getByText('Your profile was hidden by the organizer')).toBeVisible();
    await expectAccessible(b);
    // Restored: back for Ana (still blocked for Cleo, who reported him).
    await page.getByRole('button', { name: `Restore ${ben} to networking` }).click();
    await expect(page.getByText(`${ben} is back in networking.`)).toBeVisible();
    await a.reload();
    await expect(people(a).getByRole('link', { name: ben })).toBeVisible();
    await c.goto(conf.network);
    await expect(people(c).getByRole('link', { name: ben })).toHaveCount(0);

    // Ana leaves networking: back to the opt-in, and gone from Cleo's directory.
    await a.goto(`${conf.network}/profile`);
    await a.getByRole('button', { name: 'Leave networking' }).click();
    await expect(a.getByText("You're not in the directory")).toBeVisible();
    await c.reload();
    await expect(people(c).getByRole('link', { name: ana })).toHaveCount(0);
  });
});
