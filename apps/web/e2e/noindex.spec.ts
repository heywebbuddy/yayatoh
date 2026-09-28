import { expect, type Page, test } from '@playwright/test';
import { OWNER, signIn } from './helpers.ts';

/**
 * The noindex guard (M1.11d; M1.11 "a CI guard that production never sends noindex"). `next
 * start` is production mode. Every page a public host lists in its sitemap is indexable (no
 * `X-Robots-Tag: noindex`, no robots meta noindex); private pages always send the header; preview
 * hosts, localhost and the dashboard host never index anything.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;
const HARBOR = `http://harbor-arts.yayatoh.events:${PORT}`;
const PREVIEW_HOST = `pr-7-yayatoh.vercel.app:${PORT}`;
const PREVIEW = `http://${PREVIEW_HOST}`;
const APP = `http://app.yayatoh.com:${PORT}`;

// Headers and metadata do not depend on the viewport: one project runs it.
test.beforeEach(() => {
  test.skip(test.info().project.name !== 'desktop-1280', 'viewport-independent; runs once');
});

async function robotsOf(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
  const header = res?.headers()['x-robots-tag'] ?? '';
  const meta = await page
    .locator('meta[name="robots"]')
    .getAttribute('content', { timeout: 1000 })
    .catch(() => null);
  return { status: res?.status() ?? 0, header, meta: meta ?? '' };
}

/**
 * The same over a plain HTTP request to this server with a preview Host header. Chromium's HSTS
 * preload list covers `vercel.app`, so the browser upgrades a navigation to it to https (which the
 * test server does not speak); a preview deployment receives exactly this Host.
 */
async function robotsOfHost(page: Page, host: string, path: string) {
  const res = await page.request.get(`http://localhost:${PORT}${path}`, {
    headers: { host },
    maxRedirects: 0,
  });
  const html = res.headers()['content-type']?.includes('text/html') ? await res.text() : '';
  const meta = /<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? '';
  return { status: res.status(), header: res.headers()['x-robots-tag'] ?? '', meta };
}

async function sitemapUrls(page: Page, origin: string): Promise<string[]> {
  const res = await page.goto(`${origin}/sitemaps/en.xml`);
  expect(res?.status()).toBe(200);
  const xml = (await res?.text()) ?? '';
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string);
}

test.describe('noindex guard (M1.11d)', () => {
  test('every page in the public sitemaps is indexable: no noindex header or meta', async ({ page }) => {
    test.setTimeout(300_000);
    const market = await sitemapUrls(page, MARKET);
    const harbor = await sitemapUrls(page, HARBOR);
    expect(market.length).toBeGreaterThan(3);
    expect(harbor.length).toBeGreaterThan(3);
    // The Arabic copy of a few too (hreflang alternates are public pages as well).
    const urls = [
      ...market,
      ...harbor.slice(0, 25),
      `${MARKET}/ar/events/lakeside-open-house`,
      `${HARBOR}/ar`,
    ];
    const bad: string[] = [];
    for (const url of urls) {
      const r = await robotsOf(page, url);
      if (r.status !== 200 || /noindex/i.test(r.header) || /noindex/i.test(r.meta))
        bad.push(`${url} → ${r.status} header="${r.header}" meta="${r.meta}"`);
    }
    expect(bad).toEqual([]);
  });

  test('regression: a postponed event is served (and indexable) on its own tenant site', async ({ page }) => {
    // It is listed in the site's sitemap; the tenant page used to 404 because a postponed event
    // has no checkout target.
    const r = await robotsOf(page, `${HARBOR}/events/harbor-autumn-gala`);
    expect(r).toEqual({ status: 200, header: '', meta: expect.stringMatching(/^index/) });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Harbor Autumn Gala');
    // Another org's event on this host is still a 404.
    expect((await page.goto(`${HARBOR}/events/lakeside-open-house`))?.status()).toBe(404);
  });

  test('private pages on public hosts always send X-Robots-Tag: noindex', async ({ page }) => {
    test.setTimeout(180_000);
    const paths = [
      '/o/lakeside-events/settings',
      '/sign-in',
      '/signup',
      '/checkout/fake',
      '/my-tickets/not-a-token',
      '/orders/not-a-token',
      '/claim/not-a-token',
      '/invite/not-a-token',
      '/scan',
      '/embed/lakeside-open-house',
      '/events/lakeside-open-house/unlock',
      '/messages/not-a-token',
      '/unsubscribe/not-a-token',
      '/ar/sign-in',
    ];
    const bad: string[] = [];
    for (const origin of [MARKET, HARBOR])
      for (const p of paths) {
        const r = await robotsOf(page, `${origin}${p}`);
        if (!/noindex/.test(r.header)) bad.push(`${origin}${p} → ${r.status} header="${r.header}"`);
      }
    expect(bad).toEqual([]);
  });

  test('the organizer console (signed in) is noindex; the public organizer page is not', async ({ page }) => {
    await signIn(page, OWNER);
    const console = await robotsOf(page, '/o/lakeside-events');
    expect(console.status).toBe(200);
    expect(console.header).toBe('noindex, nofollow');
    const organizer = await robotsOf(page, `${MARKET}/o/lakeside-events`);
    expect(organizer.status).toBe(200);
    expect(organizer.header).toBe('');
    expect(organizer.meta).toMatch(/^index/);
  });

  test('preview, localhost and dashboard hosts never index a public page (header and meta)', async ({
    page,
  }) => {
    for (const origin of [PREVIEW, `http://localhost:${PORT}`, APP]) {
      const path = '/events/lakeside-open-house';
      const r =
        origin === PREVIEW
          ? await robotsOfHost(page, PREVIEW_HOST, path)
          : await robotsOf(page, `${origin}${path}`);
      expect([origin, r.header]).toEqual([origin, 'noindex, nofollow']);
      if (r.status === 200) expect([origin, r.meta]).toEqual([origin, expect.stringMatching(/noindex/)]);
    }
    const preview = await robotsOfHost(page, PREVIEW_HOST, '/');
    expect(preview.header).toBe('noindex, nofollow');
    expect(preview.meta).toMatch(/noindex/);
  });
});
