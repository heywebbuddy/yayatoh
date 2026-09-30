import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { expect, test } from '@playwright/test';
import { adminClient } from '@yayatoh/db/testing';
import { FD_ABC_HOST, FD_YAY_HOST, LEGACY_STUB_PORT } from './front-door-env.ts';
import { expectAccessible } from './helpers.ts';

/**
 * The coexistence front door (M2.4a, ADR 0020) against the local legacy stub: what is forwarded
 * and how, what never is, per-route flags, single-hop redirects, cookie scoping, streaming,
 * timeouts and the counters. Request-level checks talk to the server with a Host header (Node
 * can't resolve *.localhost); browser checks use the hosts directly (Chromium resolves them).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const YAY = `http://${FD_YAY_HOST}:${PORT}`;

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  json: () => Record<string, unknown> & { headers: Record<string, string | null> };
}

/** One request to the e2e server as `host`, redirects not followed. */
function hit(
  host: string,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: Buffer } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: opts.method ?? 'GET',
        headers: {
          host: `${host}:${PORT}`,
          ...(opts.body ? { 'content-length': String(opts.body.length) } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body.toString()),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
    req.end(opts.body);
  });
}

/** Flag states this spec relies on (every test sets the same ones, so projects never race). */
async function setFlags() {
  const sql = adminClient();
  try {
    const flags: [string, string, string][] = [
      [FD_YAY_HOST, 'events.listing', 'next'],
      [FD_YAY_HOST, 'events.page', 'canary'],
      [FD_YAY_HOST, 'organizers.page', 'next'],
      [FD_YAY_HOST, 'home', 'legacy'],
      [FD_YAY_HOST, 'venues.page', 'legacy'],
      [FD_ABC_HOST, 'home', 'next'],
    ];
    for (const [host, route, state] of flags) {
      const [cur] = await sql<{ state: string }[]>`
        select state from platform.front_door_flags where host = ${host} and route = ${route}`;
      if ((cur?.state ?? 'legacy') !== state)
        await sql`select platform.set_front_door_flag(${host}, ${route}, ${state}, 1, 'staff:e2e', 'front-door e2e', now())`;
    }
    // Legacy URL shapes (roadmap §7.7), owned by the seeded marketplace org.
    const [org] = await sql<
      { id: string }[]
    >`select id from tenancy.organizations where slug = 'harbor-arts'`;
    const redirects: [string, string, string, number][] = [
      ['/fd-organiser', 'prefix', '/fd-org', 301],
      ['/fd-org/harbor', 'exact', '/o/harbor-arts', 308],
      ['/fd-old-venue', 'exact', '/venues/lakeside-pavilion', 308],
    ];
    for (const [source, match, target, status] of redirects)
      await sql`
        insert into marketplace.legacy_redirects (org_id, host, source, match, target, status)
        values (${org?.id ?? ''}, ${FD_YAY_HOST}, ${source}, ${match}, ${target}, ${status})
        on conflict (host, source) do update set target = excluded.target, match = excluded.match,
          status = excluded.status`;
  } finally {
    await sql.end();
  }
  // The proxy caches flags for 300 ms in e2e.
  await new Promise((r) => setTimeout(r, 700));
}

async function stubLog(): Promise<{ instance: string; method: string; path: string }[]> {
  const res = await fetch(`http://127.0.0.1:${LEGACY_STUB_PORT}/__stub/log`);
  return (await res.json()) as { instance: string; method: string; path: string }[];
}

test.describe('front door: requests (M2.4a)', () => {
  // Request-level checks don't depend on the viewport: once, not three times.
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop-1280', 'request-level: runs in one project');
  });
  test.beforeAll(setFlags);

  test('an unowned path is forwarded to its instance’s legacy origin: method, body, status, headers', async () => {
    const tag = randomBytes(4).toString('hex');
    const get = await hit(FD_YAY_HOST, `/some/legacy/page-${tag}?a=1&b=two`);
    expect(get.status).toBe(200);
    expect(get.headers['x-front-door']).toBe('legacy');
    expect(get.headers['x-legacy-stub']).toBe('yay');
    const echo = get.json();
    expect(echo.path).toBe(`/some/legacy/page-${tag}`);
    expect(echo.search).toBe('?a=1&b=two');
    expect(echo.headers['x-forwarded-host']).toBe(`${FD_YAY_HOST}:${PORT}`);
    expect(echo.headers['x-forwarded-proto']).toBe('http');
    expect(echo.headers['x-yayatoh-front-door']).toBe('e2e-front-door-secret');
    // Legacy pages are not dressed in the new app's page headers.
    expect(get.headers['content-security-policy']).toBeUndefined();
    expect(get.headers['set-cookie']).toBeUndefined();

    const form = Buffer.from(`name=Ann&tag=${tag}`);
    const post = await hit(FD_YAY_HOST, '/bookings/book', {
      method: 'POST',
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(post.json()).toMatchObject({
      legacy: 'yay',
      method: 'POST',
      bodyBytes: form.length,
      bodySha256: createHash('sha256').update(form).digest('hex'),
    });
    for (const method of ['PUT', 'PATCH', 'DELETE'])
      expect((await hit(FD_YAY_HOST, '/x', { method, body: Buffer.from('{}') })).json().method).toBe(method);

    // Status passes through, 404 and 5xx included; HEAD has no body.
    expect((await hit(FD_YAY_HOST, `/missing/${tag}`)).status).toBe(404);
    expect((await hit(FD_YAY_HOST, '/stub/500')).status).toBe(500);
    const head = await hit(FD_YAY_HOST, '/anything', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);

    // The abc host goes to the abc origin, never the yayatoh.com one.
    expect((await hit(FD_ABC_HOST, `/some/legacy/page-${tag}`)).json().legacy).toBe('abc');
  });

  test('hop-by-hop headers, client-set proxy headers and the new app’s cookies never reach legacy', async () => {
    const echo = (
      await hit(FD_YAY_HOST, '/headers', {
        headers: {
          connection: 'keep-alive, x-evil',
          'x-evil': 'drop me',
          'x-forwarded-host': 'evil.example',
          'x-yayatoh-front-door': 'forged',
          cookie: 'laravel_session=abc; XSRF-TOKEN=t; yy.session=s; yy_did=d; NEXT_LOCALE=ar; yy_canary=next',
        },
      })
    ).json();
    expect(echo.headers.cookie).toBe('laravel_session=abc; XSRF-TOKEN=t');
    expect(echo.headers['x-evil']).toBeNull();
    expect(echo.headers['x-forwarded-host']).toBe(`${FD_YAY_HOST}:${PORT}`);
    expect(echo.headers['x-yayatoh-front-door']).toBe('e2e-front-door-secret');
  });

  test('/api/v2 and the new app’s own paths are never forwarded', async () => {
    const before = (await stubLog()).length;
    for (const [method, path] of [
      ['GET', '/api/v2/events'],
      ['POST', '/api/v2/login'],
      ['GET', '/api/v2'],
      ['GET', '/api/v1/health'],
      ['GET', '/sign-in'],
      ['GET', '/widget.js'],
    ] as const) {
      const r = await hit(FD_YAY_HOST, path, {
        method,
        ...(method === 'POST' ? { body: Buffer.from('{}') } : {}),
        headers: { cookie: 'yy_legacy=1' },
      });
      expect(r.headers['x-legacy-stub'], path).toBeUndefined();
      expect(r.headers['x-front-door'], path).not.toBe('legacy');
    }
    const after = await stubLog();
    expect(after.slice(before).filter((l) => l.path.startsWith('/api') || l.path === '/sign-in')).toEqual([]);
    expect(after.some((l) => l.path.startsWith('/api/v2'))).toBe(false);
  });

  test('an owned route is served by the new app per host; canary and legacy cookies override', async () => {
    const listing = await hit(FD_YAY_HOST, '/events', { headers: { accept: 'text/html' } });
    expect(listing.status).toBe(200);
    expect(listing.headers['x-front-door']).toBe('next');
    expect(listing.headers['x-legacy-stub']).toBeUndefined();
    expect(listing.headers['content-security-policy']).toContain('nonce-');
    // Search is a separate route, still on legacy.
    expect((await hit(FD_YAY_HOST, '/events?search=jazz')).headers['x-legacy-stub']).toBe('yay');
    // The escape hatch.
    expect(
      (await hit(FD_YAY_HOST, '/events', { headers: { cookie: 'yy_legacy=1' } })).headers['x-legacy-stub'],
    ).toBe('yay');
    // Canary: only browsers with the cookie get the new app.
    expect((await hit(FD_YAY_HOST, '/events/fd-some-event')).headers['x-legacy-stub']).toBe('yay');
    const canary = await hit(FD_YAY_HOST, '/events/fd-some-event', { headers: { cookie: 'yy_canary=next' } });
    expect(canary.headers['x-front-door']).toBe('next');
    expect(canary.status).toBe(404);
    // Home is still legacy on this host; on abc it is flagged but abc isn't attached to an org
    // yet, so legacy keeps it rather than the new app answering "unknown site".
    expect((await hit(FD_YAY_HOST, '/')).headers['x-legacy-stub']).toBe('yay');
    expect((await hit(FD_ABC_HOST, '/')).headers['x-legacy-stub']).toBe('abc');
    // A host that isn't a front-door host is unaffected.
    expect((await hit('localhost', '/events')).headers['x-front-door']).toBeUndefined();
  });

  test('legacy URL shapes redirect in one hop, and only once the new home is served here', async () => {
    const first = await hit(FD_YAY_HOST, '/fd-organiser/harbor?utm=mail');
    expect(first.status).toBe(301);
    expect(first.headers.location).toBe(`http://${FD_YAY_HOST}:${PORT}/o/harbor-arts?utm=mail`);
    // The target answers directly: no second redirect.
    const landed = await hit(FD_YAY_HOST, '/o/harbor-arts?utm=mail', { headers: { accept: 'text/html' } });
    expect(landed.status).toBe(200);
    expect(landed.headers['x-front-door']).toBe('next');
    // Venue pages are still on legacy: the legacy URL keeps being served by legacy (no redirect).
    const venue = await hit(FD_YAY_HOST, '/fd-old-venue');
    expect(venue.status).toBe(200);
    expect(venue.headers['x-legacy-stub']).toBe('yay');
    expect(venue.json().path).toBe('/fd-old-venue');
  });

  test('legacy cookies are scoped to the host that set them; the new app’s can’t be forged', async () => {
    const r = await hit(FD_YAY_HOST, '/stub/set-cookie');
    expect(r.headers['set-cookie']).toEqual([
      'legacy_session=s3cret; Path=/; HttpOnly; SameSite=Lax',
      'XSRF-TOKEN=tok; Path=/',
    ]);
    // Legacy redirects to its own origin come back on the public host.
    const redirect = await hit(FD_YAY_HOST, '/stub/redirect');
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(`http://${FD_YAY_HOST}:${PORT}/stub/landed?from=legacy`);
  });

  test('streams large responses and uploads; slow legacy waits, too slow is a 504', async () => {
    const big = await hit(FD_YAY_HOST, '/stub/stream?mb=60');
    expect(big.status).toBe(200);
    expect(big.body.length).toBe(60 * 1024 * 1024);
    const upload = randomBytes(25 * 1024 * 1024);
    const up = await hit(FD_YAY_HOST, '/uploads/image', {
      method: 'POST',
      body: upload,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(up.json()).toMatchObject({
      bodyBytes: upload.length,
      bodySha256: createHash('sha256').update(upload).digest('hex'),
    });
    // Compressed legacy responses arrive intact.
    const gz = await hit(FD_YAY_HOST, '/stub/gzip');
    expect(gz.body.toString()).toContain('gzipped legacy yay');
    // Within the 3 s header timeout of the e2e server: served. Past it: the front door's 504.
    expect((await hit(FD_YAY_HOST, '/stub/slow?ms=1500')).status).toBe(200);
    const slow = await hit(FD_YAY_HOST, '/stub/slow?ms=5000');
    expect(slow.status).toBe(504);
    expect(slow.headers['cache-control']).toBe('no-store');
  });

  test('the same path on two hosts is two answers: nothing is cached across hosts', async () => {
    for (let i = 0; i < 2; i++) {
      expect((await hit(FD_YAY_HOST, '/shared/path')).json().legacy).toBe('yay');
      expect((await hit(FD_ABC_HOST, '/shared/path')).json().legacy).toBe('abc');
    }
    // New-app pages on the front-door host keep their per-org answers.
    const a = await hit(FD_YAY_HOST, '/o/harbor-arts', { headers: { accept: 'text/html' } });
    const b = await hit(FD_YAY_HOST, '/o/lakeside-events', { headers: { accept: 'text/html' } });
    expect(a.body.toString()).toContain('Harbor Arts');
    expect(b.body.toString()).not.toContain('Harbor Arts');
  });

  test('counts requests, 404s, proxy errors and latency per route', async () => {
    const tag = randomBytes(4).toString('hex');
    await hit(FD_YAY_HOST, `/missing/fd-${tag}`);
    await hit(FD_YAY_HOST, '/stub/slow?ms=5000');
    await new Promise((r) => setTimeout(r, 1500));
    const sql = adminClient();
    try {
      const [legacy] = await sql<
        { requests: number; not_found: number; proxy_errors: number; latency_count: number }[]
      >`
        select requests::int, not_found::int, proxy_errors::int, latency_count::int
        from platform.front_door_stats
        where day = (now() at time zone 'UTC')::date and host = ${FD_YAY_HOST}
          and route = 'legacy' and served_by = 'legacy'`;
      expect(legacy?.requests).toBeGreaterThan(2);
      expect(legacy?.not_found).toBeGreaterThan(0);
      expect(legacy?.proxy_errors).toBeGreaterThan(0);
      expect(legacy?.latency_count).toBeGreaterThan(0);
      const [missing] = await sql<{ count: number }[]>`
        select count::int from platform.front_door_not_found
        where host = ${FD_YAY_HOST} and path = ${`/missing/fd-${tag}`} and served_by = 'legacy'`;
      expect(missing?.count).toBe(1);
      const [next] = await sql<{ requests: number }[]>`
        select requests::int from platform.front_door_stats
        where day = (now() at time zone 'UTC')::date and host = ${FD_YAY_HOST}
          and route = 'events.listing' and served_by = 'next'`;
      expect(next?.requests).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  });
});

test.describe('front door: in the browser (M2.4a)', () => {
  test.beforeAll(setFlags);

  test('a moved page is the new app (keyboard, axe, Arabic RTL); the rest is legacy', async ({ page }) => {
    await page.goto(`${YAY}/events`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessible(page);
    // Keyboard: search from the moved listing. Search is its own route and still on legacy, so
    // the form lands on the legacy site (the table moves each surface separately).
    const box = page.getByLabel('Search by name, place or organizer');
    await box.focus();
    await page.keyboard.type('jazz');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Legacy yay /events' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('q')).toBe('jazz');

    await page.goto(`${YAY}/ar/events`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expectAccessible(page);

    // An unmoved page shows the legacy site.
    await page.goto(`${YAY}/login`);
    await expect(page.getByRole('heading', { name: 'Legacy yay /login' })).toBeVisible();
  });

  test('legacy is down or slow: a localized error page, right to left in Arabic', async ({ page }) => {
    const res = await page.goto(`${YAY}/ar/stub/slow?ms=5000`);
    expect(res?.status()).toBe(504);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تستغرق هذه الصفحة وقتًا طويلًا');
    await expectAccessible(page);
  });

  test('a legacy cookie stays on its host', async ({ page, context }) => {
    await page.goto(`${YAY}/stub/set-cookie`);
    const cookies = await context.cookies(YAY);
    const legacy = cookies.find((c) => c.name === 'legacy_session');
    expect(legacy?.domain).toBe(FD_YAY_HOST);
    expect(cookies.some((c) => c.name === 'yy.session' && c.value === 'forged')).toBe(false);
    // The abc host never receives it.
    const abc = await page.goto(`http://${FD_ABC_HOST}:${PORT}/stub/echo`);
    const echo = (await abc?.json()) as { legacy: string; headers: { cookie: string | null } };
    expect(echo.legacy).toBe('abc');
    expect(echo.headers.cookie ?? '').not.toContain('legacy_session');
  });

  test('a new-app 404 on a moved route is counted for the 404 top list', async ({ page }, info) => {
    const path = `/o/fd-no-such-org-${info.project.name}-${randomBytes(3).toString('hex')}`;
    const res = await page.goto(`${YAY}${path}`);
    expect(res?.status()).toBe(404);
    expect(res?.headers()['x-front-door']).toBe('next');
    await expect
      .poll(
        async () => {
          const sql = adminClient();
          try {
            const [row] = await sql<{ count: number }[]>`
              select count::int from platform.front_door_not_found
              where host = ${FD_YAY_HOST} and path = ${path} and served_by = 'next'`;
            return row?.count ?? 0;
          } finally {
            await sql.end();
          }
        },
        { timeout: 10_000 },
      )
      .toBe(1);
  });
});
