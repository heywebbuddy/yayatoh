import { ROUTES } from '@yayatoh/mobile-core';
import { hrefFor } from '../src/links/hrefs';
import { needsSignIn, resolveIncomingUrl } from '../src/links/incoming';
import {
  hasPendingHref,
  PENDING_LINK_TTL_MS,
  rememberPendingHref,
  takePendingHref,
} from '../src/links/pending';
import { createTapLedger, hrefForPush } from '../src/push/routing';
import { ORDER_ID, push, TICKET_ID } from './helpers/push-ids';

function deps(signedIn = true) {
  const purchases: number[] = [];
  return {
    purchases,
    isSignedIn: async () => signedIn,
    onPurchase: () => void purchases.push(1),
  };
}

beforeEach(() => {
  takePendingHref();
});

describe('hrefFor', () => {
  it('fills dynamic segments with encoded values and puts the rest in the query', () => {
    expect(hrefFor({ pathname: ROUTES.event, params: { slug: 'summit-2026' } })).toBe('/events/summit-2026');
    expect(hrefFor({ pathname: ROUTES.event, params: { slug: 'summit', org: 'acme' } })).toBe(
      '/events/summit?org=acme',
    );
    expect(hrefFor({ pathname: ROUTES.claim, params: { token: 'a b/c' } })).toBe('/claim/a%20b%2Fc');
  });
});

describe('universal and app-scheme links open their screens', () => {
  const cases: [string, string][] = [
    ['https://acme.yayatoh.events/events/summit', '/events/summit?org=acme'],
    ['https://app.yayatoh.com/events/summit', '/events/summit'],
    ['https://yayatoh.com/ar/events/summit', '/events/summit'],
    ['https://acme.yayatoh.events/e/AbC123', '/e/AbC123?org=acme'],
    ['https://app.yayatoh.com/claim/tok_1234567890', '/claim/tok_1234567890'],
    ['yayatoh://claim/tok_1234567890', '/claim/tok_1234567890'],
    ['yayatoh-dev://events/summit', '/events/summit'],
    ['https://app.yayatoh.com/my-tickets/holdertoken123', '/tickets/link/holdertoken123'],
    ['https://app.yayatoh.com/orders/ordertoken1234', '/orders/link/ordertoken1234'],
  ];
  it.each(cases)('%s -> %s (signed in)', async (url, href) => {
    expect(await resolveIncomingUrl(url, deps(true))).toBe(href);
  });

  it('a bare path from the OS is judged as if on the app host', async () => {
    expect(await resolveIncomingUrl('/events/summit', deps())).toBe('/events/summit');
  });

  it('a link we do not serve opens Home, not a "not found" screen', async () => {
    expect(await resolveIncomingUrl('https://app.yayatoh.com/admin/secret', deps())).toBe('/');
    expect(await resolveIncomingUrl('https://app.yayatoh.com/events/a/b', deps())).toBe('/');
    expect(await resolveIncomingUrl('https://app.yayatoh.com/events/%2e%2e', deps())).toBe('/');
    expect(await resolveIncomingUrl('yayatoh://tickets/../../x', deps())).toBe('/');
    expect(await resolveIncomingUrl(null, deps())).toBe('/');
  });

  it('a link that is not ours at all passes through (the development client, other apps)', async () => {
    const dev = 'exp+yayatoh://expo-development-client/?url=http%3A%2F%2F192.168.1.2%3A8081';
    expect(await resolveIncomingUrl(dev, deps())).toBe(dev);
    expect(await resolveIncomingUrl('https://evil.example/events/summit', deps())).toBe(
      'https://evil.example/events/summit',
    );
    expect(await resolveIncomingUrl('https://yayatoh.com.evil.example/events/x', deps())).toBe(
      'https://yayatoh.com.evil.example/events/x',
    );
  });

  it('a link meant for the Staff app opens nothing here', async () => {
    const k = 'secretkeysecretkey';
    expect(await resolveIncomingUrl(`https://app.yayatoh.com/scan#e=${ORDER_ID}&k=${k}`, deps())).toBe('/');
  });
});

describe('links that need sign-in', () => {
  it('knows which routes those are', () => {
    expect(needsSignIn(ROUTES.ticket)).toBe(true);
    expect(needsSignIn(ROUTES.order)).toBe(true);
    expect(needsSignIn(ROUTES.ticketLink)).toBe(true);
    expect(needsSignIn(ROUTES.orderLink)).toBe(true);
    // The claim screen explains the claim to a signed-out person first; events are public.
    expect(needsSignIn(ROUTES.claim)).toBe(false);
    expect(needsSignIn(ROUTES.event)).toBe(false);
  });

  it('signed out: goes to the front door and keeps the link to resume after sign-in', async () => {
    const d = deps(false);
    expect(await resolveIncomingUrl('https://app.yayatoh.com/my-tickets/holdertoken123', d)).toBe('/');
    expect(hasPendingHref()).toBe(true);
    expect(takePendingHref()).toBe('/tickets/link/holdertoken123');
    expect(hasPendingHref()).toBe(false);
  });

  it('signed out: public screens open at once and nothing is kept', async () => {
    const d = deps(false);
    expect(await resolveIncomingUrl('https://app.yayatoh.com/events/summit', d)).toBe('/events/summit');
    expect(await resolveIncomingUrl('yayatoh://claim/tok_1234567890', d)).toBe('/claim/tok_1234567890');
    expect(hasPendingHref()).toBe(false);
  });

  it('a remembered link is used once and not after half an hour', () => {
    rememberPendingHref('/tickets/link/x1234567', 1_000);
    expect(takePendingHref(1_000 + PENDING_LINK_TTL_MS)).toBe('/tickets/link/x1234567');
    expect(takePendingHref()).toBeNull();
    rememberPendingHref('/tickets/link/x1234567', 1_000);
    expect(takePendingHref(1_000 + PENDING_LINK_TTL_MS + 1)).toBeNull();
  });
});

describe('the checkout return link (M7.2f)', () => {
  const base = 'https://app.yayatoh.com/events/summit';

  it('opens the event screen with its markers and counts as the first-purchase moment', async () => {
    const d = deps(true);
    expect(await resolveIncomingUrl(`${base}?checkout=return&order=${ORDER_ID}`, d)).toBe(
      `/events/summit?checkout=return&order=${ORDER_ID}`,
    );
    expect(d.purchases).toHaveLength(1);
  });

  it('the cancel link keeps its markers too and is not a purchase', async () => {
    const d = deps(true);
    expect(await resolveIncomingUrl(`${base}?checkout=cancelled&order=${ORDER_ID}`, d)).toBe(
      `/events/summit?checkout=cancelled&order=${ORDER_ID}`,
    );
    expect(d.purchases).toHaveLength(0);
  });

  it('works on a tenant host and keeps the organization', async () => {
    const d = deps(true);
    const href = await resolveIncomingUrl(
      `https://acme.yayatoh.events/events/summit?checkout=return&order=${ORDER_ID}`,
      d,
    );
    // The query's order is the router's; what matters is the path and the three values.
    const [path, query] = href.split('?');
    expect(path).toBe('/events/summit');
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      org: 'acme',
      checkout: 'return',
      order: ORDER_ID,
    });
  });

  it('never counts a return with a bad or missing order as a purchase, and drops a made-up marker', async () => {
    const d = deps(true);
    // The shared router keeps a bare `checkout` marker (M7.3c): the event screen reads it as a return
    // with no order. Without a valid order it never counts as a purchase, so no prompt (below).
    expect(await resolveIncomingUrl(`${base}?checkout=return&order=../../x`, d)).toBe(
      '/events/summit?checkout=return',
    );
    expect(await resolveIncomingUrl(`${base}?checkout=return`, d)).toBe('/events/summit?checkout=return');
    expect(await resolveIncomingUrl(`${base}?checkout=paid&order=${ORDER_ID}`, d)).toBe('/events/summit');
    expect(d.purchases).toHaveLength(0);
  });

  it('needs no sign-in: the event screen is public', async () => {
    const d = deps(false);
    expect(await resolveIncomingUrl(`${base}?checkout=return&order=${ORDER_ID}`, d)).toBe(
      `/events/summit?checkout=return&order=${ORDER_ID}`,
    );
    expect(hasPendingHref()).toBe(false);
  });
});

describe('a tapped push opens its screen', () => {
  it.each([
    ['push.order-confirmed', `/orders/${ORDER_ID}`, `/orders/${ORDER_ID}`],
    ['push.ticket-received', `/tickets/${TICKET_ID}`, `/tickets/${TICKET_ID}`],
    ['push.transfer-accepted', `/orders/${ORDER_ID}`, `/orders/${ORDER_ID}`],
    ['push.transfer-cancelled', `/tickets/${TICKET_ID}`, `/tickets/${TICKET_ID}`],
    ['push.event-changed', '/events/summit-2026', '/events/summit-2026'],
    ['push.event-cancelled', '/events/summit-2026', '/events/summit-2026'],
    ['push.reminder-24h', `/tickets/${TICKET_ID}`, `/tickets/${TICKET_ID}`],
    ['push.reminder-2h', '/events/summit-2026', '/events/summit-2026'],
  ])('%s', (_kind, path, href) => {
    expect(hrefForPush(push(path), true)).toEqual({ href, resume: false });
  });

  it('opens nothing for a payload that is not one of the three paths', () => {
    for (const path of [
      '/admin',
      '/tickets/not-a-uuid',
      `/tickets/${TICKET_ID}/x`,
      `/tickets/${TICKET_ID}?x=1`,
      'https://evil.example/tickets/x',
      '',
    ]) {
      expect(hrefForPush(push(path), true)).toBeNull();
    }
    expect(hrefForPush(push(null), true)).toBeNull();
    expect(hrefForPush(push('/events/x', { data: 'garbage' }), true)).toBeNull();
  });

  it('signed out: the ticket or order waits for sign-in; an event does not', () => {
    expect(hrefForPush(push(`/tickets/${TICKET_ID}`), false)).toEqual({ href: '/', resume: true });
    expect(takePendingHref()).toBe(`/tickets/${TICKET_ID}`);
    expect(hrefForPush(push('/events/summit'), false)).toEqual({ href: '/events/summit', resume: false });
  });

  it('a tap is handled once', () => {
    const ledger = createTapLedger(2);
    expect(ledger.first('a')).toBe(true);
    expect(ledger.first('a')).toBe(false);
    expect(ledger.first('b')).toBe(true);
    expect(ledger.first('c')).toBe(true);
    expect(ledger.first('a')).toBe(true); // the oldest was forgotten
  });
});
