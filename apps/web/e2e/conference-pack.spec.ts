import { type Browser, expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type ConferenceScenario, conferenceScenario } from '@yayatoh/testing';
import { expectAccessibleBothModes, newUser } from './helpers.ts';

/**
 * M5.9a conference Command Center pack: the acceptance on the real board ("3 sessions are over
 * 95 % capacity" and "5 exhibitors have no leads", each clearing when fixed), the four tiles
 * (session rooms live, session fill, exhibitors, sponsors) with their numbers, the pack's alerts
 * on the alerts page with their fixing pages, keyboard-only paths, the door role (attendance and
 * stations only: no other tile, refused directly), empty states, light and dark, and Arabic RTL.
 * Each test builds its own org and conference (unique per project and run).
 */

const kms = process.env.LOCAL_KMS_KEY;
if (kms) setKeyVault(localKeyVault(kms));

test.afterAll(async () => {
  await closePools();
});

const SESSIONS_ALERT = 'Three sessions are over 95 % capacity';
const LEADS_ALERT = 'Five exhibitors have no leads';
const PACK_ALERTS = [
  SESSIONS_ALERT,
  LEADS_ALERT,
  'One session has a long waiting line',
  'One session has more places held than its room seats',
  'Four exhibitors have no booth staff invited',
  'One speaker task is overdue',
  'Two sponsor deliverables are overdue',
  'Two badge printers or kiosks are offline',
  'One application is waiting for a decision',
  'One invoice is overdue',
];

/** A fresh org (owner signed in on `page`) holding the M5.9a fixture, its fakes on this server. */
async function conference(page: Page): Promise<{ slug: string; base: string; s: ConferenceScenario }> {
  const owner = await newUser(page, { org: true, twoFactor: true, event: 'published' });
  const slug = owner.orgSlug as string;
  const org = await resolveOrgSlug(slug);
  if (!org) throw new Error(`no org ${slug}`);
  const s = await conferenceScenario(org.orgId, { withoutFakes: true });
  await setFakes(page, slug, s);
  return { slug, base: `/o/${slug}/e/${s.eventSlug}`, s };
}

/** The web server's fake leads, deliverables and printers for the event; re-evaluates its alerts. */
async function setFakes(page: Page, slug: string, s: ConferenceScenario) {
  const res = await page.request.post('/api/dev/conference', {
    form: {
      org: slug,
      event: s.eventId,
      leads: JSON.stringify(s.fake.leads),
      deliverables: String(s.fake.deliverables),
      printers: String(s.fake.printers),
    },
  });
  expect(res.status()).toBe(200);
}

const alertsTile = (page: Page) => page.getByTestId('cc-widget-alerts');

async function openBoard(page: Page, base: string) {
  await page.goto(`${base}/command-center`);
  await expect(page.getByRole('heading', { level: 1, name: 'Command Center' })).toBeVisible();
  await expect(page.getByTestId('command-center')).toHaveAttribute('data-mode', 'live');
}

test.describe('conference Command Center pack (M5.9a)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('acceptance: 3 sessions over 95 % and 5 exhibitors without leads, each clearing when fixed; the tiles', async ({
    page,
  }) => {
    const { slug, base, s } = await conference(page);
    await openBoard(page, base);
    const tile = alertsTile(page);
    await expect(tile.getByRole('link', { name: SESSIONS_ALERT, exact: true })).toBeVisible();
    await expect(tile.getByRole('link', { name: LEADS_ALERT, exact: true })).toBeVisible();

    // Session rooms live: the keynote runs with three people in its room; the kiosk is quiet.
    const rooms = page.getByTestId('cc-session-attendance');
    await expect(rooms).toContainText('1 session running');
    await expect(rooms).toContainText('1 kiosk offline');
    const keynote = rooms.getByRole('row').filter({ hasText: 'Opening keynote' });
    await expect(keynote.getByRole('cell').first()).toHaveText('3');
    await expect(keynote).toHaveAttribute('data-running', 'true');
    await expect(rooms.getByRole('row').filter({ hasText: 'Data workshop' })).toHaveAttribute(
      'data-running',
      'false',
    );
    // Session fill, exhibitors and sponsors.
    await expect(page.getByTestId('cc-session-fill-near')).toHaveText('3 of 5 sessions are 95% full or more');
    const fill = page.getByTestId('cc-session-fill');
    await expect(fill).toContainText('1 full');
    await expect(fill).toContainText('12 people waiting');
    await expect(fill).toContainText('1 line over 10');
    await expect(fill).toContainText('1 in a room too small');
    await expect(fill.getByRole('row').filter({ hasText: 'City panel' })).toContainText('60 of 60');
    await expect(fill.getByRole('row').filter({ hasText: 'Robotics lab' })).toContainText('Room too small');
    const exhibitors = page.getByTestId('cc-exhibitor-activity');
    await expect(exhibitors).toContainText('3 of 7 exhibitors have booth staff');
    await expect(page.getByTestId('cc-exhibitor-leads')).toContainText(
      '7 leads · 5 exhibitors without leads',
    );
    const sponsors = page.getByTestId('cc-sponsor-activity');
    await expect(sponsors).toContainText('2 sponsors');
    await expect(sponsors).toContainText('2 deliverables overdue');
    // No money anywhere on the pack's tiles.
    for (const id of [
      'cc-session-attendance',
      'cc-session-fill',
      'cc-exhibitor-activity',
      'cc-sponsor-activity',
    ])
      await expect(page.getByTestId(id)).not.toContainText('$');
    await expectAccessibleBothModes(page);

    // Fixed: more places in the three nearly full sessions (the organizer's update), and a lead each.
    await s.addPlaces();
    await setFakes(page, slug, s);
    await page.reload();
    await expect(tile.getByRole('link', { name: LEADS_ALERT, exact: true })).toBeVisible();
    await expect(tile.getByRole('link', { name: SESSIONS_ALERT, exact: true })).toHaveCount(0);
    await expect(page.getByTestId('cc-session-fill-near')).toHaveText('0 of 5 sessions are 95% full or more');
    await s.recordLeads();
    await setFakes(page, slug, s);
    await page.reload();
    await expect(tile.getByRole('link', { name: LEADS_ALERT, exact: true })).toHaveCount(0);
    await expect(page.getByTestId('cc-exhibitor-leads')).toContainText('12 leads');
    await expect(page.getByTestId('cc-exhibitor-leads')).not.toContainText('without leads');
  });

  test('the alerts page lists every pack alert with its fixing page; keyboard to the fix; Arabic RTL', async ({
    page,
  }) => {
    const { slug, base } = await conference(page);
    await page.goto(`/o/${slug}/alerts`);
    await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible();
    const titles = await page.getByRole('main').getByRole('heading', { level: 2 }).allInnerTexts();
    for (const t of PACK_ALERTS) expect(titles).toContain(t);
    await expectAccessibleBothModes(page);

    // Keyboard only, from the board: focus the sessions alert and press Enter → the sessions page.
    await openBoard(page, base);
    const link = alertsTile(page).getByRole('link', { name: SESSIONS_ALERT, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${base}/sessions$`));
    // The tiles' own links: session enrollment from the fill tile.
    await openBoard(page, base);
    const enrollment = page
      .getByTestId('cc-session-fill')
      .getByRole('link', { name: 'Open session enrollment' });
    await enrollment.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${base}/registration/enrollment$`));

    // Arabic, right to left: the same board and alerts in Arabic.
    await page.goto(`/ar${base}/command-center`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(alertsTile(page)).toContainText('تجاوزت 95 % من سعتها');
    await expect(page.getByTestId('cc-widget-sessionFill')).toContainText('امتلاء الجلسات');
    await expectAccessibleBothModes(page);
  });

  test('the door sees session rooms and the stations alert only; the other tiles are refused directly', async ({
    page,
    browser,
  }) => {
    const { slug, base, s } = await conference(page);
    const door = await doorStaff(page, browser, slug, base, `Dina Door ${Date.now()}`);
    await openBoard(door, base);
    await expect(door.getByTestId('command-center')).toHaveAttribute('data-role', 'door');
    await expect(door.getByTestId('cc-widget-sessionAttendance')).toBeVisible();
    for (const k of ['sessionFill', 'exhibitorActivity', 'sponsorActivity', 'sales'])
      await expect(door.getByTestId(`cc-widget-${k}`)).toHaveCount(0);
    const tile = alertsTile(door);
    await expect(tile.getByRole('link', { name: 'Two badge printers or kiosks are offline' })).toBeVisible();
    for (const t of ['One invoice is overdue', SESSIONS_ALERT, 'One application is waiting for a decision'])
      await expect(tile.getByText(t)).toHaveCount(0);
    // Customizing can't add them either.
    await door.getByRole('button', { name: 'Customize layout' }).click();
    await expect(door.getByRole('button', { name: /Show Exhibitors/ })).toHaveCount(0);
    await expect(door.getByRole('button', { name: /Show Session fill/ })).toHaveCount(0);
    await door.getByRole('button', { name: 'Done' }).click();
    await expectAccessibleBothModes(door);
    // Asked directly: refused.
    for (const k of ['sessionFill', 'exhibitorActivity', 'sponsorActivity']) {
      const res = await door.request.get(`/api/command-center/${slug}/${s.eventSlug}/${k}`);
      expect(res.status()).toBe(403);
    }
    const ok = await door.request.get(`/api/command-center/${slug}/${s.eventSlug}/sessionAttendance`);
    expect(ok.status()).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toMatch(/Minor|currency|email/i);
    await door.context().close();
  });

  test('empty states say what to do next; tiles without a connected source say so', async ({ page }) => {
    const owner = await newUser(page, {
      org: true,
      twoFactor: true,
      event: 'published',
      profile: 'conference',
    });
    const base = `/o/${owner.orgSlug}/e/${owner.eventSlug}`;
    await page.goto(`${base}/command-center`);
    await expect(page.getByRole('heading', { level: 1, name: 'Command Center' })).toBeVisible();
    const fill = page.getByTestId('cc-widget-sessionFill');
    await expect(fill).toContainText('No session limits places yet. Set a capacity on a session');
    const exhibitors = page.getByTestId('cc-widget-exhibitorActivity');
    await expect(exhibitors).toContainText('No exhibitors yet.');
    await expect(exhibitors.getByRole('link', { name: 'Add exhibitors' })).toHaveAttribute(
      'href',
      new RegExp(`${base}/exhibitors$`),
    );
    const sponsors = page.getByTestId('cc-widget-sponsorActivity');
    await expect(sponsors).toContainText('No sponsors yet.');
    await expectAccessibleBothModes(page);
    // With exhibitors but no lead source for the event (M5.6b is not built): leads are not on yet.
    const org = await resolveOrgSlug(owner.orgSlug as string);
    if (!org) throw new Error('no org');
    const s = await conferenceScenario(org.orgId, { withoutFakes: true });
    await page.goto(`/o/${owner.orgSlug}/e/${s.eventSlug}/command-center`);
    await expect(page.getByTestId('cc-exhibitor-activity')).toContainText(
      'Lead counts appear here once lead retrieval is on.',
    );
    // Batch 3j merge: sponsor deliverables (M5.4b) are connected now: the tile counts the event's
    // real ones (none overdue here) instead of saying the source is off.
    await expect(page.getByTestId('cc-sponsor-activity')).toContainText('0 deliverables overdue');
    await expect(page.getByTestId('cc-sponsor-activity')).not.toContainText(
      'Deliverables appear here once sponsor packages are on.',
    );
    await expect(alertsTile(page).getByText(LEADS_ALERT)).toHaveCount(0);
  });
});

/** A team member (viewer) of the org made door staff for the event, signed in on their own page. */
async function doorStaff(page: Page, browser: Browser, slug: string, base: string, name: string) {
  const context = await browser.newContext();
  const door = await context.newPage();
  await newUser(door, { join: [`${slug}:viewer`], name });
  await page.goto(`${base}/onsite/staff`);
  const add = page.getByRole('region', { name: 'Add door staff' });
  await add.getByLabel('Team member').selectOption({ label: name });
  await add.getByRole('button', { name: 'Add door staff' }).click();
  await expect(add.getByRole('status')).toHaveText('Saved.');
  return door;
}
