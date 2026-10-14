/**
 * A fake `/v1` for the shopping screens: public events, passes, the checkout (idempotent on its key,
 * like the server's), and the person's orders (visible once paid, like `/v1/me/orders`).
 */
import type { Schemas } from '@yayatoh/sdk';
import { EVENT, ORDER_ID, order, PASSES, SLUG, summary, WEB } from './fixtures';

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const problem = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify({ type: `https://x/${code}`, title: code, status, code, details }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Headers;
  readonly body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

export interface FakeShop {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Call[];
  /** Replaces the answer to `METHOD /path` (a string with `{x}` segments, or a RegExp on the path). */
  on(method: string, path: string | RegExp, handler: Handler): void;
  callsTo(method: string, path: string | RegExp): Call[];
  /** Orders the checkout created, by order id, with the key and body that made them. */
  readonly created: Map<string, { key: string; body: string; orderId: string }>;
  /** Makes an order visible to `/v1/me/orders/{id}` (it was paid). */
  pay(orderId: string, over?: Partial<Schemas['MyOrder']>): void;
  readonly visibleOrders: Map<string, Schemas['MyOrder']>;
  /** What the next checkout answers instead of a payment: `paid`, `web`, or a response. */
  nextCheckout: Handler | null;
}

const toPattern = (path: string | RegExp): RegExp =>
  path instanceof RegExp
    ? path
    : new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+')}$`);

export function createFakeShop(): FakeShop {
  const calls: Call[] = [];
  const overrides: { method: string; pattern: RegExp; handler: Handler }[] = [];
  const created = new Map<string, { key: string; body: string; orderId: string }>();
  const byKey = new Map<string, { body: string; response: Record<string, unknown> }>();
  const visibleOrders = new Map<string, Schemas['MyOrder']>();
  let counter = 0;

  const shop: FakeShop = {
    calls,
    created,
    visibleOrders,
    nextCheckout: null,
    on: (method, path, handler) => void overrides.unshift({ method, pattern: toPattern(path), handler }),
    callsTo: (method, path) => {
      const pattern = toPattern(path);
      return calls.filter((c) => c.method === method && pattern.test(c.path));
    },
    pay: (orderId, over = {}) => void visibleOrders.set(orderId, order({ id: orderId, ...over })),
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const path = url.pathname.replace(/^.*?(\/v1\/)/, '/v1/');
      const raw = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text();
      const call: Call = {
        method: request.method,
        path,
        query: url.searchParams,
        headers: request.headers,
        body: raw ? JSON.parse(raw) : undefined,
      };
      calls.push(call);
      const override = overrides.find((o) => o.method === call.method && o.pattern.test(path));
      if (override) return override.handler(call);
      return defaults(call);
    },
  };

  const defaults: Handler = (call) => {
    const { method, path } = call;
    if (method === 'GET' && path === '/v1/mobile/config') {
      const app = { latestVersion: '1.0.0', minimumVersion: '0.0.1', storeUrl: 'https://stores.test/app' };
      return json(200, {
        apiVersion: '1',
        apps: {
          'yayatoh-android': app,
          'yayatoh-ios': app,
          'yayatoh-staff-android': app,
          'yayatoh-staff-ios': app,
        },
        baseUrls: { api: `${WEB}/api/v1`, web: WEB },
        features: {},
        latestVersions: { android: '1.0.0', ios: '1.0.0' },
        minimumVersions: { android: '0.0.1', ios: '0.0.1' },
      });
    }
    if (method === 'GET' && path === '/v1/public/events')
      return json(200, { data: [summary(1), summary(2)], nextCursor: null });
    if (method === 'GET' && path === `/v1/public/events/${SLUG}`) return json(200, EVENT);
    if (method === 'GET' && path === `/v1/public/events/${SLUG}/ticket-types`)
      return json(200, { data: PASSES });
    if (method === 'GET' && path === `/v1/public/events/${SLUG}/dates`)
      return json(200, { data: [], nextCursor: null });
    if (method === 'GET' && path === `/v1/public/events/${SLUG}/sections`) return json(200, { data: [] });
    if (method === 'GET' && path === '/v1/public/venues/city-hall')
      return json(200, {
        accessibilityNotes: null,
        addressLine1: '1 Praça do Município',
        addressLine2: null,
        capacity: null,
        city: 'Lisbon',
        country: 'PT',
        latitude: 38.7,
        longitude: -9.13,
        mapUrl: 'https://maps.example.test/city-hall',
        name: 'City Hall',
        organizerName: 'Blue Note Lisbon',
        photos: [],
        postalCode: null,
        region: null,
        slug: 'city-hall',
        timezone: 'Europe/Lisbon',
        upcomingEvents: [],
      });
    if (method === 'POST' && path === `/v1/public/events/${SLUG}/checkout`) {
      if (shop.nextCheckout) return shop.nextCheckout(call);
      const key = call.headers.get('idempotency-key');
      if (!key) return problem(400, 'validation_failed');
      const body = JSON.stringify(call.body);
      const seen = byKey.get(key);
      if (seen) {
        if (seen.body !== body) return problem(422, 'idempotency_key_reused');
        return json(201, seen.response);
      }
      counter += 1;
      const orderId = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      const response = {
        action: 'pay',
        orderId,
        paymentUrl: `${WEB}/checkout/fake?order=${orderId}`,
        expiresAt: '2027-06-01T10:10:00Z',
        webUrl: null,
        webReason: null,
      };
      byKey.set(key, { body, response });
      created.set(orderId, { key, body, orderId });
      return json(201, response);
    }
    if (method === 'GET' && path === '/v1/me/orders')
      return json(200, {
        data: [...visibleOrders.values()].map((o) => ({ ...orderToSummary(o) })),
        nextCursor: null,
      });
    const detail = /^\/v1\/me\/orders\/([^/]+)$/.exec(path);
    if (method === 'GET' && detail) {
      const found = visibleOrders.get(detail[1] ?? '');
      return found ? json(200, found) : problem(404, 'not_found');
    }
    return problem(404, 'not_found');
  };
  return shop;
}

function orderToSummary(o: Schemas['MyOrder']): Schemas['MyOrderSummary'] {
  return {
    createdAt: o.createdAt,
    currency: o.currency,
    endsAt: o.event.endsAt,
    eventId: o.eventId,
    eventName: o.event.name,
    id: o.id,
    organizerName: o.organizerName,
    startsAt: o.event.startsAt,
    status: o.status,
    tickets: o.ticketIds.length,
    timezone: o.event.timezone,
    totalMinor: o.totalMinor,
  };
}

export { ORDER_ID };
