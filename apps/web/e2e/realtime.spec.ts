import { type Browser, expect, type Page, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';
import { seatedGala, unique } from './seating-helpers.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const LAKESIDE = `http://lakeside-events.yayatoh.events:${PORT}`;
const HARBOR = `http://harbor-arts.yayatoh.events:${PORT}`;
const VIEWER = 'jordan@lakeside.test';

/** `YYYY-MM-DDTHH:mm` wall-clock time in Chicago, `offsetH` hours from now (for datetime-local). */
function chicago(offsetH: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetH * 3_600_000));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const stamp = () => `${Date.now()}${test.info().project.name.split('-')[0]}`;

/** An event happening now (check-in open) with `n` free tickets bought by a guest. */
async function doorsEvent(page: Page, browser: Browser, n = 2) {
  const s = stamp();
  await page.goto('/o/lakeside-events/events/new');
  await page.getByLabel('Event name', { exact: true }).fill(`Live Doors ${s}`);
  await page.getByLabel('Time zone').selectOption('America/Chicago');
  await page.getByLabel('Starts', { exact: true }).fill(chicago(-1));
  await page.getByLabel('Ends', { exact: true }).fill(chicago(3));
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/o\/lakeside-events\/e\/live-doors-[a-z0-9-]+$/);
  const base = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published ·')).toBeVisible();
  await page.goto(`${base}/tickets-orders`);
  await page.getByLabel('Name', { exact: true }).fill('Door pass');
  await page.getByLabel('Price (USD)').fill('0');
  await page.getByLabel('Quantity available').fill('10');
  await page.getByRole('button', { name: 'Add ticket type' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Door pass' })).toBeVisible();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(`/events/${base.split('/').pop()}`);
  await guest.getByLabel('Quantity — Door pass').selectOption(String(n));
  await guest.getByLabel('Full name').fill(`Lia ${s}`);
  await guest.getByLabel('Email for your tickets').fill(`lia+${s}@example.test`);
  await guest.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(guest).toHaveURL(/\/orders\//);
  const codes = (await guest.locator('.tracking-\\[0\\.2em\\]').allTextContents()).map((c) => c.trim());
  expect(codes).toHaveLength(n);
  await guestContext.close();
  return { base, codes, holder: `Lia ${s}` };
}

/** Open the door screen and wait until its live stream is connected; returns the stream URL. */
async function doorScreen(page: Page, base: string) {
  await page.goto(`${base}/onsite`);
  const live = page.getByTestId('live-checkins');
  await expect(live).toHaveAttribute('data-live', 'live', { timeout: 15_000 });
  return (await live.getAttribute('data-stream')) ?? '';
}

async function scan(page: Page, code: string) {
  const field = page.getByLabel('Ticket code');
  await field.fill(code);
  await field.press('Enter');
  await expect(page.getByRole('status').filter({ has: page.locator('[data-result]') })).toContainText(
    'Welcome in',
  );
}

/** The status and first chunk of a stream as a browser page fetches it (then aborted). */
async function peek(page: Page, url: string, headers: Record<string, string> = {}) {
  return page.evaluate(
    async ({ u, h }) => {
      const ctrl = new AbortController();
      const res = await fetch(u, { signal: ctrl.signal, headers: h });
      let text = '';
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const deadline = Date.now() + 5_000;
        while (!text.includes('event: ') && Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
      }
      ctrl.abort();
      return { status: res.status, type: res.headers.get('content-type') ?? '', text };
    },
    { u: url, h: headers },
  );
}

test.describe('realtime channels (M3.1b)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a check-in at one door shows up on another door screen within 3 seconds, and an undo too', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base, codes, holder } = await doorsEvent(page, browser);
    await doorScreen(page, base);
    await expect(page.getByText('0 of 2 tickets checked in today')).toBeVisible();
    await expect(page.getByTestId('live-checkins')).toContainText('Live');
    await expect(page.getByTestId('live-checkins').getByRole('status')).toHaveText(
      'Check-ins from every scanner show up here as they happen.',
    );

    // A second door: another browser, the same organizer.
    const doorContext = await browser.newContext();
    const door = await doorContext.newPage();
    await signIn(door);
    await doorScreen(door, base);
    // Keyboard only, as a HID scanner types: the code field has focus, Enter submits.
    await expect(door.getByLabel('Ticket code')).toBeFocused();
    await door.keyboard.type(codes[0] ?? '');
    await door.keyboard.press('Enter');
    await expect(door.getByRole('status').filter({ has: door.locator('[data-result]') })).toContainText(
      'Welcome in',
    );

    // The first screen follows without a reload, well inside the 10-second fallback refresh.
    const live = page.getByTestId('live-checkins').getByRole('status');
    await expect(live).toHaveText('1 check-in since you opened this page', { timeout: 3_000 });
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByText('1 of 2 tickets checked in today')).toBeVisible({ timeout: 3_000 });

    await scan(door, codes[1] ?? '');
    await expect(live).toHaveText('2 check-ins since you opened this page', { timeout: 3_000 });
    await expect(page.getByText('2 of 2 tickets checked in today')).toBeVisible({ timeout: 3_000 });

    await door
      .getByRole('button', { name: `Undo check-in for ${holder}` })
      .first()
      .click();
    // The undo committed once the door that made it shows it; the other screen follows within 3 s.
    await expect(door.getByText('1 of 2 tickets checked in today')).toBeVisible();
    await expect(page.getByText('1 of 2 tickets checked in today')).toBeVisible({ timeout: 3_000 });
    await expectAccessible(page);
    // It survives a reload: the counts come from the server, the stream reconnects.
    await page.reload();
    await expect(page.getByTestId('live-checkins')).toHaveAttribute('data-live', 'live', { timeout: 15_000 });
    await expect(page.getByText('1 of 2 tickets checked in today')).toBeVisible();
    await doorContext.close();
  });

  test('viewers, other orgs, signed-out visitors and foreign devices are refused; the org’s device is let in', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base } = await doorsEvent(page, browser, 1);
    const url = await doorScreen(page, base);
    expect(url).toMatch(/^\/api\/realtime\/org%3A[0-9a-f-]{36}%3Aevent%3A[0-9a-f-]{36}%3Acheckins$/);
    const channel = decodeURIComponent(url.split('/').pop() ?? '');
    const [, orgId, , eventId] = channel.split(':');

    // The organizer attaches: a snapshot of counts only, nothing about tickets or people.
    const own = await peek(page, url);
    expect(own.status).toBe(200);
    expect(own.type).toContain('text/event-stream');
    expect(own.text).toMatch(/event: snapshot\ndata: \{"admitted":0,"tickets":0\}/);

    // A viewer has no check-in role: no live control on the page, and the stream is refused.
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await signIn(viewer, VIEWER);
    await viewer.goto(`${base}/onsite`);
    await expect(viewer.getByText("Check-in isn't part of your role")).toBeVisible();
    await expect(viewer.getByTestId('live-checkins')).toHaveCount(0);
    expect((await peek(viewer, url)).status).toBe(403);

    // Another org's owner: 403 on this org's channels, whatever path or host.
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signIn(other, 'maya@rosewood.test');
    await other.goto('/o/rosewood-weddings');
    expect((await peek(other, url)).status).toBe(403);
    expect((await peek(other, `/api/realtime/${encodeURIComponent(`org:${orgId}:alerts`)}`)).status).toBe(
      403,
    );

    // Signed out: 401; a bad or forged device token: 401 (a credential is never ignored).
    const anonContext = await browser.newContext();
    const anon = await anonContext.newPage();
    await anon.goto('/');
    expect((await peek(anon, url)).status).toBe(401);
    expect((await peek(anon, url, { authorization: 'Bearer yyd_forged' })).status).toBe(401);
    expect((await peek(anon, url, { authorization: `Bearer yyd_${'A'.repeat(43)}` })).status).toBe(401);

    // Unknown or malformed channels are not found.
    for (const bad of [
      `org:${orgId}:event:${eventId}:nope`,
      `org:${orgId}:checkins`,
      'everything',
      `org:${orgId}`,
    ])
      expect((await peek(page, `/api/realtime/${encodeURIComponent(bad)}`)).status, bad).toBe(404);

    // The org's own device (door staff): allowed on check-ins, not on the org's alerts; refused on
    // another org's channel.
    await page.getByLabel('Device name').fill(`Gate ${stamp()}`);
    await page.getByRole('button', { name: 'Add device' }).click();
    const link = (await page.getByTestId('scan-link').getAttribute('href')) ?? '';
    const token = /k=(yyd_[A-Za-z0-9_-]+)/.exec(link)?.[1] ?? '';
    expect(token).not.toBe('');
    const bearer = { authorization: `Bearer ${token}` };
    const device = await peek(anon, url, bearer);
    expect(device.status).toBe(200);
    expect(device.text).toContain('event: snapshot');
    expect(
      (await peek(anon, `/api/realtime/${encodeURIComponent(`org:${orgId}:alerts`)}`, bearer)).status,
    ).toBe(403);
    const foreign = `org:0190ffff-0000-7000-8000-00000000ffff:event:${eventId}:checkins`;
    expect((await peek(anon, `/api/realtime/${encodeURIComponent(foreign)}`, bearer)).status).toBe(403);
    await Promise.all([viewerContext.close(), otherContext.close(), anonContext.close()]);
  });

  test('tenant hosts serve only their own org’s channels, on either path', async ({ page, browser }) => {
    await signIn(page);
    const { base } = await doorsEvent(page, browser, 1);
    const url = await doorScreen(page, base);
    const channel = url.split('/').pop() ?? '';
    const anonContext = await browser.newContext();
    const anon = await anonContext.newPage();
    // Lakeside's own site: the channel is Lakeside's, so a visitor is asked to sign in (401).
    await anon.goto(`${LAKESIDE}/`);
    expect((await peek(anon, `/realtime/${channel}`)).status).toBe(401);
    expect((await peek(anon, `/api/realtime/${channel}`)).status).toBe(401);
    // Harbor's site never carries Lakeside's channels: 403 before anything else is looked at.
    await anon.goto(`${HARBOR}/`);
    expect((await peek(anon, `/realtime/${channel}`)).status).toBe(403);
    expect((await peek(anon, `/api/realtime/${channel}`)).status).toBe(403);
    await anonContext.close();
  });

  test('a dropped connection resumes from its last message and misses nothing', async ({ page, browser }) => {
    await signIn(page);
    const { base, codes } = await doorsEvent(page, browser, 2);
    await doorScreen(page, base);
    const doorContext = await browser.newContext();
    const door = await doorContext.newPage();
    await signIn(door);
    await doorScreen(door, base);
    await scan(door, codes[0] ?? '');
    const live = page.getByTestId('live-checkins').getByRole('status');
    await expect(live).toHaveText('1 check-in since you opened this page', { timeout: 3_000 });
    // A network blip: the server drops every open stream; the check-in happens during the gap.
    const dropped = await page.request.post('/api/dev/seat-streams');
    expect(dropped.ok()).toBe(true);
    expect((await dropped.json()).dropped).toBeGreaterThan(0);
    await scan(door, codes[1] ?? '');
    // The browser reconnects with Last-Event-ID and is replayed what it missed.
    await expect(live).toHaveText('2 check-ins since you opened this page', { timeout: 15_000 });
    await expect(page.getByText('2 of 2 tickets checked in today')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('live-checkins')).toHaveAttribute('data-live', 'live');
    await doorContext.close();
  });

  test('the seat map’s channels are served by the same endpoint, with the same rules', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { base } = await seatedGala(page, unique('Channel Gala'));
    // The event's ids, from its door screen's check-in channel.
    const checkins = decodeURIComponent((await doorScreen(page, base)).split('/').pop() ?? '');
    const seats = `/api/realtime/${encodeURIComponent(checkins.replace(/:checkins$/, ':seats'))}`;
    const states = `/api/realtime/${encodeURIComponent(checkins.replace(/:checkins$/, ':seat-states'))}`;
    const anonContext = await browser.newContext();
    const anon = await anonContext.newPage();
    await anon.goto('/');
    // Public availability: anyone, seat ids and on/off only.
    const pub = await peek(anon, seats);
    expect(pub.status).toBe(200);
    expect(pub.text).toMatch(/event: snapshot\ndata: \{"on":\[/);
    expect(pub.text).not.toMatch(/@|name|email|order|ticket|held|sold/i);
    // Seat states and counts: members who may read events only.
    expect((await peek(anon, states)).status).toBe(401);
    const staff = await peek(page, states);
    expect(staff.status).toBe(200);
    expect(staff.text).toContain('"counts"');
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signIn(other, 'lee@harbor.test');
    await other.goto('/o/harbor-arts');
    expect((await peek(other, states)).status).toBe(403);
    // Another org's site carries neither.
    await anon.goto(`${HARBOR}/`);
    expect((await peek(anon, seats)).status).toBe(403);
    await Promise.all([anonContext.close(), otherContext.close()]);
  });

  test('the live status reads right to left in Arabic', async ({ page, browser }) => {
    await signIn(page);
    const { base } = await doorsEvent(page, browser, 1);
    await page.goto(`/ar${base}/onsite`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const live = page.getByTestId('live-checkins');
    await expect(live).toHaveAttribute('data-live', 'live', { timeout: 15_000 });
    await expect(live).toContainText('مباشر');
    await expect(live.getByRole('status')).toHaveText('تظهر هنا تسجيلات الدخول من كل الماسحات فور حدوثها.');
    await expectAccessible(page);
  });
});
