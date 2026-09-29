import { uuidv7 } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import { isLikelyBot } from '../src/domain/bots.ts';
import { pseudonym, signClickId, uuidv7Time, verifyClickToken } from '../src/domain/click-token.ts';
import { destinationProblem, redirectTarget } from '../src/domain/destination.ts';
import { decodeUtmCookie, encodeUtmCookie, nextUtmCookie, utmFromParams } from '../src/domain/utm.ts';
import { conversionBps, DAY_MS, inWindow, pickTouches, type Touch } from '../src/domain/window.ts';

const SECRET = 'x'.repeat(64);
const NOW = Date.parse('2027-06-01T12:00:00Z');
const day = DAY_MS;

describe('signed click id', () => {
  const id = uuidv7(NOW - 60_000);

  it('round-trips and carries its own time', () => {
    const token = signClickId(id, SECRET);
    expect(token.startsWith(`${id}~`)).toBe(true);
    expect(uuidv7Time(id)).toBe(NOW - 60_000);
    expect(verifyClickToken(token, SECRET, { now: NOW, maxAgeMs: day })).toBe(id);
  });

  it('rejects a changed signature, a changed id, another secret and junk', () => {
    const token = signClickId(id, SECRET);
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(verifyClickToken(`${token.slice(0, -1)}${last}`, SECRET, { now: NOW, maxAgeMs: day })).toBeNull();
    const other = uuidv7(NOW - 60_000);
    expect(
      verifyClickToken(`${other}${token.slice(token.indexOf('~'))}`, SECRET, { now: NOW, maxAgeMs: day }),
    ).toBeNull();
    expect(verifyClickToken(token, 'y'.repeat(64), { now: NOW, maxAgeMs: day })).toBeNull();
    for (const junk of ['', '~', 'abc', `${id}`, `${id}~`, `not-a-uuid~abc`, `${token}${'a'.repeat(100)}`])
      expect(verifyClickToken(junk, SECRET, { now: NOW, maxAgeMs: day })).toBeNull();
    expect(verifyClickToken(null, SECRET, { now: NOW, maxAgeMs: day })).toBeNull();
  });

  it('expires after maxAge and refuses tokens from the future', () => {
    const old = signClickId(uuidv7(NOW - 2 * day), SECRET);
    expect(verifyClickToken(old, SECRET, { now: NOW, maxAgeMs: day })).toBeNull();
    expect(verifyClickToken(old, SECRET, { now: NOW, maxAgeMs: 3 * day })).not.toBeNull();
    const future = signClickId(uuidv7(NOW + 10 * 60_000), SECRET);
    expect(verifyClickToken(future, SECRET, { now: NOW, maxAgeMs: day })).toBeNull();
  });

  it('only signs uuidv7 ids', () => {
    expect(() => signClickId('00000000-0000-4000-8000-000000000000', SECRET)).toThrow();
  });

  it('pseudonyms are keyed, stable and differ per kind', () => {
    expect(pseudonym('ip', '203.0.113.9', SECRET)).toMatch(/^[0-9a-f]{32}$/);
    expect(pseudonym('ip', '203.0.113.9', SECRET)).toBe(pseudonym('ip', '203.0.113.9', SECRET));
    expect(pseudonym('ip', '203.0.113.9', SECRET)).not.toBe(pseudonym('device', '203.0.113.9', SECRET));
    expect(pseudonym('ip', '203.0.113.9', SECRET)).not.toBe(pseudonym('ip', '203.0.113.9', 'z'.repeat(64)));
  });
});

describe('open-redirect guard', () => {
  it('accepts same-site paths', () => {
    for (const ok of [
      '/',
      '/events/summer-gala',
      '/events/summer-gala/seat-finder',
      '/o/lakeside',
      '/e/abc-123',
      '/caf%C3%A9',
    ])
      expect(destinationProblem(ok)).toBeNull();
  });

  it('refuses URLs, protocol-relative and backslash tricks, encoded slashes and dot segments', () => {
    const cases: [string, string][] = [
      ['https://evil.example', 'not_a_path'],
      ['//evil.example', 'not_a_path'],
      ['/\\evil.example', 'not_a_path'],
      ['javascript:alert(1)', 'not_a_path'],
      ['evil.example/path', 'not_a_path'],
      ['', 'not_a_path'],
      ['/%2F%2Fevil.example', 'invalid_characters'],
      ['/%5Cevil.example', 'invalid_characters'],
      ['/events/../../admin', 'invalid_characters'],
      ['/events/./x', 'invalid_characters'],
      ['/%2e%2e/admin', 'invalid_characters'],
      ['/path\twith\ttabs', 'invalid_characters'],
      ['/path\nnewline', 'invalid_characters'],
      ['/a?next=https://evil.example', 'invalid_characters'],
      ['/a#frag', 'invalid_characters'],
      ['/a\\b', 'invalid_characters'],
      ['/a%zz', 'invalid_characters'],
      ['/a%00', 'invalid_characters'],
      ['/<script>', 'invalid_characters'],
      [`/${'a'.repeat(300)}`, 'too_long'],
    ];
    for (const [path, problem] of cases) expect([path, destinationProblem(path)]).toEqual([path, problem]);
  });

  const base = {
    origin: 'https://lakeside-events.yayatoh.events',
    localePrefix: '',
    path: '/events/summer-gala',
    utm: { source: 'newsletter', medium: 'email', campaign: 'launch', content: null, term: null },
    incoming: new URLSearchParams(),
    clickToken: null,
  };

  it('builds a same-origin Location with the link UTM values and the click id', () => {
    const loc = redirectTarget({ ...base, clickToken: 'abc~def' });
    expect(loc.startsWith('/events/summer-gala?')).toBe(true);
    const q = new URL(loc, base.origin).searchParams;
    expect(q.get('utm_source')).toBe('newsletter');
    expect(q.get('utm_medium')).toBe('email');
    expect(q.get('utm_campaign')).toBe('launch');
    expect(q.get('yyc')).toBe('abc~def');
    expect(q.has('utm_content')).toBe(false);
  });

  it('keeps incoming utm_* values the link does not set; the link wins otherwise; other params drop', () => {
    const loc = redirectTarget({
      ...base,
      incoming: new URLSearchParams(
        'utm_term=gala+tickets&utm_source=spoofed&next=//evil.example&yyc=forged',
      ),
    });
    const q = new URL(loc, base.origin).searchParams;
    expect(q.get('utm_term')).toBe('gala tickets');
    expect(q.get('utm_source')).toBe('newsletter');
    expect(q.has('next')).toBe(false);
    expect(q.has('yyc')).toBe(false);
  });

  it('prefixes the locale and never leaves the origin', () => {
    expect(redirectTarget({ ...base, localePrefix: '/ar' }).startsWith('/ar/events/summer-gala?')).toBe(true);
    expect(redirectTarget({ ...base, localePrefix: '/ar', path: '/' }).startsWith('/ar?')).toBe(true);
    for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example'])
      expect(() => redirectTarget({ ...base, path })).toThrow();
    expect(() => redirectTarget({ ...base, localePrefix: '//evil.example' })).toThrow();
  });
});

describe('attribution window', () => {
  const event = '0190a000-0000-7000-8000-000000000001';
  const other = '0190a000-0000-7000-8000-000000000002';
  const order = { eventId: event, at: new Date(NOW) };
  const touch = (clickId: string, daysBefore: number, eventId = event, linkId = 'l1'): Touch => ({
    clickId,
    linkId,
    eventId,
    clickedAt: new Date(NOW - daysBefore * day),
  });

  it('first touch is the earliest counting click, last touch the latest', () => {
    const t = pickTouches(
      [touch('b', 3, event, 'l2'), touch('a', 20, event, 'l1'), touch('c', 1, event, 'l3')],
      order,
      30,
    );
    expect(t?.first.clickId).toBe('a');
    expect(t?.last.clickId).toBe('c');
  });

  it('one click is both touches', () => {
    const t = pickTouches([touch('a', 2)], order, 30);
    expect(t?.first).toBe(t?.last);
  });

  it('ignores clicks outside the window, after the order and for other events', () => {
    expect(pickTouches([touch('old', 31)], order, 30)).toBeNull();
    expect(pickTouches([touch('edge', 30)], order, 30)?.first.clickId).toBe('edge');
    expect(pickTouches([touch('later', -1)], order, 30)).toBeNull();
    expect(pickTouches([touch('skew', -1 / (24 * 60))], order, 30)?.first.clickId).toBe('skew');
    expect(pickTouches([touch('elsewhere', 1, other)], order, 30)).toBeNull();
    const t = pickTouches([touch('old', 10), touch('new', 2)], order, 7);
    expect([t?.first.clickId, t?.last.clickId]).toEqual(['new', 'new']);
  });

  it('inWindow bounds and conversion', () => {
    expect(inWindow(new Date(NOW - 7 * day), new Date(NOW), 7)).toBe(true);
    expect(inWindow(new Date(NOW - 7 * day - 1), new Date(NOW), 7)).toBe(false);
    expect(conversionBps(1, 4)).toBe(2500);
    expect(conversionBps(3, 0)).toBe(0);
    expect(conversionBps(2, 3)).toBe(6667);
  });
});

describe('UTM landings', () => {
  it('reads utm values (source required), cleaned and bounded', () => {
    expect(utmFromParams(new URLSearchParams('utm_medium=email'))).toBeNull();
    const u = utmFromParams(
      new URLSearchParams(`utm_source=%20news%3Cletter%3E%00&utm_campaign=${'c'.repeat(150)}&utm_medium=`),
    );
    expect(u).toEqual({
      source: 'newsletter',
      medium: null,
      campaign: 'c'.repeat(100),
      content: null,
      term: null,
    });
  });

  it('the cookie keeps the first landing and replaces the last; an old first starts again', () => {
    const a = { source: 'facebook', medium: 'social', campaign: 'spring' };
    const b = { source: 'newsletter', medium: 'email', campaign: 'launch' };
    const c1 = nextUtmCookie(null, a, NOW - 5 * day, 90 * day);
    const c2 = nextUtmCookie(c1, b, NOW, 90 * day);
    expect(c2.first.source).toBe('facebook');
    expect(c2.last.source).toBe('newsletter');
    const decoded = decodeUtmCookie(encodeUtmCookie(c2));
    expect(decoded?.first).toMatchObject({ source: 'facebook', at: NOW - 5 * day });
    expect(decoded?.last).toMatchObject({ source: 'newsletter', at: NOW });
    expect(nextUtmCookie(c1, b, NOW + 100 * day, 90 * day).first.source).toBe('newsletter');
  });

  it('malformed cookies are ignored', () => {
    for (const bad of [
      '',
      'x',
      Buffer.from('{}').toString('base64url'),
      Buffer.from('[[1],[2]]').toString('base64url'),
      'a'.repeat(3000),
    ])
      expect(decodeUtmCookie(bad)).toBeNull();
  });
});

describe('bot filtering', () => {
  it('flags crawlers, previews, tools and empty agents; lets browsers through', () => {
    for (const ua of [
      '',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1',
      'Slackbot-LinkExpanding 1.0',
      'WhatsApp/2.23.20.0',
      'curl/8.4.0',
      'python-requests/2.31',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
      'Twitterbot/1.0',
      'LinkedInBot/1.0',
    ])
      expect([ua, isLikelyBot(ua)]).toEqual([ua, true]);
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ])
      expect(isLikelyBot(ua)).toBe(false);
  });
});
