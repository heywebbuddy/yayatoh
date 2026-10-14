import { randomBytes } from 'node:crypto';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  type EventDto,
  setEventDetailsCommand,
  transitionEventCommand,
} from '@yayatoh/events';
import { buildRow, type FloorplanDoc } from '@yayatoh/floorplan';
import { publishFormCommand } from '@yayatoh/forms';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { catchUpListings, updateSiteSettingsCommand } from '@yayatoh/marketplace';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  expireOrdersCommand,
  startCheckoutCommand,
} from '@yayatoh/orders';
import { fakePaymentProvider } from '@yayatoh/payments';
import { createRateLimiter, memoryRateLimitStore } from '@yayatoh/platform/security';
import {
  assignSeatCategoryCommand,
  publishEventLayoutCommand,
  setEventLayoutCommand,
} from '@yayatoh/seating';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { createPromoCodeCommand, createTicketTypeCommand } from '@yayatoh/ticketing';
import { createVenueCommand } from '@yayatoh/venues';
import { setTicketAccessCommand } from '@yayatoh/virtual';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1 } from '../src/index.ts';

/**
 * M7.2f: `GET /v1/public/events` (the apps' event search over the public read model) and
 * `POST /v1/public/events/{slug}/checkout` (the same hold → payment → attach steps as the web's
 * `checkoutAction`, for a signed-in person). Fake payment provider only.
 */
const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const sessions = bearerSessions(auth);
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const WEB = 'https://app.yayatoh.test';
const limiter = createRateLimiter(memoryRateLimitStore());
const app = new Hono().route(
  '/v1',
  createV1({
    ports,
    sessions: () => sessions,
    payments: () => payments,
    telemetry: false,
    mobile: { baseUrls: { api: 'https://api.yayatoh.test/v1', web: WEB } },
    checkoutLimiter: limiter,
  }),
);
const admin = adminClient();
const password = 'correct horse battery';
const run = randomBytes(4).toString('hex');
const tag = uuidv7().slice(-8);

// biome-ignore lint/suspicious/noExplicitAny: a test reads response bodies loosely
type Json = Record<string, any>;
async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; key?: string | null; headers?: Record<string, string> } = {},
) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.key === null ? {} : opts.key ? { 'idempotency-key': opts.key } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: (text ? JSON.parse(text) : null) as Json };
}

async function person(name: string, verified = true) {
  const email = `${name}-${run}@example.test`;
  const r = await auth.api.signUpEmail({ body: { email, password, name } });
  await admin`update auth.users set email_verified = ${verified} where id = ${r.user.id}`;
  const login = await call('POST', '/auth/login', { body: { email, password } });
  return { email, id: r.user.id, token: String(login.body.token) };
}

let a: OrgFixture;
let b: OrgFixture;

const event = (o: OrgFixture, name: string, extra: Record<string, unknown> = {}): Promise<EventDto> =>
  executeCommand(
    createEventCommand,
    {
      name: `${name} ${tag}`,
      timezone: 'Europe/Paris',
      startsAt: '2031-05-01T18:00:00Z',
      endsAt: '2031-05-01T22:00:00Z',
      city: 'Paris',
      country: 'FR',
      currency: 'EUR',
      ...extra,
    },
    o.ctx(),
    ports,
  );
const publish = (o: OrgFixture, eventId: string) =>
  executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, o.ctx(), ports);
const pass = (
  o: OrgFixture,
  eventId: string,
  priceMinor: number,
  extra: Record<string, unknown> = {},
  name = 'General',
) =>
  executeCommand(
    createTicketTypeCommand,
    { eventId, name, priceMinor, quantityTotal: 100, ...extra },
    o.ctx(),
    ports,
  );
const venue = (o: OrgFixture, name: string, city: string, lat: number, lng: number) =>
  executeCommand(
    createVenueCommand,
    { name: `${name} ${tag}`, city, country: 'FR', latitude: lat, longitude: lng, timezone: 'Europe/Paris' },
    o.ctx(),
    ports,
  );
const details = (o: OrgFixture, eventId: string, d: Record<string, unknown>) =>
  executeCommand(setEventDetailsCommand, { eventId, ...d }, o.ctx(), ports);

const ordersOf = (eventId: string, email: string) =>
  admin`select id, status, buyer_email, total_minor, fee_minor, expires_at, provider, provider_payment_id
        from orders.orders where event_id = ${eventId} and buyer_email = ${email.toLowerCase()} order by created_at`;
const held = async (ticketTypeId: string) => {
  const [r] =
    await admin`select quantity_sold as sold, quantity_held as held from ticketing.ticket_types where id = ${ticketTypeId}`;
  return [Number(r?.sold), Number(r?.held)];
};

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: true }, a.ctx(), ports);
}, 120_000);
afterAll(async () => {
  await admin.end();
  await closePools();
});

/* ------------------------------------------------------------------------------ search ---- */

describe('GET /v1/public/events', () => {
  let paris: EventDto;
  let lyon: EventDto;
  let marseille: EventDto;
  let secret1: EventDto;
  let unlisted: EventDto;
  let wedding: EventDto;
  let draft: EventDto;
  let notEnrolled: EventDto;
  const slugs = (r: { body: Json }) => (r.body.data as Json[]).map((e) => e.slug as string);
  // The org's fixture event is years earlier than the ones made here.
  const mine = (q = '') =>
    `/public/events?organizer=${a.org.slug}${q.includes('from=') ? '' : '&from=2031-01-01'}${q}`;

  beforeAll(async () => {
    const pv = await venue(a, 'Salle Pleyel', 'Paris', 48.8566, 2.3522);
    const lv = await venue(a, 'Halle Tony Garnier', 'Lyon', 45.764, 4.8357);
    const mv = await venue(a, 'Le Dôme', 'Marseille', 43.2965, 5.3698);
    paris = await event(a, 'Paris Jazz', { tagline: 'Late night sets' });
    lyon = await event(a, 'Lyon Folk', { startsAt: '2031-05-03T18:00:00Z', endsAt: '2031-05-03T22:00:00Z' });
    marseille = await event(a, 'Marseille Gala', {
      startsAt: '2031-06-10T18:00:00Z',
      endsAt: '2031-06-10T22:00:00Z',
    });
    secret1 = await event(a, 'Secret Society', { visibility: 'private' });
    unlisted = await event(a, 'Hidden Lounge', { visibility: 'unlisted' });
    wedding = await event(a, 'Garcia Wedding', { profile: 'wedding' });
    draft = await event(a, 'Draft Night');
    // Marketplace listing is opt-in (D13): this org has not enrolled.
    await executeCommand(updateSiteSettingsCommand, { listOnMarketplace: false }, b.ctx(), ports);
    notEnrolled = await event(b, 'Bravo Unlisted Org Show');
    for (const [e, v, category] of [
      [paris, pv, 'music'],
      [lyon, lv, 'music'],
      [marseille, mv, 'charity'],
    ] as const) {
      await details(a, e.id, { venueId: v.id, category });
    }
    for (const e of [paris, lyon, marseille, secret1, unlisted, wedding])
      await pass(a, e.id, 1500).then(() => publish(a, e.id));
    await pass(b, notEnrolled.id, 1500);
    await publish(b, notEnrolled.id);
    await catchUpListings(a.org.id);
    await catchUpListings(b.org.id);
  }, 120_000);

  it('needs no credential and lists the organizer’s marketplace events soonest first', async () => {
    const r = await call('GET', mine());
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('public');
    expect(slugs(r)).toEqual([paris.slug, lyon.slug, marseille.slug]);
    expect(r.body.nextCursor).toBeNull();
    expect(r.body.data[0]).toMatchObject({
      slug: paris.slug,
      name: `Paris Jazz ${tag}`,
      tagline: 'Late night sets',
      category: 'music',
      status: 'published',
      city: 'Paris',
      currency: 'EUR',
      organizer: { slug: a.org.slug, name: a.org.name },
      distanceKm: null,
    });
    expect(r.body.data[0].minPriceMinor).toBeGreaterThan(0);
    expect(r.body.data[0].url).toBe(`${WEB}/events/${paris.slug}`);
    expect(r.body.data[0].startsAt).toBe('2031-05-01T18:00:00.000Z');
  });

  it('private, unlisted and wedding events, drafts and orgs that did not opt in never appear (D13)', async () => {
    const all = await call('GET', `/public/events?q=${tag}&limit=100`);
    expect(all.status).toBe(200);
    const found = slugs(all);
    for (const hidden of [secret1, unlisted, wedding, draft, notEnrolled])
      expect(found, hidden.slug).not.toContain(hidden.slug);
    expect(found).toEqual(expect.arrayContaining([paris.slug, lyon.slug, marseille.slug]));
    // Searching for them by name, slug or organizer finds nothing; and nothing in a body leaks them.
    for (const name of [
      'Secret Society',
      'Hidden Lounge',
      'Garcia Wedding',
      'Draft Night',
      'Bravo Unlisted',
    ]) {
      const r = await call('GET', `/public/events?q=${encodeURIComponent(name)}&limit=100`);
      expect(slugs(r), name).toEqual([]);
      expect(r.text).not.toContain(name);
    }
    const byOrg = await call('GET', `/public/events?organizer=${b.org.slug}`);
    expect(slugs(byOrg)).toEqual([]);
    // The response never carries internal ids or other people’s data.
    for (const key of ['orgId', 'eventId', 'org_id', 'email', 'canonicalHost'])
      expect(all.text, key).not.toContain(`"${key}"`);
  });

  it('filters by text, category and organizer', async () => {
    expect(slugs(await call('GET', mine(`&q=${encodeURIComponent('jazz')}`)))).toEqual([paris.slug]);
    expect(slugs(await call('GET', mine(`&q=${encodeURIComponent('tony garnier')}`)))).toEqual([lyon.slug]);
    expect(slugs(await call('GET', mine('&category=music')))).toEqual([paris.slug, lyon.slug]);
    expect(slugs(await call('GET', mine('&category=charity')))).toEqual([marseille.slug]);
    // Wildcards in the text are text, not patterns.
    expect(slugs(await call('GET', mine('&q=%25')))).toEqual([]);
    expect(slugs(await call('GET', `/public/events?organizer=no-such-org-${run}`))).toEqual([]);
  });

  it('filters by date range (a date is a UTC day, `to` included) and by instant', async () => {
    expect(slugs(await call('GET', mine('&from=2031-05-02&to=2031-05-04')))).toEqual([lyon.slug]);
    expect(slugs(await call('GET', mine('&from=2031-05-01&to=2031-05-01')))).toEqual([paris.slug]);
    expect(slugs(await call('GET', mine('&from=2031-06-01')))).toEqual([marseille.slug]);
    expect(slugs(await call('GET', mine('&to=2031-05-02T00:00:00Z')))).toEqual([paris.slug]);
    // An event still running at `from` counts: Paris ends at 22:00.
    expect(slugs(await call('GET', mine('&from=2031-05-01T21:00:00Z&to=2031-05-02T00:00:00Z')))).toEqual([
      paris.slug,
    ]);
    expect((await call('GET', mine('&from=2031-05-05&to=2031-05-01'))).status).toBe(400);
    expect((await call('GET', mine('&from=tomorrow'))).status).toBe(400);
  });

  it('filters by distance from a point, nearest first, with the distance in km', async () => {
    const near = await call('GET', mine('&lat=48.85&lng=2.35&radiusKm=50'));
    expect(slugs(near)).toEqual([paris.slug]);
    expect(near.body.data[0].distanceKm).toBeLessThan(2);
    const wide = await call('GET', mine('&lat=48.85&lng=2.35&radiusKm=500'));
    // Lyon is about 392 km from Paris, Marseille about 660 km.
    expect(slugs(wide)).toEqual([paris.slug, lyon.slug]);
    expect(wide.body.data[1].distanceKm).toBeGreaterThan(380);
    expect(wide.body.data[1].distanceKm).toBeLessThan(400);
    // From Marseille the order flips: nearest first.
    const south = await call('GET', mine('&lat=43.3&lng=5.37&radiusKm=500'));
    expect(slugs(south)).toEqual([marseille.slug, lyon.slug]);
    expect((await call('GET', mine('&lat=48.85'))).status).toBe(400);
    expect((await call('GET', mine('&lat=91&lng=2'))).status).toBe(400);
    expect((await call('GET', mine('&lat=48&lng=2&radiusKm=5000'))).status).toBe(400);
  });

  it('pages by keyset: no repeats or gaps, and a new event never shifts a page', async () => {
    const p1 = await call('GET', mine('&limit=1'));
    expect(slugs(p1)).toEqual([paris.slug]);
    expect(typeof p1.body.nextCursor).toBe('string');
    // An event that sorts before the cursor appears between the two requests.
    const early = await event(a, 'Early Bird Show', {
      startsAt: '2031-04-01T18:00:00Z',
      endsAt: '2031-04-01T22:00:00Z',
    });
    await pass(a, early.id, 0);
    await publish(a, early.id);
    await catchUpListings(a.org.id);
    const p2 = await call('GET', mine(`&limit=1&cursor=${p1.body.nextCursor}`));
    expect(slugs(p2)).toEqual([lyon.slug]);
    const p3 = await call('GET', mine(`&limit=1&cursor=${p2.body.nextCursor}`));
    expect(slugs(p3)).toEqual([marseille.slug]);
    expect(p3.body.nextCursor).toBeNull();
    // A fresh walk sees the new event first.
    const all = await call('GET', mine());
    expect(slugs(all)).toEqual([early.slug, paris.slug, lyon.slug, marseille.slug]);
  });

  it('pages by keyset when sorted by distance', async () => {
    const q = '&lat=48.85&lng=2.35&radiusKm=500';
    const p1 = await call('GET', mine(`${q}&limit=1`));
    const p2 = await call('GET', mine(`${q}&limit=1&cursor=${p1.body.nextCursor}`));
    const seen = [...slugs(p1), ...slugs(p2)];
    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
    expect(p2.body.nextCursor).toBeNull();
    // A cursor of the other ordering is refused, not misread.
    const timeCursor = (await call('GET', mine('&limit=1'))).body.nextCursor as string;
    expect((await call('GET', mine(`${q}&cursor=${timeCursor}`))).status).toBe(400);
    expect((await call('GET', mine(`&cursor=${p1.body.nextCursor}`))).status).toBe(400);
    expect((await call('GET', mine('&cursor=not-a-cursor'))).status).toBe(400);
    expect((await call('GET', mine('&limit=101'))).status).toBe(400);
    expect((await call('GET', mine('&limit=0'))).status).toBe(400);
  });

  it('is rate limited per client (60 searches a minute)', async () => {
    const headers = { 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 1}` };
    let last = 200;
    for (let i = 0; i < 61 && last === 200; i++)
      last = (await call('GET', mine('&limit=1'), { headers })).status;
    expect(last).toBe(429);
    expect((await call('GET', mine('&limit=1'), { headers })).headers.get('retry-after')).toBeTruthy();
  });
});

/* ---------------------------------------------------------------------------- checkout ---- */

describe('POST /v1/public/events/{slug}/checkout', () => {
  let ev: EventDto;
  let paid: { id: string };
  let free: { id: string };
  const ck = (token: string, slug: string, body: unknown, key: string | null = uuidv7()) =>
    call('POST', `/public/events/${slug}/checkout`, { token, body, key });
  const cart = (...items: [string, number][]) => ({
    items: items.map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
  });
  const paymentIdOf = (url: string) => new URL(url).searchParams.get('pi') as string;

  beforeAll(async () => {
    ev = await event(a, 'Checkout Night');
    paid = await pass(a, ev.id, 5000, { maxPerOrder: 4 }, 'Paid');
    free = await pass(a, ev.id, 0, {}, 'Free');
    await publish(a, ev.id);
  }, 60_000);

  it('needs a signed-in person with a verified email and an Idempotency-Key', async () => {
    const path = `/public/events/${ev.slug}/checkout`;
    const body = cart([paid.id, 1]);
    expect((await call('POST', path, { body, key: uuidv7() })).status).toBe(401);
    expect((await call('POST', path, { token: a.apiKey, body, key: uuidv7() })).status).toBe(401);
    const unverified = await person('unverified', false);
    const r = await call('POST', path, { token: unverified.token, body, key: uuidv7() });
    expect(r.status).toBe(403);
    expect(r.body.details).toMatchObject({ reason: 'email_unverified' });
    const ok = await person('needskey');
    expect((await call('POST', path, { token: ok.token, body, key: null })).status).toBe(400);
    expect(await ordersOf(ev.id, ok.email)).toHaveLength(0);
  });

  it('holds the cart, creates the payment and returns the hosted page with app return links', async () => {
    const p = await person('buyer1');
    const [soldBefore, heldBefore] = await held(paid.id);
    const r = await ck(p.token, ev.slug, cart([paid.id, 2]));
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.body).toMatchObject({ action: 'pay', webUrl: null, webReason: null });
    expect(r.body.orderId).toMatch(/^[0-9a-f-]{36}$/);
    const url = new URL(r.body.paymentUrl);
    expect(url.pathname).toBe('/checkout/fake');
    expect(url.searchParams.get('order')).toBe(r.body.orderId);
    expect(url.searchParams.get('return')).toBe(
      `${WEB}/events/${ev.slug}?checkout=return&order=${r.body.orderId}`,
    );
    expect(url.searchParams.get('cancel')).toBe(
      `${WEB}/events/${ev.slug}?checkout=cancelled&order=${r.body.orderId}`,
    );
    expect(Number(url.searchParams.get('amount'))).toBeGreaterThan(10_000 - 1);
    const [o] = await ordersOf(ev.id, p.email);
    expect(o).toMatchObject({ status: 'awaiting_payment', provider: 'fake' });
    expect(o?.provider_payment_id).toBe(paymentIdOf(r.body.paymentUrl));
    // The hold is extended by the payment (10 + 5 minutes at most), and stock is held, not sold.
    const exp = new Date(r.body.expiresAt).getTime() - Date.now();
    expect(exp).toBeGreaterThan(10 * 60_000);
    expect(exp).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    expect(await held(paid.id)).toEqual([soldBefore, (heldBefore ?? 0) + 2]);
    // The order is the person’s: their verified email, their name.
    expect(String(o?.buyer_email)).toBe(p.email);
  });

  it('two requests with the same Idempotency-Key make one order and return the same link', async () => {
    const p = await person('buyer2');
    const key = uuidv7();
    const body = cart([paid.id, 1]);
    const [x, y] = await Promise.all([ck(p.token, ev.slug, body, key), ck(p.token, ev.slug, body, key)]);
    // A concurrent twin may be told the key is in flight; a retry afterwards replays the first.
    expect([x.status, y.status].sort()[0]).toBe(201);
    const again = await ck(p.token, ev.slug, body, key);
    expect(again.status).toBe(201);
    const [first] = [x, y].filter((r) => r.status === 201);
    expect(again.body.orderId).toBe(first?.body.orderId);
    expect(again.body.paymentUrl).toBe(first?.body.paymentUrl);
    expect(again.body.expiresAt).toBe(first?.body.expiresAt);
    expect(await ordersOf(ev.id, p.email)).toHaveLength(1);
    // The same key with another cart is a different request.
    const other = await ck(p.token, ev.slug, cart([paid.id, 2]), key);
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('idempotency_key_reused');
    expect(await ordersOf(ev.id, p.email)).toHaveLength(1);
    // A new key is a new order.
    expect((await ck(p.token, ev.slug, body)).status).toBe(201);
    expect(await ordersOf(ev.id, p.email)).toHaveLength(2);
  });

  it('a retry after the order was paid says it is paid; after the hold lapsed, it is refused', async () => {
    const p = await person('buyer3');
    const key = uuidv7();
    const r = await ck(p.token, ev.slug, cart([paid.id, 1]), key);
    expect(r.status).toBe(201);
    const [soldBefore, heldBefore] = await held(paid.id);
    // The hold lapses (the sweeper runs): stock goes back, and the key no longer buys anything.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`update orders.orders set expires_at = now() - interval '1 minute' where id = ${r.body.orderId}`,
      ),
    );
    await executeCommand(expireOrdersCommand, {}, systemCtx(a.org.id), ports);
    expect(await held(paid.id)).toEqual([soldBefore, (heldBefore ?? 1) - 1]);
    const late = await ck(p.token, ev.slug, cart([paid.id, 1]), key);
    expect(late.status).toBe(409);
    expect(late.body.details).toMatchObject({ reason: 'hold_expired', orderId: r.body.orderId });
    // A fresh attempt works.
    expect((await ck(p.token, ev.slug, cart([paid.id, 1]))).status).toBe(201);
  });

  it('a free cart is paid at once, with its tickets', async () => {
    const p = await person('buyer4');
    const r = await ck(p.token, ev.slug, cart([free.id, 2]));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ action: 'paid', paymentUrl: null, expiresAt: null, webUrl: null });
    const [o] = await ordersOf(ev.id, p.email);
    expect(o).toMatchObject({ status: 'paid', total_minor: '0' });
    const [t] =
      await admin`select count(*)::int as n from ticketing.tickets where order_id = ${r.body.orderId}`;
    expect(t?.n).toBe(2);
    // Replaying the key returns the paid order, not a second one.
    const key = uuidv7();
    const x = await ck(p.token, ev.slug, cart([free.id, 1]), key);
    const y = await ck(p.token, ev.slug, cart([free.id, 1]), key);
    expect(y.body.orderId).toBe(x.body.orderId);
    expect(y.body.action).toBe('paid');
  });

  it('promo codes work as on the web, and a wrong one is refused', async () => {
    await executeCommand(
      createPromoCodeCommand,
      { eventId: ev.id, code: `APP10${run}`.toUpperCase(), kind: 'percent', percentBps: 1000 },
      a.ctx(),
      ports,
    );
    const p = await person('buyer5');
    const r = await ck(p.token, ev.slug, { ...cart([paid.id, 1]), promoCode: ` app10${run} ` });
    expect(r.status).toBe(201);
    const [o] =
      await admin`select discount_minor, promo_code, total_minor from orders.orders where id = ${r.body.orderId}`;
    expect(Number(o?.discount_minor)).toBe(500);
    expect(o?.promo_code).toBe(`APP10${run}`.toUpperCase());
    const bad = await ck(p.token, ev.slug, { ...cart([paid.id, 1]), promoCode: 'NOPE-NOT-A-CODE' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    expect(bad.body.details).toMatchObject({ reason: 'promo_invalid' });
  });

  it('enforces the same pass rules as the web', async () => {
    const p = await person('buyer6');
    // Over the per-order limit; unknown pass; the same pass twice; an empty cart.
    expect((await ck(p.token, ev.slug, cart([paid.id, 5]))).status).toBe(400);
    expect((await ck(p.token, ev.slug, cart([uuidv7(), 1]))).status).toBeGreaterThanOrEqual(400);
    const dup = await ck(p.token, ev.slug, cart([paid.id, 1], [paid.id, 1]));
    expect(dup.status).toBe(400);
    expect((await ck(p.token, ev.slug, { items: [] })).status).toBe(400);
    expect((await ck(p.token, ev.slug, { items: [{ ticketTypeId: 'x', quantity: 1 }] })).status).toBe(400);
    expect(await ordersOf(ev.id, p.email)).toHaveLength(0);
    // Unknown, draft and private events are not found.
    expect((await ck(p.token, `no-such-event-${run}`, cart([paid.id, 1]))).status).toBe(404);
    const hidden = await event(a, 'Hidden Checkout', { visibility: 'private' });
    const hp = await pass(a, hidden.id, 1000);
    await publish(a, hidden.id);
    expect((await ck(p.token, hidden.slug, cart([hp.id, 1]))).status).toBe(404);
    const unpub = await event(a, 'Unpublished Checkout');
    const up = await pass(a, unpub.id, 1000);
    expect((await ck(p.token, unpub.slug, cart([up.id, 1]))).status).toBe(404);
  });

  it('sends carts the app cannot finish to the web checkout, holding nothing', async () => {
    const p = await person('buyer7');
    const webUrl = (slug: string) => `${WEB}/events/${slug}?utm_source=yayatoh-app&utm_medium=app`;
    const expectWeb = async (slug: string, ticketTypeId: string, reason: string) => {
      const [, heldBefore] = await held(ticketTypeId);
      const r = await ck(p.token, slug, cart([ticketTypeId, 1]));
      expect(r.status, `${reason}: ${r.text}`).toBe(200);
      expect(r.body).toEqual({
        action: 'web',
        orderId: null,
        paymentUrl: null,
        expiresAt: null,
        webUrl: webUrl(slug),
        webReason: reason,
      });
      expect((await held(ticketTypeId))[1]).toBe(heldBefore);
    };

    // Checkout questions.
    const q = await event(a, 'Questions Night');
    const qp = await pass(a, q.id, 2500);
    await executeCommand(
      publishFormCommand,
      {
        kind: 'checkout_questions',
        subjectType: 'event',
        subjectId: q.id,
        definition: { fields: [{ key: 'company', type: 'short_text', label: 'Company' }] },
      },
      a.ctx(),
      ports,
    );
    await publish(a, q.id);
    await expectWeb(q.slug, qp.id, 'checkout_questions');

    // A transfer fee.
    const t = await event(a, 'Transfer Fee Night');
    const tp = await pass(a, t.id, 2500, { transferFeeMinor: 500 });
    await publish(a, t.id);
    await expectWeb(t.slug, tp.id, 'transfer_fee');

    // Choose-your-amount passes.
    const d = await event(a, 'Donation Night');
    const dp = await pass(a, d.id, 500, { isDonation: true });
    await publish(a, d.id);
    await expectWeb(d.slug, dp.id, 'choose_your_amount');

    // Seats.
    const s = await event(a, 'Seated Night');
    const sp = await pass(a, s.id, 2000);
    const row = buildRow({ label: 'A', count: 6, x: 200, y: 600 });
    const doc: FloorplanDoc = {
      version: 1,
      width: 4000,
      height: 1200,
      underlay: null,
      sections: [],
      items: [row],
    };
    await executeCommand(setEventLayoutCommand, { eventId: s.id, doc }, a.ctx(), ports);
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId: s.id, itemIds: [row.id], ticketTypeId: sp.id },
      a.ctx(),
      ports,
    );
    await publish(a, s.id);
    await executeCommand(publishEventLayoutCommand, { eventId: s.id }, a.ctx(), ports);
    await expectWeb(s.slug, sp.id, 'seat_selection');
    // A pass that is not sold by seat on the same event is still bought in the app.
    const open = await pass(a, s.id, 1000, {}, 'Standing');
    expect((await ck(p.token, s.slug, cart([open.id, 1]))).status).toBe(201);
    expect(await ordersOf(s.id, p.email)).toHaveLength(1);

    // A multi-date event keeps its date in the web link.
    expect(webUrl(q.slug)).not.toContain('date=');
  });

  it('refuses passes with stream access: buy on the web (P7-7)', async () => {
    const p = await person('buyer8');
    const refused = async (slug: string, ticketTypeId: string, ids = [ticketTypeId]) => {
      const r = await ck(p.token, slug, cart([ticketTypeId, 1]));
      expect(r.status, r.text).toBe(409);
      expect(r.body.code).toBe('invalid_state');
      expect(r.body.details).toMatchObject({
        reason: 'buy_on_web',
        webUrl: `${WEB}/events/${slug}?utm_source=yayatoh-app&utm_medium=app`,
        ticketTypeIds: ids,
      });
    };

    // An online event: every pass is virtual unless the organizer chose otherwise.
    const online = await event(a, 'Online Summit');
    const op = await pass(a, online.id, 3000);
    await details(a, online.id, { attendanceMode: 'online' });
    await publish(a, online.id);
    await refused(online.slug, op.id);
    expect(await ordersOf(online.id, p.email)).toHaveLength(0);

    // A hybrid event: the stream pass is refused, the in-person pass is not.
    const hybrid = await event(a, 'Hybrid Forum');
    const room = await pass(a, hybrid.id, 4000, {}, 'In the room');
    const stream = await pass(a, hybrid.id, 1000, {}, 'Livestream');
    const both = await pass(a, hybrid.id, 5000, {}, 'Room and stream');
    await details(a, hybrid.id, { attendanceMode: 'hybrid' });
    await executeCommand(
      setTicketAccessCommand,
      { eventId: hybrid.id, ticketTypeId: stream.id, access: 'virtual' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setTicketAccessCommand,
      { eventId: hybrid.id, ticketTypeId: both.id, access: 'both' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setTicketAccessCommand,
      { eventId: hybrid.id, ticketTypeId: room.id, access: 'in_person' },
      a.ctx(),
      ports,
    );
    await publish(a, hybrid.id);
    await refused(hybrid.slug, stream.id);
    await refused(hybrid.slug, both.id);
    expect((await ck(p.token, hybrid.slug, cart([room.id, 1]))).status).toBe(201);
    // A mixed cart is refused as a whole, naming the stream pass.
    const mixed = await ck(p.token, hybrid.slug, cart([room.id, 1], [stream.id, 1]));
    expect(mixed.status).toBe(409);
    expect(mixed.body.details.ticketTypeIds).toEqual([stream.id]);
    expect(await ordersOf(hybrid.id, p.email)).toHaveLength(1);
  });

  it('a fake-provider purchase through /v1 matches the web checkout: order, fees and ledger', async () => {
    // Two events with the same price and fees; one bought the way the web does it, one over /v1.
    const web = await event(a, 'Compare Web');
    const wp = await pass(a, web.id, 4321, { maxPerOrder: 6 });
    await publish(a, web.id);
    const appEv = await event(a, 'Compare App');
    const ap = await pass(a, appEv.id, 4321, { maxPerOrder: 6 });
    await publish(a, appEv.id);
    const p = await person('buyer9');

    // The web's steps (checkoutAction): hold, payment, attach, then the provider says paid.
    const webStart = await executeCommand(
      startCheckoutCommand,
      {
        eventId: web.id,
        items: [{ ticketTypeId: wp.id, quantity: 3 }],
        buyer: { email: p.email, name: 'Cam Parity' },
        locale: 'en',
      },
      createCtx({ orgId: a.org.id, actor: { type: 'user', userId: p.id } }),
      ports,
    );
    const webPay = await payments.createPayment({
      orgId: a.org.id,
      orderId: webStart.order.id,
      amount: { amount: webStart.order.totalMinor, currency: webStart.order.currency },
      fundsFlow: webStart.payment.fundsFlow,
      connectedAccountId: webStart.payment.connectedAccountId,
      applicationFee: { amount: webStart.payment.applicationFeeMinor, currency: webStart.order.currency },
      buyerEmail: webStart.order.buyerEmail,
      description: web.name,
      idempotencyKey: `order:${webStart.order.id}:1`,
      returnUrl: `${WEB}/orders/x`,
    });
    await executeCommand(
      attachPaymentCommand,
      { orderId: webStart.order.id, provider: 'fake', providerPaymentId: webPay.providerPaymentId },
      createCtx({ orgId: a.org.id }),
      ports,
    );

    // The app’s: one request.
    const r = await ck(p.token, appEv.slug, { ...cart([ap.id, 3]), name: 'Cam Parity' });
    expect(r.status).toBe(201);

    const settle = (orderId: string, providerPaymentId: string, totalMinor: number) =>
      executeCommand(
        applyProviderEventCommand,
        {
          provider: 'fake',
          id: `fakeevt_${orderId}`,
          type: 'payment.succeeded',
          providerPaymentId,
          amountMinor: totalMinor,
          currency: 'EUR',
          orgId: a.org.id,
          orderId,
        },
        systemCtx(a.org.id),
        ports,
      );
    expect(
      await settle(webStart.order.id, webPay.providerPaymentId, webStart.order.totalMinor),
    ).toMatchObject({
      outcome: 'applied',
      status: 'paid',
    });
    const appOrder = (await ordersOf(appEv.id, p.email))[0];
    expect(
      await settle(r.body.orderId, paymentIdOf(r.body.paymentUrl), Number(appOrder?.total_minor)),
    ).toMatchObject({ outcome: 'applied', status: 'paid' });

    const shape = async (orderId: string) => {
      const [o] = await admin`
        select status, currency, subtotal_minor, discount_minor, fee_minor, total_minor, funds_flow,
               fee_schedule, connected_account_id is null as no_account, buyer_name
        from orders.orders where id = ${orderId}`;
      const items = await admin`
        select name, quantity, unit_face_minor, unit_fee_minor, unit_all_in_minor, unit_organizer_net_minor, unit_discount_minor from orders.order_items
        where order_id = ${orderId} order by quantity`;
      const [tickets] =
        await admin`select count(*)::int as n from ticketing.tickets where order_id = ${orderId}`;
      const ledger = await admin`
        select j.kind, j.memo - 'orderId' - 'eventId' as memo,
               (select coalesce(json_agg(json_build_array(p.account, p.amount_minor::text, p.currency) order by p.account, p.amount_minor), '[]'::json)
                  from payments.postings p where p.journal_id = j.id) as postings
        from payments.journal_entries j where j.ref_id = ${orderId} order by j.kind`;
      return { order: o, items, tickets: tickets?.n, ledger };
    };
    const webShape = await shape(webStart.order.id);
    const appShape = await shape(r.body.orderId);
    expect(webShape.order).toMatchObject({ status: 'paid', subtotal_minor: '12963' });
    expect(appShape.order).toEqual(webShape.order);
    expect(appShape.items).toEqual(webShape.items);
    expect(appShape.tickets).toBe(3);
    expect(appShape.tickets).toBe(webShape.tickets);
    expect(webShape.ledger.length).toBeGreaterThan(0);
    expect(appShape.ledger).toEqual(webShape.ledger);
  });

  it('applies the web’s checkout budget per person and refuses past it (429, Retry-After)', async () => {
    const p = await person('buyer10');
    let last: Awaited<ReturnType<typeof ck>> | undefined;
    // The policy allows 20 starts per 10 minutes per device; the person stands in for the device.
    for (let i = 0; i < 21; i++) last = await ck(p.token, `no-such-event-${run}`, cart([paid.id, 1]));
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
    // Another person is unaffected.
    const q = await person('buyer11');
    expect((await ck(q.token, `no-such-event-${run}`, cart([paid.id, 1]))).status).toBe(404);
  });

  it('applies the pre-checkout risk rules: a velocity block places no order and records a signal', async () => {
    const p = await person('buyer12');
    // Ten orders by this address in the last hour is a block (M1.6e defaults).
    for (let i = 0; i < 10; i++) {
      await executeCommand(
        startCheckoutCommand,
        {
          eventId: ev.id,
          items: [{ ticketTypeId: free.id, quantity: 1 }],
          buyer: { email: p.email, name: 'Velocity' },
        },
        createCtx({ orgId: a.org.id }),
        ports,
      );
    }
    const before = (await ordersOf(ev.id, p.email)).length;
    const r = await ck(p.token, ev.slug, cart([paid.id, 1]));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'forbidden', details: { reason: 'risk_blocked' } });
    // The answer carries no rule names or counts.
    expect(JSON.stringify(r.body)).not.toContain('email_velocity');
    expect(await ordersOf(ev.id, p.email)).toHaveLength(before);
    const [sig] = await admin`
      select count(*)::int as n from platform.domain_events
      where org_id = ${a.org.id} and type = 'order.checkout_blocked' and aggregate_id = ${ev.id}`;
    expect(sig?.n).toBeGreaterThan(0);
  });

  it('a payment that never starts leaves a retryable order (the provider step is re-run, not duplicated)', async () => {
    // Replaying a key whose order exists but has no payment yet creates the payment once.
    const p = await person('buyer13');
    const key = uuidv7();
    const r = await ck(p.token, ev.slug, cart([paid.id, 1]), key);
    expect(r.status).toBe(201);
    const [o] = await ordersOf(ev.id, p.email);
    await admin`update orders.orders set status = 'reserved', provider = null, provider_payment_id = null where id = ${o?.id}`;
    const again = await ck(p.token, ev.slug, cart([paid.id, 1]), key);
    expect(again.status).toBe(201);
    expect(again.body.orderId).toBe(r.body.orderId);
    expect(again.body.paymentUrl).toBe(r.body.paymentUrl);
    const [after] = await ordersOf(ev.id, p.email);
    expect(after).toMatchObject({ status: 'awaiting_payment', provider: 'fake' });
    expect(await ordersOf(ev.id, p.email)).toHaveLength(1);
  });
});
