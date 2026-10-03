import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';

/**
 * M5.2b session enrollment and waitlists. The attendee reaches "My schedule" from their order
 * page, enrols by keyboard, is refused an overlapping session (and replaces it), picks exactly one
 * session of a "pick one" group, joins a full session's waitlist and is promoted when someone
 * drops (with the email). The organizer sees places and lines, sets the waitlist behaviour (with
 * validation) and what an admission item gives, and promotes a line by hand; the viewer reads the
 * page and every write is refused; both pages render right-to-left in Arabic.
 *
 * Setup (a published conference with registration, sessions and free registrants) comes from the
 * dev-only `/api/dev/enrollment`; everything tested goes through the real pages.
 */

const ORG = 'lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

interface Fixture {
  slug: string;
  path: string;
  people: { token: string; name: string; email: string }[];
}

async function fixture(page: Page, name: string, people = 1): Promise<Fixture> {
  const res = await page.request.post('/api/dev/enrollment', {
    form: { org: ORG, name, people: String(people) },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function guest(browser: Browser) {
  return (await browser.newContext()).newPage();
}

/** A session's card on "My schedule". */
const card = (page: Page, title: string): Locator =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

/** Press a button by keyboard (focus, then Enter). */
async function press(button: Locator) {
  await button.focus();
  await button.press('Enter');
}

test.describe('session enrollment and waitlists (M5.2b)', () => {
  test('attendee: My schedule from the order page; enrol, overlap refused then replaced, one pick per group — by keyboard', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const f = await fixture(page, `Enrol Summit ${stamp()}`);
    const [me] = f.people;
    if (!me) throw new Error('no registrant');
    await page.goto(`/orders/${me.token}`);
    await press(page.getByRole('link', { name: 'My schedule' }));
    await expect(page).toHaveURL(new RegExp(`/orders/${me.token}/schedule$`));
    await expect(page.getByText('Schedule for Attendee 1')).toBeVisible();
    await expect(card(page, 'Opening keynote')).toContainText('Included in your registration');
    await expect(card(page, 'Opening keynote').getByRole('button')).toHaveCount(0);
    await expect(page.getByText('1 included session · 0 enrolled · 0 waitlists')).toBeVisible();
    await expectAccessible(page);

    // Enrol in the data workshop.
    await press(page.getByRole('button', { name: 'Enrol in Data workshop' }));
    await expect(card(page, 'Data workshop').getByText("You're enrolled in Data workshop.")).toBeVisible();
    await expect(card(page, 'Data workshop').getByText("You're enrolled", { exact: true })).toBeVisible();

    // The design workshop overlaps it: refused with a clear message, "Replace" offered (both have
    // limited places, so no "Keep both").
    const design = card(page, 'Design workshop');
    await press(page.getByRole('button', { name: 'Enrol in Design workshop' }));
    await expect(
      design.getByText("Design workshop overlaps Data workshop, which you're enrolled in."),
    ).toBeVisible();
    await expect(design.getByRole('button', { name: 'Replace Data workshop' })).toBeVisible();
    await expect(design.getByRole('button', { name: 'Keep both' })).toHaveCount(0);
    await expectAccessible(page);

    // Pick one: Track A, then Track B is refused (same group) and replaces Track A on request.
    await press(page.getByRole('button', { name: 'Enrol in Track A' }));
    await expect(card(page, 'Track A').getByText("You're enrolled in Track A.")).toBeVisible();
    const trackB = card(page, 'Track B');
    await press(page.getByRole('button', { name: 'Enrol in Track B' }));
    await expect(
      trackB.getByText(
        'You already picked Track A in “Afternoon track”, and you can pick one session there.',
      ),
    ).toBeVisible();
    await press(trackB.getByRole('button', { name: 'Replace Track A' }));
    await expect(trackB.getByText("You're enrolled in Track B.")).toBeVisible();
    await expect(card(page, 'Track A').getByText('Places available')).toBeVisible();

    // Persisted after a reload; dropping gives the place back.
    await page.reload();
    await expect(card(page, 'Track B').getByText("You're enrolled", { exact: true })).toBeVisible();
    await expect(card(page, 'Data workshop').getByText("You're enrolled", { exact: true })).toBeVisible();
    await expect(page.getByText('1 included session · 2 enrolled · 0 waitlists')).toBeVisible();
    await press(page.getByRole('button', { name: 'Drop Data workshop' }));
    await expect(card(page, 'Data workshop').getByText('You dropped Data workshop.')).toBeVisible();
    await expect(card(page, 'Data workshop').getByText('Places available')).toBeVisible();
  });

  test('attendee: a full session offers its waitlist; a drop promotes the next person (and emails them)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const f = await fixture(page, `Waitlist Summit ${stamp()}`, 3);
    const [first, second] = f.people;
    if (!first || !second) throw new Error('no registrants');
    await page.goto(`/orders/${first.token}/schedule`);
    await press(page.getByRole('button', { name: 'Enrol in Data workshop' }));
    await expect(card(page, 'Data workshop').getByText("You're enrolled in Data workshop.")).toBeVisible();

    const other = await guest(browser);
    await other.goto(`/orders/${second.token}/schedule`);
    const data = card(other, 'Data workshop');
    await expect(data.getByText('Full: you can join the waitlist')).toBeVisible();
    await expect(other.getByRole('button', { name: 'Enrol in Data workshop' })).toHaveCount(0);
    await press(other.getByRole('button', { name: 'Join the waitlist for Data workshop' }));
    await expect(
      data.getByText(
        "You're on the waitlist for Data workshop: number 1 in line. If a place opens, we'll email you.",
      ),
    ).toBeVisible();
    await expect(data.getByText('Waitlist: number 1 in line')).toBeVisible();
    await expectAccessible(other);

    // The first person drops: the second is enrolled at once (auto mode, the P5-9 default).
    await press(page.getByRole('button', { name: 'Drop Data workshop' }));
    await expect(card(page, 'Data workshop').getByText('You dropped Data workshop.')).toBeVisible();
    await other.reload();
    await expect(card(other, 'Data workshop').getByText("You're enrolled", { exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Drop Data workshop' })).toBeVisible();
    // …and hears it by email, with the link back to their schedule.
    await expect
      .poll(async () => {
        await other.request.post('/api/dev/outbox/drain', { form: { org: ORG } });
        const res = await other.request.get(`/api/dev/mailbox?to=${encodeURIComponent(second.email)}`);
        const mails = (await res.json()) as { subject: string; text: string }[];
        return mails.find((m) => m.subject.includes('Data workshop'))?.text ?? '';
      })
      .toContain(`/orders/${second.token}/schedule`);
    await other.close();
  });

  test('organizer: places and lines, waitlist setting with validation, what an item gives, promote now — by keyboard', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const f = await fixture(page, `Organizer Summit ${stamp()}`, 2);
    await page.goto(`${f.path}/registration`);
    await press(page.getByRole('link', { name: 'Session enrollment and waitlists' }));
    await expect(page).toHaveURL(new RegExp(`${f.path}/registration/enrollment$`));
    await expect(page.getByRole('heading', { name: 'Session enrollment', level: 1 })).toBeVisible();
    const lab = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Bonus lab' }) });
    await expect(lab).toContainText('1 of 2 places taken');
    await expect(lab).toContainText('Waitlist: 1 waiting, 0 offered');
    await expect(lab).toContainText('Waitlist promotes until');
    const track = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Track A' }) });
    await expect(track).toContainText('Pick one: Afternoon track');
    await expect(track).toContainText('Nobody on the waitlist');
    // Included sessions are not listed here.
    await expect(page.getByRole('heading', { name: 'Opening keynote' })).toHaveCount(0);
    await expectAccessible(page);

    // Promote now (the capacity was raised while someone waited).
    await press(page.getByRole('button', { name: 'Promote now: Bonus lab' }));
    await expect(lab.getByText('1 person promoted from the waitlist.')).toBeVisible();
    await expect(lab).toContainText('2 of 2 places taken');
    await expect(lab).toContainText('Nobody on the waitlist');
    await expect(lab.getByRole('button', { name: 'Promote now: Bonus lab' })).toHaveCount(0);

    // The waitlist setting: a bad window is refused with its message; a good one is saved.
    const settings = page.getByRole('region', { name: 'When a place frees up' });
    await settings.getByLabel('Waitlist promotion').selectOption('offer');
    await settings.getByLabel('Offer window (minutes)').fill('5');
    await press(settings.getByRole('button', { name: 'Save waitlist setting' }));
    await expect(settings.getByText('Enter a number of minutes from 15 to 2,880.')).toBeVisible();
    await settings.getByLabel('Offer window (minutes)').fill('90');
    await press(settings.getByRole('button', { name: 'Save waitlist setting' }));
    await expect(settings.getByText('Saved.')).toBeVisible();

    // What the day pass gives: only the data workshop.
    const items = page.getByRole('region', { name: 'Sessions each admission item gives' });
    const day = items.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Day pass' }) });
    await expect(day).toContainText('Gives every session');
    const summary = day.getByText('Choose sessions for Day pass');
    await summary.focus();
    await summary.press('Enter');
    const box = day.getByRole('checkbox', { name: /^Data workshop/ });
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await press(day.getByRole('button', { name: 'Save sessions for Day pass' }));
    await expect(day.getByText('Saved.')).toBeVisible();

    // Persisted after a reload.
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'When a place frees up' }).getByLabel('Waitlist promotion'),
    ).toHaveValue('offer');
    await expect(
      page.getByRole('region', { name: 'When a place frees up' }).getByLabel('Offer window (minutes)'),
    ).toHaveValue('90');
    await expect(
      page
        .getByRole('region', { name: 'Sessions each admission item gives' })
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Day pass' }) }),
    ).toContainText('Gives 1 session');
    await expectAccessible(page);
  });

  test('organizer: an event without optional sessions shows what to do next', async ({ page }) => {
    await signIn(page);
    await page.goto('/o/lakeside-events/events/new');
    const name = `Empty Summit ${stamp()}`;
    await page.getByLabel('Event name', { exact: true }).fill(name);
    await page.getByLabel('Event type').selectOption('conference');
    await page.getByLabel('Time zone').selectOption('America/Chicago');
    const d = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Starts', { exact: true }).fill(`${d}T09:00`);
    await page.getByLabel('Ends', { exact: true }).fill(`${d}T18:00`);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/[a-z0-9-]+$/);
    const base = new URL(page.url()).pathname;
    await page.goto(`${base}/registration/enrollment`);
    await expect(page.getByText('No optional sessions yet', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Sessions' })).toHaveAttribute(
      'href',
      `${base}/sessions`,
    );
    await expectAccessible(page);
  });

  test('viewer: reads the enrollment page; every organizer write is refused', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const f = await fixture(page, `Viewer Summit ${stamp()}`, 2);
    const viewer = await guest(browser);
    await signIn(viewer, VIEWER);
    await viewer.goto(`${f.path}/registration/enrollment`);
    await expect(
      viewer.getByText('You can view enrollment. Only people who can edit the event can change it.'),
    ).toBeVisible();
    await expect(viewer.getByRole('button', { name: /^Promote now/ })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^Save / })).toHaveCount(0);
    await expect(viewer.getByText('Enrol the next person automatically')).toBeVisible();
    await expectAccessible(viewer);
    await viewer.close();

    // The owner's open forms, submitted as the viewer: refused by the server.
    await page.goto(`${f.path}/registration/enrollment`);
    const promote = page.getByRole('button', { name: 'Promote now: Bonus lab' });
    await expect(promote).toBeVisible();
    await signIn(page, VIEWER);
    await promote.click();
    await expect(page.getByText("You don't have access to this.")).toBeVisible();
    const settings = page.getByRole('region', { name: 'When a place frees up' });
    await settings.getByRole('button', { name: 'Save waitlist setting' }).click();
    await expect(settings.getByText("You don't have access to this.")).toBeVisible();
  });

  test('Arabic: My schedule and the enrollment page render right-to-left', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    const f = await fixture(page, `RTL Summit ${stamp()}`);
    const [me] = f.people;
    if (!me) throw new Error('no registrant');
    await page.goto(`/ar/orders/${me.token}/schedule`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'سجّلني في Data workshop' }).click();
    await expect(page.getByText('أنت مسجَّل في Data workshop.')).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar${f.path}/registration/enrollment`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'التسجيل في الجلسات', level: 1 })).toBeVisible();
    await expectAccessible(page);
  });

  test('a wrong link shows nothing', async ({ page }) => {
    const res = await page.goto(`/orders/${'x'.repeat(43)}/schedule`);
    expect(res?.status()).toBe(404);
  });
});
