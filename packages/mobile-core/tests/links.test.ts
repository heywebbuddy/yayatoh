import { ROUTES, routeForLink, routeForPush } from '../src/links/routes';

const TICKET = '3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c';
const attendee = (url: string) => routeForLink(url, { app: 'mobile' });
const staff = (url: string) => routeForLink(url, { app: 'staff' });

describe('universal links (attendee app)', () => {
  it.each([
    ['https://abc.yayatoh.events/events/summit-2026', ROUTES.event, { slug: 'summit-2026', org: 'abc' }],
    ['https://yayatoh.com/events/summit-2026', ROUTES.event, { slug: 'summit-2026' }],
    ['https://app.yayatoh.com/e/Xk3p9', ROUTES.eventShort, { code: 'Xk3p9' }],
    ['https://abc.yayatoh.events/e/Xk3p9', ROUTES.eventShort, { code: 'Xk3p9', org: 'abc' }],
    [
      'https://yayatoh.com/my-tickets/AbCdEf123456_-token',
      ROUTES.ticketLink,
      { token: 'AbCdEf123456_-token' },
    ],
    ['https://app.yayatoh.com/orders/ord_Token-12345', ROUTES.orderLink, { token: 'ord_Token-12345' }],
    ['https://app.yayatoh.com/claim/claimTOKEN987', ROUTES.claim, { token: 'claimTOKEN987' }],
  ])('%s', (url, pathname, params) => {
    expect(attendee(url)).toEqual({ pathname, params });
  });

  it('keeps the checkout return markers of an event link, and nothing else of its query (M7.3c)', () => {
    const order = '0b9e5a5c-6f0d-4c43-9d57-0d5f3b7d2a11';
    expect(attendee(`https://yayatoh.com/events/summit?checkout=return&order=${order}&utm_source=x`)).toEqual(
      {
        pathname: ROUTES.event,
        params: { slug: 'summit', checkout: 'return', order },
      },
    );
    expect(attendee(`https://abc.yayatoh.events/events/summit?checkout=cancelled&order=${order}`)).toEqual({
      pathname: ROUTES.event,
      params: { slug: 'summit', org: 'abc', checkout: 'cancelled', order },
    });
    // A value that is not one of the two, or an order that is not an id, is dropped.
    expect(attendee('https://yayatoh.com/events/summit?checkout=paid&order=1')).toEqual({
      pathname: ROUTES.event,
      params: { slug: 'summit' },
    });
    expect(attendee('https://yayatoh.com/events/summit?checkout=return&order=../../x')).toEqual({
      pathname: ROUTES.event,
      params: { slug: 'summit', checkout: 'return' },
    });
    // Other attendee links never carry the markers.
    expect(attendee(`https://yayatoh.com/claim/abcdefgh1?checkout=return&order=${order}`)).toEqual({
      pathname: ROUTES.claim,
      params: { token: 'abcdefgh1' },
    });
  });

  it('strips a locale prefix (Arabic, Chinese) and ignores query and fragment', () => {
    expect(attendee('https://yayatoh.com/ar/events/summit?utm=x#top')).toEqual({
      pathname: ROUTES.event,
      params: { slug: 'summit' },
    });
    expect(attendee('https://yayatoh.com/zh-CN/claim/abcdefgh')).toEqual({
      pathname: ROUTES.claim,
      params: { token: 'abcdefgh' },
    });
    // The default locale has no prefix on the web, so `/en/…` is not a link the server publishes.
    expect(attendee('https://yayatoh.com/en/events/x')).toBeNull();
  });

  it.each([
    ['a host that is not ours', 'https://evil.example/events/summit'],
    ['a look-alike host', 'https://yayatoh.com.evil.example/events/summit'],
    ['a look-alike tenant', 'https://abc.yayatoh.events.evil.example/events/x'],
    ['the bare tenant apex', 'https://yayatoh.events/events/x'],
    ['plain http', 'http://yayatoh.com/events/summit'],
    ['a path outside the allowlist (sign-in)', 'https://yayatoh.com/sign-in'],
    ['checkout', 'https://yayatoh.com/checkout/abc'],
    ['an extra segment', 'https://yayatoh.com/events/summit/tickets'],
    ['a missing id', 'https://yayatoh.com/events'],
    ['path traversal', 'https://yayatoh.com/events/..%2F..%2Fadmin'],
    ['an escaped slash', 'https://yayatoh.com/claim/a%2Fb'],
    ['a javascript scheme', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<script>1</script>'],
    ['not a URL', 'hello'],
    ['empty', ''],
    ['a user-info host trick', 'https://yayatoh.com@evil.example/events/x'],
  ])('refuses %s', (_name, url) => {
    expect(attendee(url)).toBeNull();
  });

  it('refuses an overlong or odd segment', () => {
    expect(attendee(`https://yayatoh.com/claim/${'a'.repeat(201)}`)).toBeNull();
    expect(attendee('https://yayatoh.com/claim/a b')).toBeNull();
    expect(attendee('https://yayatoh.com/claim/<x>')).toBeNull();
  });

  it('honours a different tenant domain', () => {
    expect(
      routeForLink('https://abc.example.test/events/x', { app: 'mobile', tenantDomain: 'example.test' }),
    ).toEqual({
      pathname: ROUTES.event,
      params: { slug: 'x', org: 'abc' },
    });
    expect(
      routeForLink('https://abc.yayatoh.events/events/x', { app: 'mobile', tenantDomain: 'example.test' }),
    ).toBeNull();
  });

  it('the Staff enrolment link is not for the attendee app', () => {
    expect(attendee(`https://app.yayatoh.com/scan#e=${TICKET}&k=KEYKEYKEY12345`)).toBeNull();
  });
});

describe('app-scheme links', () => {
  it('opens the same routes through the app’s own scheme', () => {
    expect(attendee('yayatoh://claim/claimTOKEN987')).toEqual({
      pathname: ROUTES.claim,
      params: { token: 'claimTOKEN987' },
    });
    expect(attendee('yayatoh-dev://events/summit')).toEqual({
      pathname: ROUTES.event,
      params: { slug: 'summit' },
    });
  });
  it('refuses a scheme that is not the app’s', () => {
    expect(attendee('myapp://claim/claimTOKEN987')).toBeNull();
    expect(attendee('file:///etc/passwd')).toBeNull();
  });
});

describe('Staff enrolment link', () => {
  const key = 'k_ABCDEFGHIJKLMNOP-1234';
  it('reads the event and key from the fragment', () => {
    expect(staff(`https://app.yayatoh.com/scan#e=${TICKET}&k=${key}`)).toEqual({
      pathname: ROUTES.enrol,
      params: { event: TICKET, key },
    });
    expect(staff(`yayatoh-staff://scan#e=${TICKET}&k=${key}`)).toEqual({
      pathname: ROUTES.enrol,
      params: { event: TICKET, key },
    });
    expect(staff(`https://abc.yayatoh.events/fr/scan#e=${TICKET}&k=${key}`)?.pathname).toBe(ROUTES.enrol);
  });
  it('never takes the key from the query string (it would reach server logs)', () => {
    expect(staff(`https://app.yayatoh.com/scan?e=${TICKET}&k=${key}`)).toBeNull();
  });
  it('refuses a bare scanner page, a bad event id and a malformed key', () => {
    expect(staff('https://app.yayatoh.com/scan')).toBeNull();
    expect(staff(`https://app.yayatoh.com/scan#e=not-a-uuid&k=${key}`)).toBeNull();
    expect(staff(`https://app.yayatoh.com/scan#e=${TICKET}&k=short`)).toBeNull();
    expect(staff(`https://app.yayatoh.com/scan#e=${TICKET}&k=${'x'.repeat(600)}`)).toBeNull();
    expect(staff(`https://app.yayatoh.com/scan#e=${TICKET}`)).toBeNull();
  });
  it('the attendee paths are not for the Staff app', () => {
    expect(staff('https://yayatoh.com/events/summit')).toBeNull();
  });
});

describe('push payloads', () => {
  it.each([
    [{ path: `/tickets/${TICKET}` }, ROUTES.ticket, { id: TICKET }],
    [{ path: `/orders/${TICKET}` }, ROUTES.order, { id: TICKET }],
    [{ path: '/events/summit-2026' }, ROUTES.event, { slug: 'summit-2026' }],
    [`/tickets/${TICKET}`, ROUTES.ticket, { id: TICKET }],
  ])('%j', (data, pathname, params) => {
    expect(routeForPush(data)).toEqual({ pathname, params });
  });

  it.each([
    ['no payload', undefined],
    ['null', null],
    ['no path', {}],
    ['a number', { path: 7 }],
    ['an absolute URL', { path: 'https://evil.example/tickets/x' }],
    ['a protocol-relative URL', { path: '//evil.example/x' }],
    ['a query string', { path: `/tickets/${TICKET}?x=1` }],
    ['a ticket id that is not a UUID', { path: '/tickets/12345' }],
    ['an unknown kind', { path: '/admin/users' }],
    ['too deep', { path: `/tickets/${TICKET}/qr` }],
    ['traversal', { path: '/events/..' }],
    ['an overlong path', { path: `/events/${'a'.repeat(400)}` }],
  ])('refuses %s', (_n, data) => {
    expect(routeForPush(data)).toBeNull();
  });
});

// M7.x security review (link hijacking): hosts and paths a crafted link could use to reach a screen
// or to leak a secret. None of these may produce a route.
describe('link hijacking (M7.x)', () => {
  const KEY = 'yyd_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE';
  const EVENT = '3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c';

  it.each([
    // Look-alike and nested hosts.
    'https://yayatoh.com.evil.example/claim/abcdefgh1',
    'https://evilyayatoh.com/claim/abcdefgh1',
    'https://app.yayatoh.com.evil.example/claim/abcdefgh1',
    'https://yayatoh.events/claim/abcdefgh1',
    'https://a.b.yayatoh.events/claim/abcdefgh1',
    'https://-.yayatoh.events/claim/abcdefgh1',
    'https://x.yayatoh.events.evil.example/claim/abcdefgh1',
    // Credentials, ports and encoded separators in the authority.
    'https://yayatoh.com@evil.example/claim/abcdefgh1',
    'https://evil.example@yayatoh.com/claim/abcdefgh1',
    'https://evil.example%40yayatoh.com/claim/abcdefgh1',
    'https://yayatoh.com:8443/claim/abcdefgh1',
    'https://yayatoh.com%2eevil.example/claim/abcdefgh1',
    'https://yayatoh.com\\@evil.example/claim/abcdefgh1',
    // Plain http, other schemes, odd forms.
    'http://yayatoh.com/claim/abcdefgh1',
    'javascript://yayatoh.com/claim/abcdefgh1',
    'intent://yayatoh.com/claim/abcdefgh1#Intent;scheme=https;end',
    'file:///claim/abcdefgh1',
    '//yayatoh.com/claim/abcdefgh1',
    'yayatoh.com/claim/abcdefgh1',
    'https:/yayatoh.com/claim/abcdefgh1',
    // Paths that climb, double up or smuggle separators.
    'https://yayatoh.com/claim/../tickets/abcdefgh1',
    'https://yayatoh.com/claim/%2e%2e/abcdefgh1',
    'https://yayatoh.com/claim/abcdefgh1/extra',
    'https://yayatoh.com/claim/abc%2Fdefgh1',
    'https://yayatoh.com/claim/abcdefgh1%00',
    'https://yayatoh.com/claim/abc defgh1',
    'https://yayatoh.com/organizer/settings',
    'https://yayatoh.com/o/acme/events',
    'https://yayatoh.com/api/v1/me/tickets',
    'https://yayatoh.com/sign-in',
    'https://yayatoh.com/admin',
  ])('is not a route: %s', (url) => {
    expect(attendee(url)).toBeNull();
  });

  it('treats a doubled slash and surrounding whitespace as the same link, never as another host', () => {
    const expected = { pathname: ROUTES.claim, params: { token: 'abcdefgh1' } };
    expect(attendee('https://yayatoh.com//claim/abcdefgh1')).toEqual(expected);
    expect(attendee(' https://yayatoh.com/claim/abcdefgh1\n')).toEqual(expected);
  });

  it('opens nothing from a scheme that merely starts like ours', () => {
    for (const url of [
      'yayatoh.evil://claim/abcdefgh1',
      'yayatohx://claim/abcdefgh1',
      'xyayatoh://claim/abcdefgh1',
      'yayatoh-staff2://scan#e=x',
    ])
      expect(attendee(url)).toBeNull();
  });

  it('never routes a Staff enrolment link whose key is not in the fragment or is not a real key shape', () => {
    // The key in the query string, in the path, doubled, or too short.
    expect(staff(`https://yayatoh.com/scan?e=${EVENT}&k=${KEY}`)).toBeNull();
    expect(staff(`https://yayatoh.com/scan/${KEY}#e=${EVENT}`)).toBeNull();
    expect(staff(`https://yayatoh.com/scan#e=${EVENT}&k=short`)).toBeNull();
    expect(staff(`https://yayatoh.com/scan#e=not-a-uuid&k=${KEY}`)).toBeNull();
    // A look-alike host never reaches the enrolment screen.
    expect(staff(`https://yayatoh.com.evil.example/scan#e=${EVENT}&k=${KEY}`)).toBeNull();
    expect(staff(`https://evil.example@yayatoh.com/scan#e=${EVENT}&k=${KEY}`)).toBeNull();
    // And the real one still does, with the key only in the params (never in the pathname).
    const ok = staff(`https://app.yayatoh.com/scan#e=${EVENT}&k=${KEY}`);
    expect(ok).toEqual({ pathname: ROUTES.enrol, params: { event: EVENT, key: KEY } });
    expect(ok?.pathname).not.toContain(KEY);
  });

  it('a push payload cannot open anything but a ticket, an order or an event', () => {
    for (const path of [
      '/tickets/../orders/3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c',
      '/admin/users',
      '/claim/abcdefgh1',
      '//evil.example/tickets/3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c',
      'https://evil.example/tickets/3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c',
      '/tickets/3f2b8c1e-5d4a-4e6b-9a7c-0d1e2f3a4b5c?x=1',
      '/tickets/not-a-uuid',
      `/events/${'a'.repeat(300)}`,
    ])
      expect(routeForPush({ path })).toBeNull();
  });
});
