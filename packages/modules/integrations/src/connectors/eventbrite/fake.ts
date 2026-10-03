import type { FakeAccount, FakeProvider } from '../../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../../auth/port.ts';
import { EB_EVENTS, EB_ORDERS, EB_ORGANIZATION, type EbEvent, type EbOrder } from './fixture.ts';

/**
 * The fake Eventbrite API (M6.4b) for dev and CI: the recorded fixture account, served the way
 * Eventbrite v3 serves it — `GET /v3/users/me/organizations/`,
 * `GET /v3/organizations/{id}/events/` (`expand=ticket_classes,venue`) and
 * `GET /v3/organizations/{id}/orders/` (`expand=attendees`, `changed_since`), paginated with
 * `continuation` tokens. Read-only, like the importer. Dev controls change the account (a refund
 * at Eventbrite, a new order) to rehearse a re-run.
 */

interface EbData {
  events: EbEvent[];
  orders: EbOrder[];
  /** Requests answered, by path (tests check the importer pages as Eventbrite expects). */
  pages: number;
}

export const EB_EVENTS_PAGE = 2;
export const EB_ORDERS_PAGE = 4;

const data = (a: FakeAccount) => a.data as EbData;

const token = (offset: number) => Buffer.from(`o:${offset}`).toString('base64url');
const offsetOf = (t: string | undefined) => {
  if (!t) return 0;
  const m = /^o:(\d+)$/.exec(Buffer.from(t, 'base64url').toString());
  return m ? Number(m[1]) : -1;
};

function page<T>(list: readonly T[], size: number, continuation: string | undefined) {
  const at = offsetOf(continuation);
  if (at < 0) return null;
  const items = list.slice(at, at + size);
  const more = at + size < list.length;
  return {
    items,
    pagination: {
      object_count: list.length,
      page_number: Math.floor(at / size) + 1,
      page_size: size,
      page_count: Math.max(1, Math.ceil(list.length / size)),
      has_more_items: more,
      ...(more ? { continuation: token(at + size) } : {}),
    },
  };
}

export const eventbriteFakeProvider: FakeProvider = {
  accountLabel: `${EB_ORGANIZATION.name} (sandbox)`,
  seed: (): EbData => ({ events: structuredClone([...EB_EVENTS]), orders: structuredClone([...EB_ORDERS]), pages: 0 }),
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = data(account);
    if (req.method !== 'GET') return { status: 405, body: { error: 'METHOD_NOT_ALLOWED' } };
    d.pages += 1;
    if (req.path === '/v3/users/me/organizations/')
      return {
        status: 200,
        body: {
          organizations: [EB_ORGANIZATION],
          pagination: { object_count: 1, page_number: 1, page_size: 50, page_count: 1, has_more_items: false },
        },
      };
    const m = /^\/v3\/organizations\/(\d+)\/(events|orders)\/$/.exec(req.path);
    if (!m || m[1] !== EB_ORGANIZATION.id) return { status: 404, body: { error: 'NOT_FOUND' } };
    if (m[2] === 'events') {
      const p = page(d.events, EB_EVENTS_PAGE, req.query?.continuation);
      if (!p) return { status: 400, body: { error: 'INVALID_CONTINUATION' } };
      return { status: 200, body: { events: p.items, pagination: p.pagination } };
    }
    const since = req.query?.changed_since;
    const list = d.orders
      .filter((o) => !since || o.changed > since)
      .sort((x, y) => (x.changed === y.changed ? (x.id < y.id ? -1 : 1) : x.changed < y.changed ? -1 : 1));
    const p = page(list, EB_ORDERS_PAGE, req.query?.continuation);
    if (!p) return { status: 400, body: { error: 'INVALID_CONTINUATION' } };
    return { status: 200, body: { orders: p.items, pagination: p.pagination } };
  },
};

/** Dev control: refund an order at Eventbrite (all its attendees). */
export function eventbriteRemoteRefund(a: FakeAccount, orderId: string, now = new Date()): boolean {
  const o = data(a).orders.find((x) => x.id === orderId);
  if (!o) return false;
  o.status = 'refunded';
  o.changed = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const at of o.attendees) at.refunded = true;
  return true;
}

/** Dev control: someone renamed an attendee at Eventbrite. */
export function eventbriteRemoteRename(a: FakeAccount, attendeeId: string, name: string, now = new Date()) {
  for (const o of data(a).orders)
    for (const at of o.attendees)
      if (at.id === attendeeId) {
        const [first = name, ...rest] = name.split(' ');
        at.profile = { ...at.profile, name, first_name: first, last_name: rest.join(' ') };
        o.changed = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
        return true;
      }
  return false;
}

/** How many API pages the account answered (tests). */
export const eventbriteRequests = (a: FakeAccount) => data(a).pages;
