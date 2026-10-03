import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectAccessibleBothModes } from './helpers.ts';

/**
 * M5.10a attendee conference hub. The attendee reaches the hub from their order page (no account,
 * no app): today (on now with its polls and Q&A, up next, networking, install), the badge QR, the
 * agenda with stars and conflict prompts (keep both / replace / cancel) and enrolment, the
 * personal schedule (enrolled vs starred, overlaps), the signed calendar feed (it follows a moved
 * session; replacing the link revokes the old one), the web app manifest and service worker,
 * empty states, keyboard-only use, axe in light and dark, and Arabic right-to-left.
 *
 * Setup (a published conference happening now, with free registrants) comes from the dev-only
 * `/api/dev/conference-hub`; everything tested goes through the real pages and routes.
 */

const ORG = 'lakeside-events';
const stamp = () => `${Date.now().toString(36)}${test.info().project.name.replace(/\D/g, '')}`;

interface Fixture {
  eventId: string;
  slug: string;
  sessions: Record<string, { id: string; startsAt: string; endsAt: string }>;
  people: { token: string; name: string }[];
}

async function fixture(page: Page, name: string, opts: { empty?: boolean } = {}): Promise<Fixture> {
  const res = await page.request.post('/api/dev/conference-hub', {
    form: { org: ORG, name, ...(opts.empty ? { empty: '1' } : {}) },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

const first = (f: Fixture) => {
  const p = f.people[0];
  if (!p) throw new Error('no registrant');
  return p;
};

/** A session's card. */
const card = (page: Page, title: string): Locator =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

/** Press a control by keyboard (focus, then Enter). */
async function press(control: Locator) {
  await control.focus();
  await control.press('Enter');
}

test.describe('conference hub (M5.10a)', () => {
  test('today: from the order page — on now with polls and Q&A, up next, networking, badge — by keyboard', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const f = await fixture(page, `Hub Today ${stamp()}`);
    const me = first(f);
    await page.goto(`/orders/${me.token}`);
    await expect(page.getByText('Agenda, your schedule, your badge and calendar, on your phone.')).toBeVisible();
    await press(page.getByRole('link', { name: 'Open my conference hub' }));
    await expect(page).toHaveURL(new RegExp(`/orders/${me.token}/hub$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hub Today');
    await expect(page.getByText('For Hub Attendee 1')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

    // On now: the keynote, with its polls and Q&A (the one primary action); up next: two sessions.
    const now = page.getByRole('region', { name: 'Happening now' });
    await expect(now.getByText('From the agenda. Star sessions to make it yours.')).toBeVisible();
    await expect(card(page, 'Opening keynote')).toBeVisible();
    const qa = card(page, 'Opening keynote').getByRole('link', { name: 'Polls and Q&A' });
    await expect(qa).toHaveAttribute('href', `/events/${f.slug}/live/${f.sessions['Opening keynote']?.id}`);
    const next = page.getByRole('region', { name: 'Up next' });
    await expect(next.getByRole('heading', { name: 'Morning panel' })).toBeVisible();
    await expect(next.getByRole('heading', { name: 'Parallel talk' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open networking' })).toHaveAttribute(
      'href',
      `/events/${f.slug}/network`,
    );
    await expect(page.getByText(/This page is private/)).toBeVisible();
    await expectAccessibleBothModes(page);

    // Polls and Q&A opens the session's participant page.
    await press(qa);
    await expect(page).toHaveURL(new RegExp(`/events/${f.slug}/live/`));
    await expect(page.getByText('Opening keynote').first()).toBeVisible();

    // The badge: the ticket's QR, name and short code.
    await page.goto(`/orders/${me.token}/hub`);
    await press(page.getByRole('link', { name: 'Show my badge' }));
    await expect(page).toHaveURL(/view=badge/);
    await expect(page.getByRole('img', { name: 'Badge QR code for Hub Attendee 1' })).toBeVisible();
    await expect(page.getByText('Code', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Badge' })).toHaveAttribute('aria-current', 'page');
    await expectAccessibleBothModes(page);
  });

  test('agenda: star, conflict prompt (cancel, replace, keep both), persistence, schedule, enrol — by keyboard', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const f = await fixture(page, `Hub Agenda ${stamp()}`);
    const me = first(f);
    await page.goto(`/orders/${me.token}/hub`);
    await press(page.getByRole('link', { name: 'Agenda', exact: true }));
    await expect(page).toHaveURL(/view=agenda/);
    await expect(page.getByText('Star the sessions you want to attend.', { exact: false })).toBeVisible();
    await expectAccessibleBothModes(page);

    // Star the panel.
    await press(page.getByRole('button', { name: 'Star Morning panel' }));
    await expect(card(page, 'Morning panel').getByText('Morning panel is on your schedule.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove the star from Morning panel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The parallel talk overlaps it: asked first; Cancel leaves both as they were.
    const talk = card(page, 'Parallel talk');
    await press(page.getByRole('button', { name: 'Star Parallel talk' }));
    await expect(talk.getByText('This overlaps your schedule')).toBeVisible();
    await expect(talk.getByText('Morning panel (starred)')).toBeVisible();
    await expectAccessibleBothModes(page);
    await press(talk.getByRole('button', { name: 'Cancel' }));
    await expect(talk.getByText('This overlaps your schedule')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Star Parallel talk' })).toHaveAttribute('aria-pressed', 'false');

    // Again, and replace: the panel loses its star.
    await press(page.getByRole('button', { name: 'Star Parallel talk' }));
    await press(talk.getByRole('button', { name: 'Replace' }));
    await expect(talk.getByText('Starred. 1 overlapping favorite removed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Star Morning panel' })).toHaveAttribute('aria-pressed', 'false');

    // Persisted after a reload; star the panel again and keep both.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove the star from Parallel talk' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const panel = card(page, 'Morning panel');
    await press(page.getByRole('button', { name: 'Star Morning panel' }));
    await expect(panel.getByText('Parallel talk (starred)')).toBeVisible();
    await press(panel.getByRole('button', { name: 'Keep both' }));
    await expect(panel.getByText('Morning panel is on your schedule.')).toBeVisible();
    await expect(card(page, 'Morning panel').getByText('Overlaps Parallel talk')).toBeVisible();

    // Enrol in the optional workshop from the agenda (M5.2b's buttons).
    await press(page.getByRole('button', { name: 'Enrol in Data workshop' }));
    await expect(card(page, 'Data workshop').getByText("You're enrolled in Data workshop.")).toBeVisible();

    // My schedule: enrolled vs starred, with the overlaps.
    await press(page.getByRole('link', { name: 'My schedule' }));
    await expect(page).toHaveURL(/view=schedule/);
    await expect(page.getByText('1 enrolled session · 2 favorites · 2 overlapping sessions')).toBeVisible();
    await expect(card(page, 'Data workshop').getByText("You're enrolled", { exact: true })).toBeVisible();
    await expect(card(page, 'Parallel talk').getByText('Favorite', { exact: true })).toBeVisible();
    await expect(card(page, 'Parallel talk').getByText('Overlaps Morning panel')).toBeVisible();
    await expect(card(page, 'Closing remarks')).toHaveCount(0);
    await expectAccessibleBothModes(page);

    // Un-star from the schedule: gone after the refresh.
    await press(page.getByRole('button', { name: 'Remove the star from Parallel talk' }));
    await expect(page.getByText('1 enrolled session · 1 favorite · no overlaps')).toBeVisible();
    await expect(card(page, 'Parallel talk')).toHaveCount(0);

    // Today now follows the personal schedule.
    await press(page.getByRole('link', { name: 'Today' }));
    await expect(page.getByText('From your schedule.')).toBeVisible();
    await expect(page.getByText('Nothing on right now.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Up next' }).getByRole('heading', { name: 'Morning panel' })).toBeVisible();
  });

  test('calendar feed: subscribe, it follows a moved session, an unchanged feed is 304, replacing the link revokes it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const f = await fixture(page, `Hub Calendar ${stamp()}`);
    const me = first(f);
    const keynote = f.sessions['Opening keynote'];
    if (!keynote) throw new Error('no keynote');
    await page.goto(`/orders/${me.token}/hub?view=agenda`);
    await press(page.getByRole('button', { name: 'Star Opening keynote' }));
    await expect(card(page, 'Opening keynote').getByText('Opening keynote is on your schedule.')).toBeVisible();
    await page.goto(`/orders/${me.token}/hub`);
    await press(page.getByRole('link', { name: 'Add to my calendar' }));
    await expect(page).toHaveURL(/view=schedule#calendar$/);
    const field = page.getByRole('textbox', { name: 'Feed link (private)' });
    const url = await field.inputValue();
    expect(url).toMatch(/\/api\/calendar\/[^/]+\.ics$/);
    await expect(page.getByRole('link', { name: 'Subscribe in my calendar' })).toHaveAttribute(
      'href',
      url.replace(/^https?:/, 'webcal:'),
    );
    await expectAccessibleBothModes(page);

    const ics = async (u = url) => {
      const r = await page.request.get(u);
      return { status: r.status(), body: await r.text(), headers: r.headers() };
    };
    const before = await ics();
    expect(before.status).toBe(200);
    expect(before.headers['content-type']).toContain('text/calendar');
    expect(before.headers['cache-control']).toContain('private');
    const event = (body: string) =>
      body
        .replace(/\r\n /g, '')
        .split('BEGIN:VEVENT')
        .find((b) => b.includes(`UID:session-${keynote.id}@yayatoh`)) ?? '';
    const utc = (iso: string) => `${iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
    expect(event(before.body)).toContain(`DTSTART:${utc(keynote.startsAt)}`);
    expect(event(before.body)).toContain('STATUS:TENTATIVE');
    expect(before.body).not.toContain('Morning panel');

    // Unchanged: a calendar revalidating with the ETag gets 304.
    const again = await page.request.get(url, { headers: { 'if-none-match': before.headers.etag ?? '' } });
    expect(again.status()).toBe(304);

    // The organizer moves the keynote an hour later: same UID, new times, a higher SEQUENCE.
    await page.waitForTimeout(1100);
    const moved = await page.request.post('/api/dev/conference-hub', {
      form: {
        org: ORG,
        action: 'move',
        eventId: f.eventId,
        sessionId: keynote.id,
        title: 'Opening keynote',
        startsAt: keynote.startsAt,
        endsAt: keynote.endsAt,
        minutes: '60',
      },
    });
    expect(moved.ok()).toBe(true);
    const after = await ics();
    const later = new Date(new Date(keynote.startsAt).getTime() + 3_600_000).toISOString();
    expect(event(after.body)).toContain(`DTSTART:${utc(later)}`);
    const seq = (b: string) => Number(/SEQUENCE:(\d+)/.exec(event(b))?.[1]);
    expect(seq(after.body)).toBeGreaterThan(seq(before.body));
    expect(after.headers.etag).not.toBe(before.headers.etag);

    // Replace the link (confirmed): the old one is a 404, the new one works.
    await press(page.getByRole('button', { name: 'Replace the link' }));
    await expect(page.getByText('Replace the calendar link?')).toBeVisible();
    await expectAccessibleBothModes(page);
    await press(page.getByRole('button', { name: 'Replace the link' }));
    await expect(page.getByText('Done. The old link no longer works: subscribe with the new one.')).toBeVisible();
    await expect(field).not.toHaveValue(url);
    const fresh = await field.inputValue();
    expect((await ics()).status).toBe(404);
    expect((await ics(fresh)).status).toBe(200);
    // A forged link is a 404 too.
    expect((await ics(fresh.replace(/.{4}\.ics$/, 'AAAA.ics'))).status).toBe(404);
  });

  test('installable: the manifest, icons and a service worker scoped to the hub', async ({ page }) => {
    const f = await fixture(page, `Hub Install ${stamp()}`);
    const me = first(f);
    await page.goto(`/orders/${me.token}/hub`);
    await expect(page.getByRole('heading', { name: 'Keep it on your phone' })).toBeVisible();
    await expect(page.getByText(/On iPhone or iPad: tap Share/)).toBeVisible();
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const res = await page.request.get(href ?? '');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/manifest+json');
    const m = await res.json();
    expect(m).toMatchObject({
      display: 'standalone',
      scope: `/orders/${me.token}/hub`,
      lang: 'en',
      dir: 'ltr',
    });
    expect(m.name).toContain('Hub Install');
    expect(m.start_url).toMatch(new RegExp(`^/orders/${me.token}/hub\\?registrant=[0-9a-f-]{36}$`));
    for (const icon of m.icons as { src: string }[]) expect((await page.request.get(icon.src)).status()).toBe(200);
    const scope = await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const reg = await navigator.serviceWorker.getRegistration(location.pathname);
        if (reg) return new URL(reg.scope).pathname;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    });
    expect(scope).toBe(`/orders/${me.token}/hub`);
    // A wrong link has no hub, no manifest.
    expect((await page.request.get(`/orders/${'x'.repeat(43)}/hub`)).status()).toBe(404);
    expect((await page.request.get(`/orders/${'x'.repeat(43)}/hub/manifest`)).status()).toBe(404);
  });

  test('empty states say what to do next', async ({ page }) => {
    const f = await fixture(page, `Hub Empty ${stamp()}`, { empty: true });
    const me = first(f);
    await page.goto(`/orders/${me.token}/hub`);
    await expect(page.getByText('Nothing on right now.')).toBeVisible();
    await expect(page.getByText('Nothing coming up soon')).toBeVisible();
    await expectAccessibleBothModes(page);
    await press(page.getByRole('link', { name: 'Open the agenda' }));
    await expect(page.getByText('No sessions yet')).toBeVisible();
    await page.goto(`/orders/${me.token}/hub?view=schedule`);
    await expect(page.getByText('Your schedule is empty')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the agenda' })).toBeVisible();
    await expectAccessibleBothModes(page);
  });

  test('Arabic: the hub renders right-to-left', async ({ page }) => {
    const f = await fixture(page, `Hub RTL ${stamp()}`);
    const me = first(f);
    await page.goto(`/ar/orders/${me.token}/hub`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('مركز المؤتمر الخاص بك')).toBeVisible();
    await expect(page.getByRole('link', { name: 'جدولي' })).toBeVisible();
    await expectAccessibleBothModes(page);
    await page.goto(`/ar/orders/${me.token}/hub?view=agenda`);
    await expect(page.getByRole('button', { name: 'ضع نجمة على Morning panel' })).toBeVisible();
    await expectAccessibleBothModes(page);
    const m = await (await page.request.get(`/ar/orders/${me.token}/hub/manifest`)).json();
    expect(m).toMatchObject({ lang: 'ar', dir: 'rtl', scope: `/ar/orders/${me.token}/hub` });
  });
});
