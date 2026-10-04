import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import {
  expectAccessible,
  expectAccessibleBothModes,
  lastEmailedCode,
  ownClientIp,
  signIn,
} from './helpers.ts';

/**
 * M5.6b lead retrieval. Exhibitor people sign in with their portal invitation and capture leads
 * in the Scan PWA's lead mode (`/scan/leads`) with a lead license: a scan shows only the P5-8
 * allowlist (email only with the attendee's consent), takes a rating, qualifiers and notes, and
 * works offline (the queue syncs exactly once). The admin accepts the lead terms, sets
 * qualifiers and team visibility, and exports a CSV after confirming with an emailed code.
 * Capture is off 48 h after the event. Attendees see who scanned them and stop sharing their
 * email. Setup comes from the dev-only `/api/dev/leads`; everything tested goes through the
 * real pages.
 */
const ORG = 'lakeside-events';
const VIEWER = 'jordan@lakeside.test';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

interface Person {
  name: string;
  email: string;
  code: string;
}
interface Fixture {
  path: string;
  exhibitor: string;
  admin: { email: string; invite: string };
  staff: { email: string; invite: string };
  people: Person[];
  myTickets: string;
  staleSession: string | null;
}

async function fixture(
  page: Page,
  name: string,
  opts: { phase?: 'open' | 'closed'; ready?: boolean } = {},
): Promise<Fixture> {
  const res = await page.request.post('/api/dev/leads', {
    form: { org: ORG, name, phase: opts.phase ?? 'open', ready: opts.ready ? '1' : '0' },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

const person = (f: Fixture, who: string) => f.people.find((p) => p.name === who) as Person;

async function guestPage(browser: Browser) {
  const context = await browser.newContext();
  await ownClientIp(context);
  return context.newPage();
}

/** Sign in with an invitation link and the emailed code, by keyboard. */
async function signInPortal(guest: Page, invite: string, email: string) {
  await guest.goto(invite);
  await guest.getByRole('button', { name: 'Email me a sign-in code' }).focus();
  await guest.keyboard.press('Enter');
  const code = guest.getByLabel('Verification code', { exact: true });
  await expect(code).toBeFocused();
  await code.fill(await lastEmailedCode(guest, email));
  await code.press('Enter');
  await expect(guest).toHaveURL(/\/event-portal$/);
}

async function press(control: Locator) {
  await control.focus();
  await control.press('Enter');
}

/** Type a badge code and save it by keyboard (Enter submits). */
async function scanCode(page: Page, code: string) {
  const input = page.getByLabel('Badge code');
  await input.fill(code);
  await input.press('Enter');
}

const leadsTab = (page: Page) => page.getByRole('button', { name: /^Leads/ });

test.describe('lead retrieval (M5.6b)', () => {
  test('exhibitor admin: accepts the lead terms, sets qualifiers and visibility (validation, keyboard, persistence); axe; RTL', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const f = await fixture(page, `Terms Expo ${stamp()}`);
    const admin = await guestPage(browser);
    await signInPortal(admin, f.admin.invite, f.admin.email);
    const leads = admin.getByRole('region', { name: 'Lead capture' });
    await expect(leads.getByText('Licensed')).toBeVisible();
    await expect(leads.getByText('Capture open', { exact: true })).toBeVisible();
    await expect(
      leads.getByText('Accept the lead terms below before your team can capture leads.'),
    ).toBeVisible();
    // The terms: refused without the tick, accepted by keyboard.
    await press(leads.getByRole('button', { name: 'Accept the lead terms' }));
    await expect(leads.getByText('Tick the box to accept the lead terms.')).toBeVisible();
    const tick = leads.getByLabel(`I accept the lead terms on behalf of ${f.exhibitor}`);
    await tick.focus();
    await admin.keyboard.press('Space');
    await expect(tick).toBeChecked();
    await press(leads.getByRole('button', { name: 'Accept the lead terms' }));
    await expect(leads.getByText('Lead terms accepted')).toBeVisible();

    // Qualifiers: too long is refused inline; then saved, with team visibility on.
    const qualifiers = leads.getByLabel('Qualifiers');
    await qualifiers.fill(`Budget approved\n${'x'.repeat(61)}`);
    await press(leads.getByRole('button', { name: 'Save lead settings' }));
    await expect(leads.getByText('Each qualifier can be at most 60 characters.')).toBeVisible();
    await expect(qualifiers).toHaveAttribute('aria-invalid', 'true');
    await qualifiers.fill('Budget approved\nWants a demo\nbudget approved');
    const team = leads.getByLabel("Staff see the whole team's leads (otherwise only the leads they scanned)");
    await team.focus();
    await admin.keyboard.press('Space');
    await press(leads.getByRole('button', { name: 'Save lead settings' }));
    await expect(leads.getByText('Lead settings saved.')).toBeVisible();
    await admin.reload();
    const after = admin.getByRole('region', { name: 'Lead capture' });
    await expect(after.getByLabel('Qualifiers')).toHaveValue('Budget approved\nWants a demo');
    await expect(
      after.getByLabel("Staff see the whole team's leads (otherwise only the leads they scanned)"),
    ).toBeChecked();
    await expect(after.getByText('Lead terms accepted')).toBeVisible();
    await expect(after.getByText('No leads yet')).toBeVisible();
    await expectAccessibleBothModes(admin);

    await admin.goto('/ar/event-portal');
    await expect(admin.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(admin.getByRole('region', { name: 'جمع العملاء المحتملين' })).toBeVisible();
    await expectAccessible(admin);
    await admin.context().close();
  });

  test('Scan PWA: capture online — email only with consent, unknown badges refused, rating/qualifiers/notes persist; search; axe; RTL', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const f = await fixture(page, `Scan Expo ${stamp()}`);
    const admin = await guestPage(browser);
    await signInPortal(admin, f.admin.invite, f.admin.email);
    // Before the terms: lead mode explains why scanning is off.
    await admin.goto('/scan/leads');
    await expect(admin.getByRole('heading', { name: `Leads for ${f.exhibitor}`, level: 1 })).toBeVisible();
    await expect(admin.getByText('Accept the lead terms in the exhibitor portal first.')).toBeVisible();
    await expect(admin.getByLabel('Badge code')).toHaveCount(0);
    await expectAccessible(admin);
    await admin.goto('/event-portal');
    const portal = admin.getByRole('region', { name: 'Lead capture' });
    await portal.getByLabel(`I accept the lead terms on behalf of ${f.exhibitor}`).check();
    await portal.getByRole('button', { name: 'Accept the lead terms' }).click();
    await expect(portal.getByText('Lead terms accepted')).toBeVisible();
    await portal.getByLabel('Qualifiers').fill('Budget approved\nWants a demo');
    await portal.getByRole('button', { name: 'Save lead settings' }).click();
    await expect(portal.getByText('Lead settings saved.')).toBeVisible();
    await press(portal.getByRole('link', { name: 'Open lead capture' }));
    await expect(admin).toHaveURL(/\/scan\/leads$/);

    const ana = person(f, 'Ana');
    const ben = person(f, 'Ben');
    // Ana agreed to share her email; Ben did not.
    await scanCode(admin, ana.code);
    const result = admin.getByRole('status').filter({ hasText: 'Lead saved' });
    await expect(result).toBeVisible();
    await expect(result.getByText(/^Ana /)).toBeVisible();
    await expect(result.getByText(ana.email)).toBeVisible();
    await expect(admin.getByLabel('Badge code')).toBeFocused();
    // Rate, qualify and annotate it by keyboard.
    const editor = admin.getByRole('form', { name: 'Lead details' });
    await editor.getByLabel('Hot').focus();
    await admin.keyboard.press('Space');
    await editor.getByLabel('Wants a demo').check();
    await editor.getByLabel('Notes').fill('Asked about pricing');
    await press(editor.getByRole('button', { name: 'Save details' }));
    await expect(editor.getByText('Saved.')).toBeVisible();

    await scanCode(admin, ben.code);
    const benResult = admin.getByRole('status').filter({ hasText: 'Lead saved' });
    await expect(benResult.getByText('Email not shared')).toBeVisible();
    await expect(benResult.getByText(ben.email)).toHaveCount(0);

    // An unreadable code is refused with its reason; nothing is saved.
    await scanCode(admin, 'NOTABADGE');
    await expect(admin.getByText('Not saved')).toBeVisible();
    await expect(admin.getByText("This badge can't be read. Check the code and try again.")).toBeVisible();
    await expect(admin.getByTestId('leads-queue')).toHaveText('All synced');
    await expectAccessibleBothModes(admin);

    // The list: both leads, Ana's details persisted after a reload; search narrows it.
    await admin.reload();
    await press(leadsTab(admin));
    await expect(leadsTab(admin)).toHaveText('Leads (2)');
    const list = admin.getByRole('region', { name: `All leads of ${f.exhibitor}` });
    const anaCard = list.locator('li').filter({ hasText: ana.email });
    await expect(anaCard.getByText('Hot')).toBeVisible();
    await expect(anaCard.getByText('Wants a demo')).toBeVisible();
    await expect(anaCard.getByText('Asked about pricing')).toBeVisible();
    await list.getByLabel('Search leads').fill('pricing');
    await expect(list.locator('li')).toHaveCount(1);
    await list.getByLabel('Search leads').fill('nobody at all');
    await expect(list.getByText('No lead matches your search.')).toBeVisible();
    await list.getByLabel('Search leads').fill('');
    // Edit from the list by keyboard.
    const benCard = list.locator('li').filter({ hasText: `Ben ` });
    await press(benCard.getByRole('button', { name: /^Edit Ben/ }));
    await benCard.getByLabel('Cold').check();
    await benCard.getByLabel('Notes').fill('Follow up in Q3');
    await press(benCard.getByRole('button', { name: 'Save details' }));
    await expect(benCard.getByText('Saved.')).toBeVisible();
    await admin.reload();
    await press(leadsTab(admin));
    await expect(admin.locator('li').filter({ hasText: 'Follow up in Q3' })).toBeVisible();
    await expectAccessible(admin);

    await admin.goto('/ar/scan/leads');
    await expect(admin.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(admin.getByRole('heading', { name: `العملاء المحتملون لـ ${f.exhibitor}` })).toBeVisible();
    await expectAccessible(admin);
    await admin.context().close();
  });

  test('offline: scans queue on the device and sync exactly once when the network is back', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const f = await fixture(page, `Offline Expo ${stamp()}`);
    const admin = await guestPage(browser);
    await signInPortal(admin, f.admin.invite, f.admin.email);
    await admin.goto('/event-portal');
    const portal = admin.getByRole('region', { name: 'Lead capture' });
    await portal.getByLabel(`I accept the lead terms on behalf of ${f.exhibitor}`).check();
    await portal.getByRole('button', { name: 'Accept the lead terms' }).click();
    await expect(portal.getByText('Lead terms accepted')).toBeVisible();
    await admin.goto('/scan/leads');
    await expect(admin.getByTestId('leads-network')).toHaveText('Online');

    await admin.context().setOffline(true);
    await expect(admin.getByTestId('leads-network')).toHaveText(/^Offline/);
    await scanCode(admin, person(f, 'Ana').code);
    await expect(admin.getByText('Saved on this device')).toBeVisible();
    // Notes ride along with the queued scan.
    const editor = admin.getByRole('form', { name: 'Lead details' });
    await editor.getByLabel('Notes').fill('Met offline at the booth');
    await press(editor.getByRole('button', { name: 'Save details' }));
    await expect(editor.getByText("Saved with the scan. It syncs when you're online.")).toBeVisible();
    await scanCode(admin, person(f, 'Cleo').code);
    await expect(admin.getByTestId('leads-queue')).toHaveText('2 scans waiting to sync');

    // Back online, the first reply is lost after the server applied it: the device sends the
    // same queue again, and each scan still counts once.
    let lost = false;
    await admin.route('**/api/scan/leads', async (route) => {
      if (route.request().method() === 'POST' && !lost) {
        lost = true;
        await route.fetch();
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await admin.context().setOffline(false);
    await expect(admin.getByTestId('leads-queue')).toHaveText('All synced', { timeout: 60_000 });
    expect(lost).toBe(true);
    await admin.unroute('**/api/scan/leads');
    await admin.reload();
    await press(leadsTab(admin));
    await expect(leadsTab(admin)).toHaveText('Leads (2)');
    const list = admin.getByRole('region', { name: `All leads of ${f.exhibitor}` });
    const ana = list.locator('li').filter({ hasText: person(f, 'Ana').email });
    await expect(ana.getByText('Met offline at the booth')).toBeVisible();
    // Scanned once: no "· 2 scans".
    await expect(ana.getByText(/scans/)).toHaveCount(0);
    await expectAccessible(admin);
    await admin.context().close();
  });

  test('licenses: staff without one are refused; given one they capture and see only their own leads', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const f = await fixture(page, `License Expo ${stamp()}`, { ready: true });
    const staff = await guestPage(browser);
    await signInPortal(staff, f.staff.invite, f.staff.email);
    const mine = staff.getByRole('region', { name: 'Lead capture' });
    await expect(mine.getByText('No license')).toBeVisible();
    await expect(
      mine.getByText("You don't have a lead license yet. Ask your exhibitor admin for one."),
    ).toBeVisible();
    // Admin-only controls are not there for staff, and the export is refused.
    await expect(mine.getByRole('button', { name: 'Save lead settings' })).toHaveCount(0);
    await expect(mine.getByRole('link', { name: 'Download leads (CSV)' })).toHaveCount(0);
    const refused = await staff.request.get('/api/portal/leads/export', { maxRedirects: 0 });
    expect(refused.status()).toBe(403);
    await staff.goto('/scan/leads');
    await expect(
      staff.getByText("You don't have a lead license. Ask your exhibitor admin for one."),
    ).toBeVisible();
    await expect(staff.getByLabel('Badge code')).toHaveCount(0);
    // A direct sync is refused by the server too.
    const direct = await staff.request.post('/api/scan/leads', {
      headers: { 'content-type': 'application/json' },
      data: {
        scans: [{ scanId: `direct-${stamp()}`, code: person(f, 'Cleo').code, capturedAt: new Date() }],
      },
    });
    expect(direct.status()).toBe(403);
    expect(((await direct.json()) as { details?: { reason?: string } }).details?.reason).toBe('no_license');

    // The admin gives them the second included license.
    const admin = await guestPage(browser);
    await signInPortal(admin, f.admin.invite, f.admin.email);
    const row = admin
      .getByRole('region', { name: 'Lead licenses' })
      .locator('li')
      .filter({ hasText: f.staff.email });
    await press(row.getByRole('button', { name: `Give ${f.staff.email} a license` }));
    await expect(
      admin.getByRole('region', { name: 'Lead licenses' }).getByText('Licenses in use: 2 of 2'),
    ).toBeVisible();

    await staff.goto('/scan/leads');
    await scanCode(staff, person(f, 'Cleo').code);
    await expect(staff.getByRole('status').filter({ hasText: 'Lead saved' })).toBeVisible();
    await press(leadsTab(staff));
    // Own leads only: Cleo, not the admin's Ana and Ben.
    const list = staff.getByRole('region', { name: 'Your leads' });
    await expect(list.locator('li')).toHaveCount(1);
    await expect(list.getByText(person(f, 'Ana').email)).toHaveCount(0);
    await expectAccessibleBothModes(staff);
    await staff.context().close();
    await admin.context().close();
  });

  test('capture stops 48 h after the event: scanning is off, the leads stay readable', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const f = await fixture(page, `Closed Expo ${stamp()}`, { phase: 'closed', ready: true });
    const admin = await guestPage(browser);
    await signInPortal(admin, f.admin.invite, f.admin.email);
    await expect(
      admin.getByRole('region', { name: 'Lead capture' }).getByText('Capture closed'),
    ).toBeVisible();
    await admin.goto('/scan/leads');
    await expect(admin.getByText("You can't capture leads right now")).toBeVisible();
    await expect(
      admin.getByText(/^Capture closed .+\. You can still read and edit your leads\.$/),
    ).toBeVisible();
    await expect(admin.getByLabel('Badge code')).toHaveCount(0);
    // The server refuses a late scan as well.
    const late = await admin.request.post('/api/scan/leads', {
      headers: { 'content-type': 'application/json' },
      data: { scans: [{ scanId: `late-${stamp()}`, code: person(f, 'Cleo').code, capturedAt: new Date() }] },
    });
    expect(late.status()).toBe(200);
    expect(
      ((await late.json()) as { results: { status: string; reason: string }[] }).results[0],
    ).toMatchObject({
      status: 'refused',
      reason: 'closed',
    });
    await press(leadsTab(admin));
    await expect(leadsTab(admin)).toHaveText('Leads (2)');
    await expectAccessibleBothModes(admin);
    await admin.context().close();
  });

  test('export: the CSV needs an emailed code first, then carries the allowlist (email only with consent)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const f = await fixture(page, `Export Expo ${stamp()}`, { ready: true });
    const admin = await guestPage(browser);
    // Signed in 11 minutes ago: past the step-up window.
    await admin
      .context()
      .addCookies([
        { name: 'yy_portal', value: f.staleSession ?? '', url: test.info().project.use.baseURL as string },
      ]);
    await admin.goto('/event-portal');
    const leads = admin.getByRole('region', { name: 'Lead capture' });
    await expect(leads.getByText('2 leads')).toBeVisible();
    await press(leads.getByRole('link', { name: 'Download leads (CSV)' }));
    await expect(admin).toHaveURL(/\/event-portal\/confirm$/);
    await expect(admin.getByRole('heading', { name: "Confirm it's you", level: 1 })).toBeVisible();
    await expectAccessibleBothModes(admin);
    await press(admin.getByRole('button', { name: 'Email me a sign-in code' }));
    const code = admin.getByLabel('Verification code', { exact: true });
    await expect(code).toBeFocused();
    await code.fill('000000');
    await code.press('Enter');
    await expect(admin.getByText(/^That code isn't right\./)).toBeVisible();
    await code.fill(await lastEmailedCode(admin, f.admin.email));
    await code.press('Enter');
    await expect(admin).toHaveURL(/\/event-portal\?export=ready/);
    const ready = admin.getByRole('region', { name: 'Lead capture' });
    await expect(ready.getByText('Confirmed. You can download your leads now.')).toBeVisible();
    const download = admin.waitForEvent('download');
    await ready.getByRole('link', { name: 'Download leads (CSV)' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^leads-booth-export-expo-.+\.csv$/);
    const csv = await (await file.createReadStream())
      .toArray()
      .then((c) => Buffer.concat(c).toString('utf8'));
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'Name,Job title,Company,Email,Rating,Qualifiers,Notes,Scanned at,Scanned by,Scans,Shared fields,Email consent version',
    );
    expect(lines).toHaveLength(3);
    expect(csv).toContain(person(f, 'Ana').email);
    expect(csv).not.toContain(person(f, 'Ben').email);
    expect(csv).toContain('America/Chicago');
    await admin.context().close();
  });

  test('attendee: sees who scanned their badge, stops sharing their email, turns sharing off; phone; axe; RTL', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const f = await fixture(page, `Attendee Expo ${stamp()}`, { ready: true });
    const ana = await guestPage(browser);
    await ana.setViewportSize({ width: 375, height: 812 });
    await ana.goto(f.myTickets);
    const who = ana.getByRole('region', { name: 'Who scanned my badge' });
    const row = who.locator('li').filter({ hasText: f.exhibitor });
    await expect(row.getByText('Has your email')).toBeVisible();
    await expect(who.getByText('Exhibitors who scan your badge receive your email.')).toBeVisible();
    const stop = row.getByRole('button', { name: `Stop sharing my email with ${f.exhibitor}` });
    expect((await stop.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectAccessibleBothModes(ana);
    await press(stop);
    await expect(row.getByText('Email sharing stopped')).toBeVisible();
    await press(who.getByRole('button', { name: 'Stop sharing my email with exhibitors' }));
    await expect(who.getByText("Exhibitors who scan your badge don't receive your email.")).toBeVisible();
    await ana.reload();
    const again = ana.getByRole('region', { name: 'Who scanned my badge' });
    await expect(
      again.locator('li').filter({ hasText: f.exhibitor }).getByText('Email sharing stopped'),
    ).toBeVisible();
    await expect(
      again.getByRole('button', { name: 'Share my email with exhibitors who scan my badge' }),
    ).toBeVisible();

    // The exhibitor no longer sees Ana's email; the stamp says she stopped sharing it.
    const admin = await guestPage(browser);
    await signInPortal(admin, f.admin.invite, f.admin.email);
    await admin.goto('/scan/leads');
    await press(leadsTab(admin));
    await expect(admin.getByText(person(f, 'Ana').email)).toHaveCount(0);
    await expect(admin.getByText(/^Email sharing stopped by the attendee on /)).toBeVisible();
    await admin.context().close();

    await ana.goto(`/ar${f.myTickets}`);
    await expect(ana.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(ana.getByRole('region', { name: 'من مسح شارتي' })).toBeVisible();
    await expectAccessible(ana);
    await ana.context().close();
  });

  test('no portal session, no leads: signed-out lead mode, organizers (viewer) have no lead access', async ({
    page,
  }) => {
    const res = await page.request.get('/api/scan/leads');
    expect(res.status()).toBe(401);
    const post = await page.request.post('/api/scan/leads', {
      headers: { 'content-type': 'application/json' },
      data: { scans: [] },
    });
    expect(post.status()).toBe(401);
    await signIn(page, VIEWER);
    await page.goto('/scan/leads');
    await expect(page.getByRole('heading', { name: 'Sign in to capture leads', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the exhibitor portal' })).toBeVisible();
    expect((await page.request.get('/api/portal/leads/export', { maxRedirects: 0 })).status()).toBe(303);
    await expectAccessibleBothModes(page);
  });
});
