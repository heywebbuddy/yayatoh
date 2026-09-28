import { describe, expect, it } from 'vitest';
import {
  allowed,
  canaryToken,
  crawl,
  extractLinks,
  type Fetched,
  findCanaries,
  formatLeaks,
  leaksIn,
  PHONE_PREFIX,
  phoneColumns,
} from '../src/canary/index.ts';

const EMAIL = 'orders.orders.buyer_email';
const TOKEN_HASH = 'checkin.devices.token_hash';
const NOTE = 'orders.refunds.note';

describe('canary matcher', () => {
  it('finds canaries in text, email and URL shapes, case-insensitively, once per column', () => {
    const html = `<p>${canaryToken(NOTE)}</p><a href="mailto:${canaryToken(EMAIL).toLowerCase()}2@canary.test">x</a>
      <a href="https://canary.test/${canaryToken('events.event_private_info.join_url')}">join</a>
      <script>self.__next_f.push([1,"${canaryToken(NOTE)}3"])</script>`;
    expect(findCanaries(html).map((h) => [h.column, h.class])).toEqual([
      [NOTE, 'internal'],
      [EMAIL, 'personal'],
      ['events.event_private_info.join_url', 'holder'],
    ]);
  });

  it('finds phone canaries with or without the plus', () => {
    const [first] = phoneColumns();
    expect(findCanaries(`call ${PHONE_PREFIX}0002`).map((h) => h.column)).toEqual([first]);
    expect(findCanaries(`tel:${PHONE_PREFIX.slice(1)}0001`).map((h) => h.column)).toEqual([first]);
    expect(findCanaries('+19995551234 is a canary, +15550100 is not')).toHaveLength(1);
  });

  it('an unregistered canary is unknown and never allowed', () => {
    const [hit] = findCanaries('__CANARY_media.assets.secret_note__');
    expect(hit).toMatchObject({ column: 'media.assets.secret_note', class: 'unknown' });
    expect(allowed(hit as never, { kind: 'scoped', allow: ['media.assets.secret_note'] })).toBe(false);
  });

  it('applies the surface rules: public nothing, scoped its allowlist but no secret, outbound no internal', () => {
    const text = [EMAIL, TOKEN_HASH, NOTE, 'tickets.tickets.x'].map(canaryToken).join(' ');
    const cols = (s: Parameters<typeof leaksIn>[2]) => leaksIn('u', text, s).map((l) => l.column);
    expect(cols({ kind: 'public' })).toEqual([EMAIL, TOKEN_HASH, NOTE, 'tickets.tickets.x']);
    expect(cols({ kind: 'scoped', allow: [EMAIL, TOKEN_HASH] })).toEqual([TOKEN_HASH, NOTE, 'tickets.tickets.x']);
    expect(cols({ kind: 'outbound' })).toEqual([TOKEN_HASH, NOTE, 'tickets.tickets.x']);
    expect(leaksIn('u', 'nothing here __CANARY_ but broken', { kind: 'public' })).toEqual([]);
  });

  it('formats every hit with its URL and column', () => {
    const msg = formatLeaks(leaksIn('https://x.test/e', canaryToken(EMAIL), { kind: 'public' }));
    expect(msg).toBe(`1 canary leak(s):\n  https://x.test/e\n    ${EMAIL} (personal) ← "${canaryToken(EMAIL)}"`);
    expect(formatLeaks([])).toBe('no canary leaks');
  });
});

describe('canary crawler (gate canary: a planted leak fails the crawl)', () => {
  const site: Record<string, Fetched> = {
    'https://market.test/': {
      status: 200,
      contentType: 'text/html',
      body: '<a href="/events/a">A</a><a href="/events/b#tickets">B</a><a href="https://elsewhere.test/x">x</a><link rel="alternate" href="/fr/events/a">',
    },
    'https://market.test/events/a': { status: 200, contentType: 'text/html', body: '<a href="/o/org">org</a>' },
    'https://market.test/fr/events/a': { status: 200, contentType: 'text/html', body: canaryToken(NOTE) },
    'https://market.test/events/b': {
      status: 200,
      contentType: 'text/html',
      body: '<a href="/sitemap.xml">map</a>',
      // A leak only in what the browser sees (a header, the hydrated DOM).
      extra: `x-debug: ${canaryToken(TOKEN_HASH)}`,
    },
    'https://market.test/sitemap.xml': {
      status: 200,
      contentType: 'application/xml',
      body: '<urlset><url><loc>https://market.test/planted</loc></url></urlset>',
    },
    'https://market.test/planted': {
      status: 200,
      contentType: 'text/html',
      body: `<script type="application/ld+json">{"email":"${canaryToken(EMAIL).toLowerCase()}@canary.test"}</script>`,
    },
    'https://market.test/o/org': { status: 500, contentType: 'text/html', body: 'boom' },
  };
  const fetch = async (url: string) => site[url] ?? { status: 404, contentType: 'text/html', body: '' };

  it('extracts same-page links from HTML, sitemaps and robots.txt', () => {
    expect(
      extractLinks(
        '<a href="/a?x=1&amp;y=2#f">a</a><img src="//cdn.test/i.png"><a href="mailto:x@y">m</a>',
        'https://h.test/p',
      ),
    ).toEqual(['https://h.test/a?x=1&y=2', 'https://cdn.test/i.png']);
    expect(extractLinks('User-agent: *\nSitemap: https://h.test/sitemap.xml\n', 'https://h.test/')).toEqual([
      'https://h.test/sitemap.xml',
    ]);
  });

  it('finds the planted leaks breadth-first, lists every hit, reports 5xx, never leaves the origin', async () => {
    const r = await crawl({ start: ['https://market.test/'], fetch, maxPages: 50 });
    expect(r.visited).not.toContain('https://elsewhere.test/x');
    expect(r.leaks.map((l) => [l.where, l.column])).toEqual([
      ['https://market.test/events/b', TOKEN_HASH],
      ['https://market.test/fr/events/a', NOTE],
      ['https://market.test/planted', EMAIL],
    ]);
    expect(r.errors).toEqual([{ url: 'https://market.test/o/org', status: 500 }]);
    expect(formatLeaks(r.leaks)).toContain('https://market.test/planted');
  });

  it('respects the page cap and the follow filter', async () => {
    const capped = await crawl({ start: ['https://market.test/'], fetch, maxPages: 2 });
    expect(capped.visited).toHaveLength(2);
    const noLocales = await crawl({
      start: ['https://market.test/'],
      fetch,
      follow: (u) => !u.pathname.startsWith('/fr/'),
    });
    expect(noLocales.leaks.map((l) => l.column)).not.toContain(NOTE);
  });
});
