import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

const VIEWER = 'jordan@lakeside.test';
const ORG = '/o/lakeside-events';
const TZ = 'America/Chicago';

const stamp = () => `${Date.now()}${test.info().project.name.replace(/\D/g, '')}`;

/** `YYYY-MM-DD` in Chicago, `days` from today. */
function chicagoDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}
/** A datetime-local value: the Chicago date `days` from today at `hhmm`. */
const at = (days: number, hhmm: string) => `${chicagoDate(days)}T${hhmm}`;
/** How the agenda titles a day ("Wednesday, October 28"). */
const dayHeading = (days: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${chicagoDate(days)}T00:00:00Z`));

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** A conference (by default) from day 40 09:00 to day 42 18:00 in Chicago, via the one-page form. */
async function createEvent(page: Page, name: string, opts: { profile?: string; publish?: boolean } = {}) {
  await page.goto(`${ORG}/events/new`);
  await page.getByLabel('Event name', { exact: true }).fill(name);
  await page.getByLabel('Event type').selectOption(opts.profile ?? 'conference');
  await page.getByLabel('Time zone').selectOption(TZ);
  await page.getByLabel('Starts', { exact: true }).fill(at(40, '09:00'));
  await page.getByLabel('Ends', { exact: true }).fill(at(42, '18:00'));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  if (opts.publish) {
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published ·')).toBeVisible();
  }
  return { base, slug: base.split('/').pop() ?? '' };
}

async function addRoom(page: Page, name: string) {
  const rooms = page.getByRole('region', { name: 'Rooms' });
  await rooms.getByLabel('Room name').fill(name);
  await rooms.getByRole('button', { name: 'Add room' }).click();
  await expect(rooms.getByText('Room added.')).toBeVisible();
}

async function addSession(
  page: Page,
  s: { title: string; from: string; to: string; room?: string; speakers?: string[] },
) {
  const add = page.getByRole('region', { name: 'Add session' });
  await add.getByLabel('Session title').fill(s.title);
  await add.getByLabel('Session starts').fill(s.from);
  await add.getByLabel('Session ends').fill(s.to);
  if (s.room) await add.getByLabel('Room', { exact: true }).selectOption({ label: s.room });
  for (const p of s.speakers ?? []) await add.getByRole('checkbox', { name: p }).check();
  await add.getByRole('button', { name: 'Add session' }).click();
  await expect(add.getByText('Session added.')).toBeVisible();
  return add;
}

async function addSpeaker(
  page: Page,
  base: string,
  name: string,
  extra: { bio?: string; links?: string } = {},
) {
  await page.goto(`${base}/speakers`);
  const add = page.getByRole('region', { name: 'Add speaker' });
  await add.getByLabel('Speaker name').fill(name);
  if (extra.bio) await add.getByLabel('Bio').fill(extra.bio);
  if (extra.links) await add.getByLabel('Links').fill(extra.links);
  await add.getByRole('button', { name: 'Add speaker' }).click();
  await expect(add.getByText('Speaker added.')).toBeVisible();
}

async function guestPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test.describe('program: sessions, speakers, exhibitors and sponsors (M1.4f)', () => {
  test('sessions: rooms and tracks, every validation, a room conflict warning, edit and delete', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await createEvent(page, `Program Summit ${s}`);
    // The conference profile lists the four program pages (no code per profile). Narrow
    // viewports keep the sidebar in a menu; the URLs are checked in every project below.
    if (test.info().project.name === 'desktop-1280')
      for (const name of ['Sessions', 'Speakers', 'Exhibitors', 'Sponsors'])
        await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1);

    await page.goto(`${base}/sessions`);
    await expect(page.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();
    await expect(page.getByText('No sessions yet')).toBeVisible();
    await expectAccessible(page);
    await noHorizontalScroll(page);

    await addRoom(page, 'Main hall');
    const rooms = page.getByRole('region', { name: 'Rooms' });
    await rooms.getByLabel('Room name').fill('MAIN HALL');
    await rooms.getByRole('button', { name: 'Add room' }).click();
    await expect(rooms.getByText('That name is already used for this event.')).toBeVisible();
    await rooms.getByLabel('Room name').fill('');
    await rooms.getByRole('button', { name: 'Add room' }).click();
    await expect(rooms.getByText('Enter a name.')).toBeVisible();
    const tracks = page.getByRole('region', { name: 'Tracks' });
    await tracks.getByLabel('Track name').fill('Leadership');
    await tracks.getByRole('button', { name: 'Add track' }).click();
    await expect(tracks.getByText('Track added.')).toBeVisible();

    // Blank: every missing field is named; typed values survive a rejected submit.
    const add = page.getByRole('region', { name: 'Add session' });
    await add.getByRole('button', { name: 'Add session' }).click();
    await expect(add.getByText('Enter a title (up to 160 characters).')).toBeVisible();
    await expect(add.getByText('Enter when the session starts.')).toBeVisible();
    await expect(add.getByText('The session must end after it starts.')).toBeVisible();
    await expect(add.getByLabel('Session title')).toHaveAttribute('aria-invalid', 'true');
    await expectAccessible(page);
    // Ends before it starts.
    await add.getByLabel('Session title').fill('Opening keynote');
    await add.getByLabel('Session starts').fill(at(40, '10:00'));
    await add.getByLabel('Session ends').fill(at(40, '09:30'));
    await add.getByRole('button', { name: 'Add session' }).click();
    await expect(add.getByText('The session must end after it starts.')).toBeVisible();
    await expect(add.getByLabel('Session title')).toHaveValue('Opening keynote');
    await add.getByLabel('Session ends').fill(at(40, '11:00'));
    await add.getByLabel('Room', { exact: true }).selectOption({ label: 'Main hall' });
    await add.getByLabel('Track', { exact: true }).selectOption({ label: 'Leadership' });
    await add.getByRole('button', { name: 'Add session' }).click();
    await expect(add.getByText('Session added.')).toBeVisible();

    // Same room, overlapping: saved, with a warning naming the other session.
    await addSession(page, { title: 'Panel', from: at(40, '10:30'), to: at(40, '11:30'), room: 'Main hall' });
    await expect(add.getByText('Main hall is also booked for “Opening keynote” at this time.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '1 scheduling conflict' })).toBeVisible();
    const panel = page.locator('[data-session="Panel"]');
    await expect(panel.getByText('Conflict', { exact: true })).toBeVisible();
    await expect(panel.getByText('Main hall · Leadership')).toHaveCount(0);
    await expect(
      page.locator('[data-session="Opening keynote"]').getByText('Main hall · Leadership'),
    ).toBeVisible();
    await expectAccessible(page);

    // Keyboard only: open the editor, move the panel after the keynote, save with Enter.
    await panel.getByText('Edit Panel').focus();
    await page.keyboard.press('Enter');
    const starts = panel.getByLabel('Session starts');
    await starts.focus();
    await starts.fill(at(40, '11:00'));
    await panel.getByLabel('Session ends').fill(at(40, '12:00'));
    await panel.getByRole('button', { name: 'Save session' }).focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByText('Session saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /scheduling conflict/ })).toHaveCount(0);
    await expect(page.getByText('Conflict', { exact: true })).toHaveCount(0);

    // Delete.
    await page.locator('[data-session="Panel"]').getByText('Edit Panel').click();
    await page.getByRole('button', { name: 'Delete Panel' }).click();
    await expect(page.locator('[data-session="Panel"]')).toHaveCount(0);
    await expect(page.locator('[data-session="Opening keynote"]')).toBeVisible();
    // Deleting the room keeps the session.
    await page
      .getByRole('region', { name: 'Rooms' })
      .getByRole('button', { name: 'Delete Main hall' })
      .click();
    await expect(page.getByRole('region', { name: 'Rooms' }).getByText('No rooms yet.')).toBeVisible();
    await expect(
      page.locator('[data-session="Opening keynote"] p').getByText('Leadership', { exact: true }),
    ).toBeVisible();
  });

  test('the public agenda groups sessions by day in the event timezone and links speakers', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Agenda Days ${s}`, { publish: true });
    await addSpeaker(page, base, `Ada ${s}`, { bio: 'Math **pioneer**.' });
    await page.goto(`${base}/sessions`);
    await addRoom(page, 'Studio');
    await addSession(page, { title: 'Day two breakfast', from: at(41, '08:00'), to: at(41, '09:00') });
    // 23:30 in Chicago is already the next day in UTC: it must stay on day one.
    await addSession(page, {
      title: 'Late session',
      from: at(40, '23:30'),
      to: at(40, '23:59'),
      room: 'Studio',
    });
    await addSession(page, {
      title: 'Opening',
      from: at(40, '09:00'),
      to: at(40, '10:00'),
      speakers: [`Ada ${s}`],
    });

    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    const agenda = guest.getByRole('region', { name: 'Agenda' });
    await expect(agenda).toBeVisible();
    const day1 = agenda.getByRole('region', { name: dayHeading(40) });
    const day2 = agenda.getByRole('region', { name: dayHeading(41) });
    await expect(day1.getByRole('listitem')).toHaveCount(2);
    await expect(day1.getByRole('listitem').first()).toContainText('Opening');
    await expect(day1.getByRole('listitem').last()).toContainText('Late session');
    await expect(day1.getByText('Studio')).toBeVisible();
    await expect(day2.getByText('Day two breakfast')).toBeVisible();
    // Real counts replace the demo stats: 3 sessions, 1 speaker.
    await expect(guest.getByText('sessions', { exact: true })).toBeVisible();
    await expect(guest.getByText('speakers', { exact: true })).toBeVisible();
    await expect(guest.getByText('Times are in America/Chicago.').first()).toBeVisible();
    await expectAccessible(guest);
    await noHorizontalScroll(guest);
    // No exhibitors or sponsors yet: those sections don't render.
    await expect(guest.getByRole('heading', { name: 'Exhibitors' })).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: 'Sponsors' })).toHaveCount(0);

    // Keyboard: the speaker link in the agenda opens the speaker page.
    const link = day1.getByRole('link', { name: `Ada ${s}` });
    await link.focus();
    await guest.keyboard.press('Enter');
    await expect(guest).toHaveURL(new RegExp(`/events/${slug}/speakers/`));
    await expect(guest.getByRole('heading', { name: `Ada ${s}`, level: 1 })).toBeVisible();
    await expect(guest.locator('strong').filter({ hasText: 'pioneer' })).toBeVisible();
    await expect(guest.getByRole('region', { name: 'Sessions' }).getByText('Opening')).toBeVisible();
    await expectAccessible(guest);
    await guest.getByRole('link', { name: `Back to Agenda Days ${s}` }).click();
    await expect(guest).toHaveURL(new RegExp(`/events/${slug}#speakers$`));
    // An unknown speaker is a 404.
    const res = await guest.goto(`/events/${slug}/speakers/00000000-0000-7000-8000-000000000000`);
    expect(res?.status()).toBe(404);
  });

  test('speakers: validation, edit, links and the public speakers section', async ({ page, browser }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Speakers Expo ${s}`, { publish: true });
    await page.goto(`${base}/speakers`);
    await expect(page.getByText('No speakers yet')).toBeVisible();
    await expectAccessible(page);
    const add = page.getByRole('region', { name: 'Add speaker' });
    await add.getByRole('button', { name: 'Add speaker' }).click();
    await expect(add.getByText('Enter a name.')).toBeVisible();
    await add.getByLabel('Speaker name').fill('Grace Hopper');
    await add.getByLabel('Job title').fill('Rear Admiral');
    await add.getByLabel('Company').fill('US Navy');
    await add.getByLabel('Links').fill('Site javascript:alert(1)');
    await add.getByRole('button', { name: 'Add speaker' }).click();
    await expect(add.getByText('Write each link as Label | https://… on its own line.')).toBeVisible();
    await add.getByLabel('Links').fill('Site | javascript:alert(1)');
    await add.getByRole('button', { name: 'Add speaker' }).click();
    await expect(add.getByText('Write each link as Label | https://… on its own line.')).toBeVisible();
    await add.getByLabel('Links').fill('Website | https://example.com/grace');
    await add.getByLabel('Bio').fill('Wrote the first **compiler**. <script>alert(1)</script>');
    await add.getByRole('button', { name: 'Add speaker' }).click();
    await expect(add.getByText('Speaker added.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '1 speaker' })).toBeVisible();
    await expect(page.getByText('Rear Admiral · US Navy · no sessions')).toBeVisible();

    // Edit.
    await page.getByText('Edit Grace Hopper').click();
    const edit = page.locator('details[open]');
    await edit.getByLabel('Company').fill('Navy');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Rear Admiral · Navy · no sessions')).toBeVisible();
    await expectAccessible(page);

    // Public: the section and the speaker page (sanitized bio, safe link).
    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    const section = guest.getByRole('region', { name: 'Speakers' });
    await expect(section.getByText('Rear Admiral · Navy')).toBeVisible();
    await section.getByRole('link', { name: 'Grace Hopper' }).click();
    await expect(guest.getByRole('heading', { name: 'Grace Hopper', level: 1 })).toBeVisible();
    await expect(guest.getByText('<script>alert(1)</script>', { exact: false })).toBeVisible();
    await expect(guest.locator('script:not([src]):not([type])').filter({ hasText: 'alert(1)' })).toHaveCount(
      0,
    );
    await expect(guest.getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      'https://example.com/grace',
    );
    await expect(guest.getByText('No sessions announced yet.')).toBeVisible();
    await expectAccessible(guest);

    // Delete: the public section disappears (only rendered with content).
    await page.getByText('Edit Grace Hopper').click();
    await page.getByRole('button', { name: 'Delete Grace Hopper' }).click();
    await expect(page.getByText('No speakers yet')).toBeVisible();
    await guest.goto(`/events/${slug}`);
    await expect(guest.getByRole('region', { name: 'Speakers' })).toHaveCount(0);
  });

  test('exhibitors and sponsors: validation, tiers in order, a tier in use, public sections', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `Expo Hall ${s}`, { publish: true });
    await page.goto(`${base}/exhibitors`);
    await expect(page.getByText('No exhibitors yet')).toBeVisible();
    await expectAccessible(page);
    const ex = page.getByRole('region', { name: 'Add exhibitor' });
    await ex.getByLabel('Exhibitor name').fill('Acme Robotics');
    await ex.getByLabel('Booth').fill('B12');
    await ex.getByLabel('Website').fill('ftp://acme.test');
    await ex.getByRole('button', { name: 'Add exhibitor' }).click();
    await expect(ex.getByText('Enter a web address that starts with https:// or http://.')).toBeVisible();
    await ex.getByLabel('Website').fill('https://acme.test');
    await ex.getByRole('button', { name: 'Add exhibitor' }).click();
    await expect(ex.getByText('Exhibitor added.')).toBeVisible();
    await expect(page.getByText('Booth B12 · https://acme.test')).toBeVisible();

    await page.goto(`${base}/sponsors`);
    await expect(page.getByText('No sponsor tiers yet')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Add sponsor' })).toHaveCount(0);
    await expectAccessible(page);
    const tier = page.getByRole('region', { name: 'Add tier' });
    await tier.getByLabel('Tier name').fill('Silver');
    await tier.getByLabel('Order').fill('0');
    await tier.getByRole('button', { name: 'Add tier' }).click();
    await expect(tier.getByText('Enter an order from 1 to 99.')).toBeVisible();
    await tier.getByLabel('Order').fill('2');
    await tier.getByRole('button', { name: 'Add tier' }).click();
    await expect(tier.getByText('Tier added.')).toBeVisible();
    await tier.getByLabel('Tier name').fill('Gold');
    await tier.getByLabel('Order').fill('1');
    await tier.getByRole('button', { name: 'Add tier' }).click();
    await expect(tier.getByText('Tier added.')).toBeVisible();
    await tier.getByLabel('Tier name').fill('gold');
    await tier.getByLabel('Order').fill('3');
    await tier.getByRole('button', { name: 'Add tier' }).click();
    await expect(tier.getByText('That name is already used for this event.')).toBeVisible();
    const tiers = page.getByRole('region', { name: 'Sponsor tiers' });
    await expect(tiers.getByRole('heading', { level: 3 }).first()).toContainText('Gold');

    const sp = page.getByRole('region', { name: 'Add sponsor' });
    await sp.getByLabel('Tier').selectOption({ label: 'Gold' });
    await sp.getByLabel('Sponsor name').fill('Initech');
    await sp.getByLabel('Website').fill('https://initech.test');
    await sp.getByRole('button', { name: 'Add sponsor' }).click();
    await expect(sp.getByText('Sponsor added.')).toBeVisible();
    // A tier with sponsors can't be deleted.
    await tiers.getByRole('button', { name: 'Delete Gold' }).click();
    await expect(tiers.getByText("Move or delete this tier's sponsors first.")).toBeVisible();
    await expectAccessible(page);
    await tiers.getByRole('button', { name: 'Delete Silver' }).click();
    await expect(tiers.getByRole('button', { name: 'Delete Silver' })).toHaveCount(0);

    const guest = await guestPage(browser);
    await guest.goto(`/events/${slug}`);
    const exhibitors = guest.getByRole('region', { name: 'Exhibitors' });
    await expect(exhibitors.getByText('Acme Robotics', { exact: true })).toBeVisible();
    await expect(exhibitors.getByText('Booth B12')).toBeVisible();
    await expect(exhibitors.getByRole('link', { name: 'Acme Robotics website' })).toHaveAttribute(
      'href',
      'https://acme.test',
    );
    const sponsors = guest.getByRole('region', { name: 'Sponsors' });
    await expect(
      sponsors.getByRole('region', { name: 'Gold' }).getByRole('link', { name: 'Initech' }),
    ).toBeVisible();
    // Real counts replace the demo stats.
    await expect(guest.getByText('exhibitors', { exact: true })).toBeVisible();
    await expectAccessible(guest);
    await noHorizontalScroll(guest);
  });

  test('profiles decide: a concert has no program pages (nav hidden, URLs 404)', async ({ page }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await createEvent(page, `Concert Night ${s}`, { profile: 'concert' });
    for (const name of ['Sessions', 'Speakers', 'Exhibitors', 'Sponsors'])
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
    for (const path of ['sessions', 'speakers', 'exhibitors', 'sponsors']) {
      const res = await page.goto(`${base}/${path}`);
      expect(res?.status()).toBe(404);
    }
  });

  test('a viewer reads the program but cannot change it, and a stale form is refused', async ({
    page,
    browser,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base } = await createEvent(page, `Viewer Program ${s}`);
    await page.goto(`${base}/sessions`);
    await addSession(page, { title: 'Visible keynote', from: at(40, '10:00'), to: at(40, '11:00') });

    const viewer = await guestPage(browser);
    await signIn(viewer, VIEWER);
    for (const path of ['sessions', 'speakers', 'exhibitors', 'sponsors']) {
      await viewer.goto(`${base}/${path}`);
      await expect(
        viewer.getByText('You can view the program. Only organizers with edit rights can change it.'),
      ).toBeVisible();
      await expect(viewer.getByRole('button', { name: /^Add / })).toHaveCount(0);
      await expect(viewer.getByText(/^Edit /)).toHaveCount(0);
      await expectAccessible(viewer);
    }
    await viewer.goto(`${base}/sessions`);
    await expect(viewer.getByText('Visible keynote')).toBeVisible();
    await expect(viewer.getByRole('button', { name: /^Delete / })).toHaveCount(0);

    // The owner's open form, submitted as the viewer: refused by the server.
    const add = page.getByRole('region', { name: 'Add session' });
    await add.getByLabel('Session title').fill('Sneaky');
    await add.getByLabel('Session starts').fill(at(40, '12:00'));
    await add.getByLabel('Session ends').fill(at(40, '13:00'));
    await signIn(page, VIEWER);
    await add.getByRole('button', { name: 'Add session' }).click();
    await expect(add.getByRole('alert').filter({ hasText: "You don't have access to this." })).toBeVisible();
  });

  test('Arabic: program pages, the public sections and a speaker page render right-to-left', async ({
    page,
  }) => {
    const s = stamp();
    await signIn(page);
    const { base, slug } = await createEvent(page, `RTL Program ${s}`, { publish: true });
    await addSpeaker(page, base, `Layla ${s}`);
    await page.goto(`${base}/sessions`);
    await addSession(page, {
      title: 'Keynote',
      from: at(40, '10:00'),
      to: at(40, '11:00'),
      speakers: [`Layla ${s}`],
    });
    for (const path of [
      `/ar${base}/sessions`,
      `/ar${base}/speakers`,
      `/ar${base}/exhibitors`,
      `/ar${base}/sponsors`,
      `/ar${base}/setup-guide`,
      `/ar/events/${slug}`,
    ]) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectAccessible(page);
      await noHorizontalScroll(page);
    }
    await page
      .getByRole('link', { name: `Layla ${s}` })
      .first()
      .click();
    await expect(page).toHaveURL(/\/ar\/events\/.+\/speakers\//);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectAccessible(page);
  });
});
