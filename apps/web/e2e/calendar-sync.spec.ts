import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessible, expectAccessibleBothModes, newUser } from './helpers.ts';

/**
 * M6.5c Google Calendar push, through the real UI against the fake IntegrationAuth port and the
 * fake Calendar API: an organizer connects the org calendar (fake consent), the first sync puts
 * every session on it in the event's time zone, moving a session in the program and syncing
 * updates exactly that entry once, deleting one takes it off. An attendee opts their personal
 * schedule in from "My schedule" (no account), sees it fill, adds a session, updates and stops;
 * a refused consent and an expired link connect nothing. Keyboard only, axe in both themes,
 * Arabic RTL.
 *
 * Setup (a published conference with sessions and free registrants) comes from the dev-only
 * `/api/dev/enrollment`; the fake calendar's entries are read through `/api/dev/integrations/fake`.
 */

const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

interface Fixture {
  slug: string;
  path: string;
  people: { token: string; name: string; email: string }[];
}

interface CalendarEntry {
  summary: string;
  status: 'confirmed' | 'cancelled';
  start: { dateTime: string; timeZone: string };
  writes: number;
}

async function fixture(page: Page, org: string, name: string, people = 1): Promise<Fixture> {
  const res = await page.request.post('/api/dev/enrollment', { form: { org, name, people: String(people) } });
  expect(res.ok()).toBe(true);
  return res.json();
}

/** Run the org's due syncs now (what the worker does). */
async function runSyncs(page: Page, org: string) {
  const res = await page.request.post('/api/dev/integrations/run', { form: { org } });
  expect(res.ok()).toBe(true);
}

/** The fake Google Calendar's entries for one of our connections (deleted ones included). */
async function calendar(page: Page, connection: string): Promise<CalendarEntry[]> {
  const res = await page.request.post('/api/dev/integrations/fake', {
    form: { connection, action: 'calendar' },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { events: CalendarEntry[] }).events;
}

/** Press a control by keyboard (focus, then Enter). */
async function press(control: Locator) {
  await control.focus();
  await control.press('Enter');
}

const panel = (page: Page) => page.getByRole('region', { name: 'Google Calendar' });

test.describe('Google Calendar push (M6.5c)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('org calendar: connect, sessions in the event time zone, a moved session updates once, a deleted one comes off', async ({
    page,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug as string;
    const f = await fixture(page, org, `Calendar Summit ${stamp()}`);

    await page.goto(`/o/${org}/integrations`);
    await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible();
    await expect(page.getByText(/Every session of your live events on a Google Calendar/)).toBeVisible();
    await expectAccessibleBothModes(page);

    // Connect by keyboard through the fake consent screen.
    await press(page.getByRole('button', { name: 'Connect Google Calendar' }));
    await expect(page.getByRole('heading', { name: 'Connect Google Calendar to Yayatoh?' })).toBeVisible();
    await expect(page.getByText('https://www.googleapis.com/auth/calendar.events')).toBeVisible();
    await press(page.getByRole('button', { name: 'Allow' }));
    await expect(
      page.getByText('Google Calendar is connected. The first sync starts shortly.'),
    ).toBeVisible();
    const connection = /\/integrations\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;
    expect(connection).toBeTruthy();
    await expect(page.getByText('Google Calendar (sandbox)')).toBeVisible();
    await expect(page.getByText('Sessions').first()).toBeVisible();
    await expectAccessibleBothModes(page);

    // The first sync: one entry per session, at the event's local time with its zone named.
    await runSyncs(page, org);
    await page.reload();
    const runs = page.getByRole('table', { name: 'Recent syncs of this integration' });
    await expect(runs.getByRole('row').nth(1)).toContainText('6');
    let entries = await calendar(page, connection);
    expect(entries.map((e) => e.summary).sort()).toEqual(
      ['Bonus lab', 'Data workshop', 'Design workshop', 'Opening keynote', 'Track A', 'Track B'].sort(),
    );
    for (const e of entries) {
      expect(e.start.timeZone).toBe('America/Chicago');
      expect(e.start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-0[56]:00$/);
      expect(e.writes).toBe(1);
    }
    const before = entries.find((e) => e.summary === 'Design workshop')?.start.dateTime as string;

    // Move the design workshop an hour later in the program (keyboard), then sync.
    await page.goto(`${f.path}/sessions`);
    const design = page.locator('[data-session="Design workshop"]');
    await press(design.getByText('Edit Design workshop'));
    const starts = design.getByLabel('Session starts');
    const ends = design.getByLabel('Session ends');
    const plusHour = (v: string) => {
      const d = new Date(`${v}:00Z`);
      d.setUTCHours(d.getUTCHours() + 1);
      return d.toISOString().slice(0, 16);
    };
    await starts.fill(plusHour(await starts.inputValue()));
    await ends.fill(plusHour(await ends.inputValue()));
    await press(design.getByRole('button', { name: 'Save session' }));
    await expect(design.getByText('Session saved.')).toBeVisible();

    await page.goto(`/o/${org}/integrations/${connection}`);
    await press(page.getByRole('button', { name: 'Sync now' }));
    await expect(page.getByText('Sync started. Refresh in a moment to see the result.')).toBeVisible();
    await runSyncs(page, org);
    entries = await calendar(page, connection);
    const moved = entries.find((e) => e.summary === 'Design workshop');
    expect(moved?.writes).toBe(2);
    expect(moved?.start.dateTime).not.toBe(before);
    expect(new Date(moved?.start.dateTime as string).getTime() - new Date(before).getTime()).toBe(3_600_000);
    expect(entries.filter((e) => e.summary !== 'Design workshop').every((e) => e.writes === 1)).toBe(true);

    // Syncing again changes nothing.
    await press(page.getByRole('button', { name: 'Sync now' }));
    await runSyncs(page, org);
    expect((await calendar(page, connection)).map((e) => e.writes)).toEqual(entries.map((e) => e.writes));

    // Delete Track B in the program: it comes off the calendar on the next sync.
    await page.goto(`${f.path}/sessions`);
    await page.locator('[data-session="Track B"]').getByText('Edit Track B').click();
    await page.getByRole('button', { name: 'Delete Track B' }).click();
    await expect(page.locator('[data-session="Track B"]')).toHaveCount(0);
    await page.goto(`/o/${org}/integrations/${connection}`);
    await press(page.getByRole('button', { name: 'Sync now' }));
    await runSyncs(page, org);
    entries = await calendar(page, connection);
    expect(entries.find((e) => e.summary === 'Track B')?.status).toBe('cancelled');
    expect(entries.filter((e) => e.status === 'confirmed')).toHaveLength(5);
  });

  test('personal schedule: opt in from My schedule (refused first), it fills, follows an enrolment, updates and stops — by keyboard', async ({
    page,
  }) => {
    const owner = await newUser(page, { org: true, twoFactor: true, signIn: false });
    const org = owner.orgSlug as string;
    const f = await fixture(page, org, `Personal Calendar ${stamp()}`);
    const [me] = f.people;
    if (!me) throw new Error('no registrant');
    await page.goto(`/orders/${me.token}/schedule`);
    const box = panel(page);
    await expect(box.getByText(/Keep this schedule in your Google Calendar/)).toBeVisible();
    await expect(
      box.getByText("We only add this event's sessions to your calendar. We never read your other events."),
    ).toBeVisible();
    await expectAccessibleBothModes(page);

    // Refused at Google: nothing is connected, and the page says so.
    await press(box.getByRole('button', { name: 'Add to Google Calendar' }));
    await expect(page.getByRole('heading', { name: 'Connect Google Calendar to Yayatoh?' })).toBeVisible();
    await press(page.getByRole('button', { name: 'Deny' }));
    await expect(panel(page).getByText("Google Calendar wasn't connected.")).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Add to Google Calendar' })).toBeVisible();

    // Allowed: connected, the first update queued.
    await press(panel(page).getByRole('button', { name: 'Add to Google Calendar' }));
    await press(page.getByRole('button', { name: 'Allow' }));
    await expect(
      panel(page).getByText('Connected. Your sessions appear in your Google Calendar in a moment.'),
    ).toBeVisible();
    await expect(
      panel(page).getByText('Syncing to your Google Calendar. No sessions on it yet.'),
    ).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Update on its way' })).toBeDisabled();
    await expectAccessibleBothModes(page);

    await runSyncs(page, org);
    await page.reload();
    await expect(panel(page).getByText('Syncing to your Google Calendar: 1 session is on it.')).toBeVisible();
    await expect(panel(page).getByText(/^Last updated /)).toBeVisible();

    // Enrol in the data workshop, then Update now: it is on the calendar too.
    await press(page.getByRole('button', { name: 'Enrol in Data workshop' }));
    await expect(page.getByText("You're enrolled in Data workshop.")).toBeVisible();
    await press(panel(page).getByRole('button', { name: 'Update now' }));
    await expect(
      panel(page).getByText('Update on its way. Your calendar changes in a moment.'),
    ).toBeVisible();
    await runSyncs(page, org);
    await page.reload();
    await expect(
      panel(page).getByText('Syncing to your Google Calendar: 2 sessions are on it.'),
    ).toBeVisible();

    // Stop: off at once; sessions stay in their calendar; they can connect again.
    await press(panel(page).getByRole('button', { name: 'Stop syncing' }));
    await expect(
      panel(page).getByText('Syncing stopped. Sessions already in your calendar stay there.'),
    ).toBeVisible();
    await page.reload();
    await expect(
      panel(page).getByText('Syncing is off. Sessions already in your calendar stay there.'),
    ).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Connect again' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a stale or forged callback connects nothing', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true, signIn: false });
    const f = await fixture(page, owner.orgSlug as string, `Calendar Links ${stamp()}`, 2);
    const [me, other] = f.people;
    if (!me || !other) throw new Error('no registrants');
    // A made-up state on this link's callback: "expired", nothing connected.
    const res = await page.request.get(
      `/orders/${me.token}/schedule/calendar/01999999-0000-7000-8000-000000000001?state=${'x'.repeat(32)}`,
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(303);
    expect(res.headers().location).toContain('calendar=expired');
    expect(res.headers()['cache-control']).toBe('no-store');
    // Another order's link cannot see this registrant's calendar panel: the page shows its own.
    await page.goto(`/orders/${other.token}/schedule`);
    await expect(panel(page).getByRole('button', { name: 'Add to Google Calendar' })).toBeVisible();
    await page.goto(`/orders/${me.token}/schedule?calendar=expired#calendar`);
    await expect(panel(page).getByText('That connect link expired. Try again.')).toBeVisible();
  });

  test('renders right-to-left in Arabic', async ({ page }) => {
    const owner = await newUser(page, { org: true, twoFactor: true });
    const org = owner.orgSlug as string;
    const f = await fixture(page, org, `Calendar RTL ${stamp()}`);
    const [me] = f.people;
    if (!me) throw new Error('no registrant');
    await page.goto(`/ar/orders/${me.token}/schedule`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const box = page.getByRole('region', { name: 'تقويم Google' });
    await expect(box.getByRole('button', { name: 'إضافة إلى تقويم Google' })).toBeVisible();
    await expectAccessible(page);
    await page.goto(`/ar/o/${org}/integrations`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText(/كل جلسات فعالياتك الجارية في تقويم Google/)).toBeVisible();
    await expectAccessible(page);
  });
});
