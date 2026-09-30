import { expect, type Page, test } from '@playwright/test';
import { LOCALES } from '@yayatoh/contracts';
import { EventJsonLdSchema } from '../src/lib/seo/jsonld.ts';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const MARKET = `http://yayatoh.localhost:${PORT}`;
const HARBOR = `http://harbor-arts.yayatoh.events:${PORT}`;

async function jsonLd(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(blocks).toHaveLength(1);
  return EventJsonLdSchema.parse(JSON.parse(blocks[0] ?? ''));
}

test.describe('robots and sitemaps (M1.11b)', () => {
  test('each public host serves its own robots.txt pointing at its sitemap', async ({ page }) => {
    const market = await page.goto(`${MARKET}/robots.txt`);
    expect(market?.status()).toBe(200);
    expect(market?.headers()['content-type']).toContain('text/plain');
    const text = (await market?.text()) ?? '';
    expect(text).toContain('Allow: /');
    expect(text).toContain('Disallow: /checkout/');
    expect(text).toContain(`Sitemap: ${MARKET}/sitemap.xml`);
    const tenant = (await (await page.goto(`${HARBOR}/robots.txt`))?.text()) ?? '';
    expect(tenant).toContain(`Sitemap: ${HARBOR}/sitemap.xml`);
    // Dev and preview hosts are never indexed.
    const dev = (await (await page.goto('/robots.txt'))?.text()) ?? '';
    expect(dev).toBe('User-agent: *\nDisallow: /\n');
  });

  test('the sitemap index lists one sitemap per locale with a lastmod', async ({ page }) => {
    const res = await page.goto(`${MARKET}/sitemap.xml`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()['content-type']).toContain('application/xml');
    const xml = (await res?.text()) ?? '';
    for (const l of LOCALES) expect(xml).toContain(`<loc>${MARKET}/sitemaps/${l}.xml</loc>`);
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
  });

  test('a locale sitemap lists only public pages, with hreflang alternates', async ({ page }) => {
    const xml = (await (await page.goto(`${MARKET}/sitemaps/ar.xml`))?.text()) ?? '';
    expect(xml).toContain(`<loc>${MARKET}/ar/events/lakeside-open-house</loc>`);
    expect(xml).toContain(`<loc>${MARKET}/ar/o/lakeside-events</loc>`);
    expect(xml).toContain(`hreflang="x-default" href="${MARKET}/events/lakeside-open-house"`);
    // Harbor's events live on its tenant site (their canonical home), cancelled and private never.
    expect(xml).not.toContain('harbor-film-night');
    expect(xml).not.toContain('harbor-winter-show');
    expect(xml).not.toContain('harper-and-theo');
    expect(xml).not.toContain('/checkout');
    const tenant = (await (await page.goto(`${HARBOR}/sitemaps/en.xml`))?.text()) ?? '';
    expect(tenant).toContain(`<loc>${HARBOR}/events/harbor-film-night</loc>`);
    expect(tenant).not.toContain('lakeside-open-house');
    expect((await page.goto(`${MARKET}/sitemaps/xx.xml`))?.status()).toBe(404);
  });
});

test.describe('canonical, hreflang, JSON-LD and share images (M1.11b)', () => {
  test('an event with a tenant site is canonical there, on both hosts, with 13 hreflang + x-default', async ({
    page,
  }) => {
    for (const origin of [MARKET, HARBOR]) {
      await page.goto(`${origin}/events/harbor-film-night`);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        `${HARBOR}/events/harbor-film-night`,
      );
      await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(LOCALES.length + 1);
      await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute(
        'href',
        `${HARBOR}/ar/events/harbor-film-night`,
      );
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index/);
    }
  });

  test('a marketplace organizer’s event is canonical on the marketplace; the locale page too', async ({
    page,
  }) => {
    await page.goto(`${MARKET}/fr/events/lakeside-open-house`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${MARKET}/fr/events/lakeside-open-house`,
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  });

  test('JSON-LD Event is present, parseable and valid: absolute URLs, ISO country, offers', async ({
    page,
  }) => {
    await page.goto(`${MARKET}/events/harbor-film-night`);
    const ld = await jsonLd(page);
    expect(ld.name).toBe('Harbor Film Night');
    // An in-person event: one Place with a PostalAddress (online events get a VirtualLocation).
    expect(ld.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
    expect(
      !Array.isArray(ld.location) && 'address' in ld.location && ld.location.address.addressCountry,
    ).toBe('FR');
    expect(ld.eventStatus).toBe('https://schema.org/EventScheduled');
    expect(ld.url).toBe(`${HARBOR}/events/harbor-film-night`);
    expect(ld.organizer.url).toBe(`${MARKET}/o/harbor-arts`);
    expect(ld.offers?.map((o) => o.priceCurrency)).toEqual(['EUR', 'EUR']);
    expect(ld.image[0]).toMatch(/^http:\/\/.+\/api\/og\/event\/harbor-film-night$/);
  });

  test('JSON-LD marks a postponed event', async ({ page }) => {
    await page.goto(`${MARKET}/events/harbor-autumn-gala`);
    expect((await jsonLd(page)).eventStatus).toBe('https://schema.org/EventPostponed');
    await page.goto(`${MARKET}/events/harbor-winter-show`);
    expect((await jsonLd(page)).eventStatus).toBe('https://schema.org/EventCancelled');
    // A cancelled event has no listing: reachable but not indexed.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('og:image is absolute and the image route returns a PNG in the org colours', async ({ page }) => {
    await page.goto(`${HARBOR}/events/harbor-spring-concert`);
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og).toMatch(/^https?:\/\/[^/]+\/api\/og\/event\/harbor-spring-concert$/);
    const img = await page.request.get(`/api/og/event/harbor-spring-concert`);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toBe('image/png');
    expect((await img.body()).length).toBeGreaterThan(1000);
    const org = await page.request.get('/api/og/org/harbor-arts');
    expect(org.headers()['content-type']).toBe('image/png');
    expect((await page.request.get('/api/og/event/no-such-event')).status()).toBe(404);
  });
});

test.describe('legacy URLs (M1.11b)', () => {
  test('a legacy root organizer URL 308s to /o/{slug}', async ({ page }) => {
    const res = await page.request.get(`/harbor-arts?ref=poster`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers().location).toMatch(/^(http:\/\/localhost:\d+)?\/o\/harbor-arts\?ref=poster$/);
    await page.goto(`${MARKET}/harbor-arts`);
    await expect(page).toHaveURL(`${MARKET}/o/harbor-arts`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbor Arts Collective');
  });

  test('a renamed event URL and a legacy prefix redirect, data-driven', async ({ page }) => {
    const renamed = await page.request.get('/events/harbor-concert-2027', { maxRedirects: 0 });
    expect(renamed.status()).toBe(308);
    expect(renamed.headers().location).toMatch(/\/events\/harbor-spring-concert$/);
    const prefix = await page.request.get('/organiser/harbor-arts', { maxRedirects: 0 });
    expect(prefix.status()).toBe(308);
    expect(prefix.headers().location).toMatch(/\/o\/harbor-arts$/);
    // Unknown legacy paths are an ordinary 404.
    expect((await page.request.get(`/no-such-legacy-page-${Date.now()}`, { maxRedirects: 0 })).status()).toBe(
      404,
    );
  });

  test('/lang/{code} switches the language and returns to the page (legacy 500 fixed)', async ({ page }) => {
    await page.goto(`${MARKET}/events?q=jazz`);
    await page.getByRole('contentinfo').getByRole('link', { name: 'العربية' }).click();
    await expect(page).toHaveURL(`${MARKET}/ar/events?q=jazz`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const res = await page.request.get('/lang/de', {
      maxRedirects: 0,
      headers: { referer: `http://localhost:${PORT}/fr/events?q=jazz` },
    });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toMatch(/^(http:\/\/localhost:\d+)?\/de\/events\?q=jazz$/);
    expect(res.headers()['set-cookie']).toContain('NEXT_LOCALE=de');
  });
});
