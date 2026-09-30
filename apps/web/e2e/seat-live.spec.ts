import { expect, test } from '@playwright/test';
import { expectAccessible, signIn } from './helpers.ts';
import { holdSeats, seatBox, seatedGala, unique, waitLive } from './seating-helpers.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const LAKESIDE = `http://lakeside-events.yayatoh.events:${PORT}`;
const HARBOR = `http://harbor-arts.yayatoh.events:${PORT}`;
const VIEWER = 'jordan@lakeside.test';

/** The first chunk of a stream as the browser sees it (status, type, and the first message). */
async function peekStream(page: import('@playwright/test').Page, url: string) {
  return page.evaluate(async (u) => {
    const ctrl = new AbortController();
    const res = await fetch(u, { signal: ctrl.signal });
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
  }, url);
}

test.describe('live seat availability (M1.7f)', () => {
  // Each test builds its own seated event through the UI first.
  test.describe.configure({ timeout: 120_000 });

  test('a seat bought in one browser goes grey in another without a reload; a chosen one is dropped with a notice', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const { slug } = await seatedGala(page, unique('Live Gala'));
    const [a, b] = await Promise.all(
      [0, 1].map(async () =>
        (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(),
      ),
    );
    if (!a || !b) throw new Error('no pages');
    await b.goto(`/events/${slug}`);
    await waitLive(b);
    // B chooses two seats; one of them, and one B did not choose, are about to be taken.
    await seatBox(b, 'Table 1 · 1').check();
    await seatBox(b, 'Table 2 · 1').check();
    await expect(b.getByRole('status').filter({ hasText: '2 seats selected' })).toBeVisible();
    await b.getByRole('button', { name: 'Show seat map' }).click();
    await expect(b.getByTestId('seat-map').locator('canvas').first()).toBeVisible();

    await holdSeats(a, slug, ['Table 1 · 1', 'Table 1 · 2'], `Anna Live ${Date.now()}`);

    // B's page follows along: both seats go grey, and B's chosen one is dropped, politely.
    await expect(seatBox(b, 'Table 1 · 1')).toBeDisabled();
    await expect(seatBox(b, 'Table 1 · 2')).toBeDisabled();
    await expect(seatBox(b, 'Table 1 · 1')).not.toBeChecked();
    const notice = b.getByTestId('seat-notice');
    await expect(notice).toHaveText(
      'Seat Table 1 · 1 was just taken by someone else and is no longer in your choice.',
    );
    await expect(notice.locator('xpath=..')).toHaveAttribute('aria-live', 'polite');
    await expect(b.getByRole('status').filter({ hasText: '1 seat selected' })).toBeVisible();
    await expect(seatBox(b, 'Table 2 · 1')).toBeChecked();
    await expectAccessible(b);
    // It was never a reload: B's typing is still there.
    await b.getByLabel('Full name').fill('Bo Still Here');
    await expect(b.getByLabel('Full name')).toHaveValue('Bo Still Here');
  });

  test('the organizer’s seat counts update live as buyers hold seats', async ({ page, browser }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Counts Gala'));
    await page.goto(`${base}/seating`);
    const counts = page.getByTestId('seat-counts');
    await expect(counts).toHaveAttribute('data-live', 'live', { timeout: 15_000 });
    await expect(counts).toHaveText(
      '8 seats · 8 available · 0 held · 0 sold · 0 assigned to guests · 0 blocked',
    );
    const buyer = await (await browser.newContext()).newPage();
    await holdSeats(buyer, slug, ['Table 2 · 3'], `Cara Count ${Date.now()}`);
    await expect(counts).toHaveText(
      '8 seats · 7 available · 1 held · 0 sold · 0 assigned to guests · 0 blocked',
    );
    // The legend says what the colours mean, a guest's seat apart from a blocked one.
    const legend = page.getByRole('list', { name: 'What the seat colours mean' });
    for (const s of ['Available', 'In checkout', 'Sold', "Guest's seat", 'Blocked'])
      await expect(legend.getByText(s, { exact: true })).toBeVisible();
    await expectAccessible(page);
  });

  test('a dropped connection reconnects and catches up with what it missed', async ({ page, browser }) => {
    await signIn(page);
    const { slug } = await seatedGala(page, unique('Blip Gala'));
    const b = await (await browser.newContext()).newPage();
    await b.goto(`/events/${slug}`);
    await waitLive(b);
    // A network blip: the server drops every open stream; the browser reconnects by itself.
    const dropped = await page.request.post('/api/dev/seat-streams');
    expect(dropped.ok()).toBe(true);
    expect((await dropped.json()).dropped).toBeGreaterThan(0);
    const a = await (await browser.newContext()).newPage();
    await holdSeats(a, slug, ['Table 2 · 4'], `Dee Blip ${Date.now()}`);
    await expect(seatBox(b, 'Table 2 · 4')).toBeDisabled({ timeout: 15_000 });
    await waitLive(b);
  });

  test('streams carry only their own event: no cross-org attach, drafts and non-members get nothing', async ({
    page,
  }) => {
    await signIn(page);
    const { base, slug } = await seatedGala(page, unique('Scope Gala'));
    // On Lakeside's own tenant site, its event streams (the proxy scopes it to the host's org).
    await page.goto(`${LAKESIDE}/events/${slug}`);
    const own = await peekStream(page, `/events/${slug}/seats/stream`);
    expect(own.status).toBe(200);
    expect(own.type).toContain('text/event-stream');
    expect(own.text).toContain('event: snapshot');
    expect(own.text).not.toMatch(/@|name|email|order|ticket/i);
    // Another org's tenant site never streams Lakeside's event.
    await page.goto(`${HARBOR}/`);
    expect((await peekStream(page, `/events/${slug}/seats/stream`)).status).toBe(404);
    await page.goto('/');
    // No seats on sale (a published event without a plan), or no such event: no stream.
    expect((await peekStream(page, '/events/midwest-leadership-summit-2027/seats/stream')).status).toBe(404);
    expect((await peekStream(page, `/events/no-such-event-${Date.now()}/seats/stream`)).status).toBe(404);
    // The organizer's stream: members only. Signed out → 401; another org's member → 404.
    const staffUrl = `${base}/seating/stream`;
    const staff = await peekStream(page, staffUrl);
    expect(staff.status).toBe(200);
    expect(staff.text).toContain('"counts"');
    const anon = await (await page.context().browser()?.newContext())?.newPage();
    if (!anon) throw new Error('no page');
    await anon.goto('/');
    expect((await peekStream(anon, staffUrl)).status).toBe(401);
    await signIn(anon, 'maya@rosewood.test');
    expect((await peekStream(anon, staffUrl)).status).toBe(404);
    // A viewer may watch (read only).
    await signIn(anon, VIEWER);
    expect((await peekStream(anon, staffUrl)).status).toBe(200);
  });
});
