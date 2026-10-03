import { existsSync, readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { LOCALES } from '@yayatoh/contracts';
import { signDisplayToken } from '@yayatoh/engagement';
import type { CanaryOrg } from '@yayatoh/testing';
import {
  canaryToken,
  crawl,
  DOOR_ALLOW,
  EXPORT_ALLOW,
  type Fetched,
  findCanaries,
  formatLeaks,
  type Leak,
  leaksIn,
  V1_ALLOW,
} from '@yayatoh/testing/canary';
import { lastEmailedCode } from './helpers.ts';

/**
 * The canary leak crawl (roadmap §9, M1.11 "the canary crawler finds nothing"). The global setup
 * builds the canary org (every private column holds `__CANARY_<schema>.<table>.<column>__`); this
 * spec crawls everything a stranger can reach, the org's own /v1 and exports, the door's offline
 * manifest and the outbound messages, and fails listing every canary that should not be there.
 * `pnpm test:canary` runs it alone.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;
const FILE = new URL('./.generated/canary.json', import.meta.url);

function canary(): CanaryOrg {
  if (!existsSync(FILE))
    throw new Error(
      'e2e/.generated/canary.json is missing: the global setup builds it (e2e/canary-setup.ts)',
    );
  return JSON.parse(readFileSync(FILE, 'utf8')) as CanaryOrg;
}

// The crawl does not depend on the viewport: one project runs it.
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop-1280', 'viewport-independent; runs once');
});

/** A page as a browser sees it: raw response (with the streamed RSC payload), headers, the DOM. */
async function browserFetch(page: Page, url: string): Promise<Fetched | null> {
  const res = await page.goto(url, { waitUntil: 'load' }).catch(() => null);
  if (!res) return null;
  const type = res.headers()['content-type'] ?? '';
  const body = /html|xml|json|text|javascript/.test(type) ? await res.text().catch(() => '') : '';
  const headers = Object.entries(await res.allHeaders())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const dom = type.includes('html') ? await page.content().catch(() => '') : '';
  return { status: res.status(), contentType: type, body, extra: `${headers}\n${dom}` };
}

const OTHER_LOCALES = new Set<string>(LOCALES.filter((l) => l !== 'en' && l !== 'ar'));

/** Same-origin links worth following: one LTR and the RTL locale, no queries, no console. */
function follow(u: URL): boolean {
  const first = u.pathname.split('/')[1] ?? '';
  if (OTHER_LOCALES.has(first)) return false;
  const sitemap = /^\/sitemaps\/([\w-]+)\.xml$/.exec(u.pathname);
  if (sitemap && OTHER_LOCALES.has(sitemap[1] ?? '')) return false;
  if (u.search) return false;
  return !/^\/(?:ar\/)?(?:_next|lang|sign-in|signup|dev|api\/auth|api\/dev)(?:\/|$)/.test(u.pathname);
}

test.describe('canary leak crawl (roadmap §9)', () => {
  test('public pages on the marketplace, the tenant site and the widget carry no canary', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const c = canary();
    const tenant = `http://${c.tenantHost}:${PORT}`;
    const ev = c.event.slug;
    const start = [
      `${MARKET}/o/${c.slug}`,
      `${MARKET}/events/${ev}`,
      `${MARKET}/ar/events/${ev}`,
      `${MARKET}/events/${ev}/seat-finder`,
      `${MARKET}/events/${ev}/seat-finder/poster`,
      `${MARKET}/events/${ev}/unlock`,
      // M4.8a: the giving page (campaign totals only; no donor, tribute or employer, P4-13).
      `${MARKET}/events/${ev}/give`,
      `${MARKET}/ar/events/${ev}/give`,
      `${MARKET}/embed/${ev}`,
      `${MARKET}/series/${c.slug}-tour`,
      `${MARKET}/legal/${c.slug}/refund`,
      `${MARKET}/events?q=Canary`,
      `${MARKET}/venues`,
      `${MARKET}/scan.webmanifest`,
      `${MARKET}/robots.txt`,
      `${MARKET}/sitemap.xml`,
      `${MARKET}/sitemaps/en.xml`,
      `${MARKET}/`,
      `${tenant}/`,
      `${tenant}/events/${ev}`,
      `${tenant}/ar/events/${ev}`,
      `${tenant}/robots.txt`,
      `${tenant}/sitemap.xml`,
      `${tenant}/sitemaps/en.xml`,
    ];
    const r = await crawl({ start, fetch: (u) => browserFetch(page, u), maxPages: 200, follow });
    // The crawl really reached the canary org's pages (a crawl that saw nothing proves nothing).
    for (const must of [
      `${MARKET}/events/${ev}`,
      `${tenant}/events/${ev}`,
      `${MARKET}/embed/${ev}`,
      `${MARKET}/events/${ev}/give`,
    ])
      expect(r.visited).toContain(must);
    expect(r.visited.length).toBeGreaterThan(40);
    // The giving page really showed the canary org's campaign (its private gift columns are canaries).
    await page.goto(`${MARKET}/events/${ev}/give`);
    await expect(page.getByRole('heading', { name: 'Fixture Fund', level: 1 })).toBeVisible();
    expect(formatLeaks(r.leaks)).toBe('no canary leaks');
    expect(r.errors).toEqual([]);
  });

  test('/v1 public endpoints and unauthenticated org endpoints carry no canary', async ({ request }) => {
    const c = canary();
    const leaks: Leak[] = [];
    for (const path of [
      `/api/v1/public/events/${c.event.slug}`,
      `/api/v1/public/events/${c.event.slug}/ticket-types`,
      '/api/v1/mobile/config',
      '/api/v1/openapi.json',
      `/api/v1/orgs/${c.slug}`,
      `/api/v1/orgs/${c.slug}/events`,
      `/api/v1/events/${c.event.id}/manifest`,
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBeLessThan(500);
      leaks.push(...leaksIn(path, await res.text(), { kind: 'public' }));
    }
    const pub = await request.get(`/api/v1/public/events/${c.event.slug}`);
    expect(pub.status()).toBe(200);
    expect(formatLeaks(leaks)).toBe('no canary leaks');
  });

  test('/v1 with the org’s own key shows only the columns each allowlist names', async ({ request }) => {
    test.setTimeout(120_000);
    const c = canary();
    const auth = { authorization: `Bearer ${c.apiKey}` };
    const leaks: Leak[] = [];
    const seen = new Set<string>();
    const get = async (pattern: keyof typeof V1_ALLOW, path: string) => {
      const res = await request.get(`/api/v1${path}`, { headers: auth });
      expect(res.status(), path).toBe(200);
      const text = await res.text();
      for (const h of findCanaries(text)) seen.add(h.column);
      leaks.push(...leaksIn(path, text, { kind: 'scoped', allow: V1_ALLOW[pattern] ?? [] }));
      return JSON.parse(text) as { data?: { id: string }[] } & Record<string, unknown>;
    };
    const org = `/orgs/${c.slug}`;
    await get('/orgs/{org}', org);
    const events = (await get('/orgs/{org}/events', `${org}/events?limit=100`)).data ?? [];
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      await get('/orgs/{org}/events/{eventId}', `${org}/events/${e.id}`);
      await get('/orgs/{org}/events/{eventId}/ticket-types', `${org}/events/${e.id}/ticket-types`);
      const orders = (
        await get('/orgs/{org}/events/{eventId}/orders', `${org}/events/${e.id}/orders?limit=100`)
      ).data;
      for (const o of orders ?? []) await get('/orgs/{org}/orders/{orderId}', `${org}/orders/${o.id}`);
      const people = (
        await get('/orgs/{org}/events/{eventId}/attendees', `${org}/events/${e.id}/attendees?limit=100`)
      ).data;
      for (const a of people ?? [])
        await get(
          '/orgs/{org}/events/{eventId}/attendees/{attendeeId}',
          `${org}/events/${e.id}/attendees/${a.id}`,
        );
    }
    await get('/orgs/{org}/attendees/search', `${org}/attendees/search?q=canary`);
    // The check is live: the org does see its own buyers and guests (canaries) here.
    expect([...seen]).toEqual(
      expect.arrayContaining(['orders.orders.buyer_email', 'attendees.attendees.email']),
    );
    expect(formatLeaks(leaks)).toBe('no canary leaks');
  });

  test('live polls and Q&A: the participant page, the big screen and the public stream carry no canary', async ({
    page,
  }) => {
    // M5.7a: the canary org's keynote has a pending question whose body is a canary; only
    // approved questions may ever reach a public payload.
    const c = canary();
    await page.goto(`${MARKET}/events/${c.event.slug}`);
    const href = await page.locator(`a[href*="/events/${c.event.slug}/live/"]`).first().getAttribute('href');
    const sessionId = /\/live\/([0-9a-f-]{36})/.exec(href ?? '')?.[1] ?? '';
    expect(sessionId).not.toBe('');
    const secret = process.env.APP_TOKEN_SECRET ?? '';
    const token = signDisplayToken({ orgId: c.orgId, sessionId, version: 1 }, secret);
    const leaks: Leak[] = [];
    for (const url of [
      `${MARKET}/events/${c.event.slug}/live/${sessionId}`,
      `${MARKET}/ar/events/${c.event.slug}/live/${sessionId}`,
      `${MARKET}/display/${token}`,
    ]) {
      const res = await browserFetch(page, url);
      expect(res?.status, url).toBe(200);
      leaks.push(...leaksIn(url, `${res?.body ?? ''}\n${res?.extra ?? ''}`, { kind: 'public' }));
    }
    // The audience's realtime snapshot and the big screen's stream.
    const channel = `org:${c.orgId}:event:${c.event.id}:session:${sessionId}:live`;
    for (const url of [`/api/realtime/${encodeURIComponent(channel)}`, `/api/engagement/display/${token}`]) {
      const text = await page.evaluate(async (u) => {
        const ctrl = new AbortController();
        const res = await fetch(u, { signal: ctrl.signal });
        let out = `${res.status}\n`;
        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const deadline = Date.now() + 5_000;
          while (!out.includes('event: snapshot') && Date.now() < deadline) {
            const { value, done } = await reader.read();
            if (done) break;
            out += new TextDecoder().decode(value);
          }
        }
        ctrl.abort();
        return out;
      }, url);
      expect(text, url).toContain('event: snapshot');
      expect(text, url).toContain('How do fixtures stay isolated?');
      leaks.push(...leaksIn(url, text, { kind: 'public' }));
    }
    expect(formatLeaks(leaks)).toBe('no canary leaks');
  });

  test('networking: an opted-in attendee’s pages never show who opted out (or anything private)', async ({
    page,
  }) => {
    // M5.8a: the canary org's fixture event has networking on; its second person opted out, so
    // every profile column of theirs is a canary. Sign in (the emailed code) as the opted-in one
    // and crawl every networking page they can reach: nothing private may appear.
    const c = canary();
    const email = c.networkEmail;
    expect(email).not.toBeNull();
    const base = `${MARKET}/events/${c.event.slug}/network`;
    await page.goto(base);
    await page.getByLabel('Your email', { exact: true }).fill(email ?? '');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await page
      .getByLabel('Verification code', { exact: true })
      .fill(await lastEmailedCode(page, email ?? ''));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Networking sections' })).toBeVisible();
    const leaks: Leak[] = [];
    const seen: string[] = [];
    for (const url of [
      base,
      `${base}?q=canary`,
      `${base}?q=Ben`,
      `${base}?q=__`,
      `${base}/connections`,
      `${base}/meetings`,
      `${base}/profile`,
      `${MARKET}/ar/events/${c.event.slug}/network`,
      `${MARKET}/ar/events/${c.event.slug}/network/profile`,
    ]) {
      const f = await browserFetch(page, url);
      expect(f?.status, url).toBe(200);
      seen.push(`${f?.body ?? ''}\n${f?.extra ?? ''}`);
      leaks.push(...leaksIn(url, `${f?.body ?? ''}\n${f?.extra ?? ''}`, { kind: 'public' }));
    }
    // The crawl is live: the attendee's own profile is there; the one who opted out is not.
    expect(seen.join('\n')).toContain('Ana Fixture');
    expect(seen.join('\n')).not.toContain('Ben Fixture');
    expect(formatLeaks(leaks)).toBe('no canary leaks');
  });

  test('the door’s offline manifest (Scan PWA) carries only what the door needs', async ({
    request,
    page,
  }) => {
    const c = canary();
    const res = await request.get(`/api/v1/events/${c.event.id}/manifest?limit=2000`, {
      headers: { authorization: `Bearer ${c.deviceToken}` },
    });
    expect(res.status()).toBe(200);
    const text = await res.text();
    const manifest = JSON.parse(text) as { rows: unknown[] };
    expect(manifest.rows.length).toBeGreaterThan(0);
    expect(formatLeaks(leaksIn('manifest', text, { kind: 'scoped', allow: DOOR_ALLOW }))).toBe(
      'no canary leaks',
    );
    // The app shell and its manifest are public.
    const shell = await browserFetch(page, '/scan');
    const webmanifest = await browserFetch(page, '/scan.webmanifest');
    expect(shell?.status).toBe(200);
    expect(
      formatLeaks([
        ...leaksIn('/scan', `${shell?.body}${shell?.extra}`, { kind: 'public' }),
        ...leaksIn('/scan.webmanifest', webmanifest?.body ?? '', { kind: 'public' }),
      ]),
    ).toBe('no canary leaks');
  });

  test('export files show only their allowlisted columns; outbound messages no secret or internal data', () => {
    const c = canary();
    expect(c.exports.map((e) => e.kind).sort()).toEqual([
      'attendees',
      'audience',
      'audit',
      'bookings',
      'dsar',
    ]);
    const leaks = [
      ...c.exports.flatMap((e) =>
        leaksIn(`export:${e.kind} (${e.name})`, e.content, { kind: 'scoped', allow: EXPORT_ALLOW[e.kind] }),
      ),
      ...c.outbound.flatMap((m, i) => leaksIn(`${m.channel}#${i}`, m.payload, { kind: 'outbound' })),
    ];
    expect(c.outbound.length).toBeGreaterThan(0);
    // Live: the org's guests are in its attendee export.
    expect(c.exports.find((e) => e.kind === 'attendees')?.content.toLowerCase()).toContain(
      canaryToken('attendees.attendees.email').toLowerCase(),
    );
    expect(formatLeaks(leaks)).toBe('no canary leaks');
  });

  test('gate canary: the browser crawler fails on a planted leak (test-only route, no server code)', async ({
    page,
  }) => {
    const planted = 'http://planted.canary.test';
    await page.route(`${planted}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/')
        return route.fulfill({ contentType: 'text/html', body: '<a href="/event">event</a>' });
      if (path === '/event')
        return route.fulfill({
          contentType: 'text/html',
          headers: { 'x-debug-note': canaryToken('orders.refunds.note') },
          body: `<h1>Gala</h1><script>self.__next_f.push([1,"{\\"buyerEmail\\":\\"${canaryToken('orders.orders.buyer_email').toLowerCase()}@canary.test\\"}"])</script>`,
        });
      return route.fulfill({ status: 404, body: '' });
    });
    const r = await crawl({ start: [`${planted}/`], fetch: (u) => browserFetch(page, u) });
    expect(r.leaks.map((l) => [l.where, l.column])).toEqual([
      [`${planted}/event`, 'orders.orders.buyer_email'],
      [`${planted}/event`, 'orders.refunds.note'],
    ]);
    expect(formatLeaks(r.leaks)).toContain(`${planted}/event`);
  });
});
