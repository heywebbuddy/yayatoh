import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { closePools } from '@yayatoh/db';
import { adminClient } from '@yayatoh/db/testing';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type GuestHubScenario, guestHubScenario, guestSiteScenario } from '@yayatoh/testing';
import { expectAccessible, expectAccessibleBothModes, signIn } from './helpers.ts';

test.describe.configure({ timeout: 120_000 });

/**
 * M4.7a: the party's guest hub. One mobile page per party with its RSVP, program, seats and
 * tickets, reached by the party's RSVP link; installable to the home screen (its own manifest and
 * a service worker that keeps the last copy for the day, offline); a wallet pass (fake provider).
 * Empty states, the link as the only key (reset, expired), keyboard only, axe in light and dark,
 * Arabic RTL, and the host's copy of the link (hidden from viewers).
 */

const ORG = '/o/lakeside-events';
const VIEWER = 'jordan@lakeside.test';

test.afterAll(async () => {
  await closePools();
});

let orgId: string | null = null;
async function wedding(opts: { seating?: boolean } = {}): Promise<GuestHubScenario> {
  orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
  if (!orgId) throw new Error('no lakeside-events org (seed?)');
  return guestHubScenario(orgId, opts);
}

const hub = (token: string, locale = '') => `${locale}/hub/${encodeURIComponent(token)}`;
const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.describe('guest hub (M4.7a)', () => {
  test("a party's page: RSVP, program, seat and ticket; answering updates it; saved after a reload", async ({
    page,
  }) => {
    const s = await wedding();
    await page.goto(hub(s.garcia.token));
    await expect(page).toHaveTitle(/Your guest page/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, The Garcia family' })).toBeVisible();
    await expect(page.getByText(s.eventName).first()).toBeVisible();
    // Only the party's own people and parts of the celebration.
    await expect(page.getByText('Mei Chen')).toHaveCount(0);

    const nav = page.getByRole('navigation', { name: 'On this page' });
    for (const name of ['RSVP', 'Program', 'Your seats', 'Tickets', 'Keep this page handy'])
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(page.getByTestId('hub-next')).toContainText('Up next');
    await expect(page.getByTestId('hub-next')).toContainText('Ceremony');

    const rsvp = section(page, 'RSVP');
    await expect(rsvp.getByText('Waiting for your answer')).toBeVisible();
    await expect(page.getByTestId('hub-rsvp-counts')).toHaveText("0 attending · 0 can't attend · 5 awaiting");

    const program = page.getByRole('list', { name: "The parts of the celebration you're invited to" });
    await expect(program.getByRole('listitem')).toHaveCount(2);
    await expect(program.getByRole('listitem').first()).toContainText('Ceremony');
    await expect(program.getByRole('listitem').first()).toContainText('The garden');
    await expect(program.getByRole('listitem').first()).toContainText('No answer yet');

    await expect(
      section(page, 'Your seats').getByText(`Table ${s.tableLabel} · Seat ${s.seatLabel}`),
    ).toBeVisible();
    const tickets = section(page, 'Tickets');
    await expect(tickets.getByText('Guest pass')).toBeVisible();
    await expect(tickets.getByText('Luis López')).toBeVisible();
    await expect(tickets.getByRole('img', { name: 'Ticket QR code for Luis López' })).toBeVisible();
    await expect(tickets.getByText(`Code ${s.ticketShortCode}`)).toBeAttached();
    await expectAccessibleBothModes(page);

    // Answer through the RSVP page, then come back through its link to the guest page.
    await rsvp.getByRole('link', { name: 'Answer the RSVP' }).click();
    await expect(page).toHaveURL(new RegExp(`/rsvp/${encodeURIComponent(s.garcia.token)}$`));
    const pair = (name: string) => page.getByRole('group', { name, exact: true });
    for (const g of [
      'Luis López, Ceremony',
      "Luis's guest, Ceremony",
      'Luis López, Reception',
      "Luis's guest, Reception",
    ])
      await pair(g).getByText('Attending', { exact: true }).click();
    await pair('Ana García, Ceremony').getByText("Can't attend", { exact: true }).click();
    await page.getByLabel('First name').fill('Sam');
    await page.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(page).toHaveURL(/\?thanks=1$/);
    await page.getByRole('link', { name: 'Open your guest page: program, seats and tickets' }).click();
    await expect(page).toHaveURL(new RegExp(`/hub/${encodeURIComponent(s.garcia.token)}$`));
    await expect(section(page, 'RSVP').getByText('Answered', { exact: true })).toBeVisible();
    await expect(page.getByTestId('hub-rsvp-counts')).toHaveText("4 attending · 1 can't attend · 0 awaiting");
    await expect(section(page, 'RSVP').getByText(/You answered on/)).toBeVisible();
    await expect(section(page, 'RSVP').getByRole('link', { name: 'Change your answers' })).toBeVisible();
    await expect(program.getByRole('listitem').first()).toContainText('2 going');

    await page.reload();
    await expect(page.getByTestId('hub-rsvp-counts')).toHaveText("4 attending · 1 can't attend · 0 awaiting");
    await expectAccessible(page);
  });

  test('empty states: no ticket, no seat yet, seating not shared', async ({ page }) => {
    const s = await wedding();
    await page.goto(hub(s.chen.token));
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, The Chen family' })).toBeVisible();
    await expect(
      page
        .getByRole('list', { name: "The parts of the celebration you're invited to" })
        .getByRole('listitem'),
    ).toHaveCount(1);
    await expect(section(page, 'Tickets').getByText('No tickets needed')).toBeVisible();
    await expect(section(page, 'Your seats').getByText('No seats for your party yet')).toBeVisible();
    await expect(page.getByText('Luis')).toHaveCount(0);
    await expectAccessibleBothModes(page);

    const closed = await wedding({ seating: false });
    await page.goto(hub(closed.garcia.token));
    await expect(section(page, 'Your seats').getByText("Seating isn't shared yet")).toBeVisible();
    await expect(section(page, 'Your seats').getByText('Table')).toHaveCount(0);
    // Tickets don't wait for the seating.
    await expect(section(page, 'Tickets').getByText('Guest pass')).toBeVisible();
    await expectAccessible(page);
  });

  test('keyboard only: jump to a section and open the RSVP', async ({ page }) => {
    const s = await wedding();
    await page.goto(hub(s.garcia.token));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const seats = page
      .getByRole('navigation', { name: 'On this page' })
      .getByRole('link', { name: 'Your seats' });
    for (let i = 0; i < 20 && !(await seats.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(seats).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#seats$/);
    const answer = section(page, 'RSVP').getByRole('link', { name: 'Answer the RSVP' });
    await answer.focus();
    await expect(answer).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/rsvp/${encodeURIComponent(s.garcia.token)}$`));
  });

  test('installable with no app: its own manifest and icons, and the saved copy opens offline', async ({
    page,
    context,
  }) => {
    const s = await wedding();
    await page.goto(hub(s.garcia.token));
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe(`${hub(s.garcia.token)}/app.webmanifest`);
    const res = await page.request.get(href ?? '');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/manifest+json');
    expect(res.headers()['cache-control']).toContain('no-store');
    const m = await res.json();
    expect(m).toMatchObject({
      name: s.eventName,
      start_url: hub(s.garcia.token),
      scope: hub(s.garcia.token),
      display: 'standalone',
      lang: 'en',
      dir: 'ltr',
    });
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of m.icons) {
      const r = await page.request.get(icon.src);
      expect(r.status()).toBe(200);
      expect(r.headers()['content-type']).toBe('image/png');
    }
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/hub-icon-192.png');
    const keep = section(page, 'Keep this page handy');
    await expect(keep.getByText(/On iPhone or iPad: tap Share/)).toBeVisible();

    // The service worker controls the party's page only (its own path as scope).
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe(hub(s.garcia.token));
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.reload(); // through the worker now: the copy is saved
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, The Garcia family' })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, The Garcia family' })).toBeVisible();
    await expect(page.getByText(/You're offline\. This is the copy saved on your phone/)).toBeVisible();
    await expect(section(page, 'Tickets').getByText('Guest pass')).toBeVisible();
    await context.setOffline(false);
  });

  test('wallet passes (fake provider): event, party, when, where and seat; the QR opens the hub', async ({
    page,
  }) => {
    const s = await wedding();
    await page.goto(hub(s.garcia.token));
    const keep = section(page, 'Keep this page handy');
    for (const [name, platform] of [
      ['Add to Apple Wallet', 'apple'],
      ['Save to Google Wallet', 'google'],
    ] as const) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        keep.getByRole('link', { name }).click(),
      ]);
      const pass = JSON.parse(readFileSync((await download.path()) ?? '', 'utf8'));
      expect(pass).toMatchObject({ fake: true, platform, title: s.eventName, locale: 'en' });
      expect(pass.barcode.message).toMatch(new RegExp(`/hub/${encodeURIComponent(s.garcia.token)}$`));
      expect(pass.fields).toEqual([
        { key: 'party', label: 'Party', value: 'The Garcia family' },
        { key: 'when', label: 'When', value: expect.any(String) },
        { key: 'place', label: 'Where', value: 'The garden' },
        { key: 'seats', label: 'Seats', value: `${s.tableLabel} · ${s.seatLabel}` },
      ]);
      expect(JSON.stringify(pass)).not.toContain('Luis');
    }
    expect((await page.request.get(`${hub(s.garcia.token)}/pass/other`)).status()).toBe(404);
  });

  test('the link is the key: a reset link and an expired one show nothing', async ({ page }) => {
    const s = await wedding();
    await signIn(page);
    await page.goto(`${ORG}/e/${s.eventSlug}/guests/rsvp/${s.garcia.id}`);
    const field = page.getByLabel('Guest page link for Garcia');
    await expect(field).toHaveValue(new RegExp(`/hub/${encodeURIComponent(s.garcia.token)}$`));
    await expect(page.getByText(/resetting the link closes both/)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Reset the link' }).click();
    await expect(page.getByText('New link made. Old links and QR codes no longer work.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Guest page link for Garcia')).not.toHaveValue(
      new RegExp(`/hub/${encodeURIComponent(s.garcia.token)}$`),
    );

    for (const path of ['', '/app.webmanifest', '/pass/apple'])
      expect((await page.request.get(`${hub(s.garcia.token)}${path}`)).status()).toBe(404);
    await page.goto(hub(s.garcia.token));
    await expect(page.getByRole('heading', { name: 'Welcome, The Garcia family' })).toHaveCount(0);

    // 60 days after the event the link expires: the event's name and nothing else.
    const admin = adminClient();
    try {
      await admin`update guests.party_rsvp set link_expires_at = now() - interval '1 minute' where party_id = ${s.chen.id}`;
    } finally {
      await admin.end();
    }
    await page.goto(hub(s.chen.token));
    await expect(page.getByRole('heading', { level: 1, name: 'This link has expired' })).toBeVisible();
    await expect(page.getByText('Please ask the hosts for a new link.')).toBeVisible();
    await expect(page.getByText('Mei')).toHaveCount(0);
    await expect(page.getByText('Ceremony')).toHaveCount(0);
    expect((await page.request.get(`${hub(s.chen.token)}/app.webmanifest`)).status()).toBe(404);
    await expectAccessible(page);
  });

  test('a viewer sees no guest page link; the hub links to the guest website', async ({ page }) => {
    const w = await wedding();
    await signIn(page, VIEWER);
    await page.goto(`${ORG}/e/${w.eventSlug}/guests/rsvp/${w.garcia.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Guest page link for Garcia')).toHaveCount(0);

    orgId ??= (await resolveOrgSlug('lakeside-events'))?.orgId ?? null;
    const site = await guestSiteScenario(orgId ?? '');
    await page.goto(hub(site.garcia.token));
    const link = page.getByRole('link', { name: "Open the hosts' website" });
    await expect(link).toHaveAttribute('href', `/w/${site.code}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/w/${site.code}$`));
  });

  test('Arabic, right to left', async ({ page }) => {
    const s = await wedding();
    await page.goto(hub(s.garcia.token, '/ar'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { level: 1, name: 'مرحبًا، The Garcia family' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'في هذه الصفحة' })).toBeVisible();
    await expect(page.getByText(`الطاولة ${s.tableLabel} · المقعد ${s.seatLabel}`)).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      `${hub(s.garcia.token, '/ar')}/app.webmanifest`,
    );
    const m = await (await page.request.get(`${hub(s.garcia.token, '/ar')}/app.webmanifest`)).json();
    expect(m).toMatchObject({ lang: 'ar', dir: 'rtl', start_url: hub(s.garcia.token, '/ar') });
    await expectAccessibleBothModes(page);
  });
});
