import {
  CreateEventInput,
  createEventCommand,
  findEventTx,
  slugify,
  UpdateEventInput,
  updateEventCommand,
} from '@yayatoh/events';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { importOrderTx } from '@yayatoh/orders';
import {
  CreateTicketTypeInput,
  createTicketTypeTx,
  ticketTypeStockTx,
  UpdateTicketTypeInput,
  updateTicketTypeTx,
} from '@yayatoh/ticketing';
import type { TenantTx } from '@yayatoh/db';
import { z } from 'zod';
import { fieldsHash } from '../../hash.ts';
import {
  defineConnector,
  type Page,
  type RemoteRecord,
  type SyncIO,
  type WriteMeta,
} from '../../sdk/connector.ts';
import { linkedLocalIdTx } from '../links.ts';
import { eventbriteFakeProvider } from './fake.ts';
import type { EbEvent, EbOrder, EbTicketClass } from './fixture.ts';

/**
 * The Eventbrite importer (M6.4b, decision P6-4: "wins switchers"). One way, run on demand: an
 * organizer connects their Eventbrite account (OAuth through the `IntegrationAuth` port), previews
 * what will come over (`eventbritePreview`: counts, nothing written), then imports. Events, ticket
 * classes and orders (with their attendees) are pulled page by page by the sync engine; each
 * record is written through the owning module's own command code (`events.createEvent` /
 * `updateEvent`, the ticket type commands' transactions, `orders` import path), inside the
 * engine's page command, so the pipeline audits each page and the outbox carries each module's
 * events. Money stays in integer minor units (Eventbrite's `value`), times are stored as UTC
 * instants with the event's IANA zone.
 *
 * Idempotent by external id: the record links (and, across a reconnect, any earlier Eventbrite
 * connection's links, plus the order's source id) find what was imported before, so a re-run
 * updates instead of duplicating. Imported orders are never charged and never emailed (see
 * `importOrderTx`).
 *
 * Eventbrite v3 calls (through the port's proxy): `GET /v3/users/me/organizations/`,
 * `GET /v3/organizations/{id}/events/?expand=ticket_classes,venue`,
 * `GET /v3/organizations/{id}/orders/?expand=attendees&changed_since=`. Events and ticket classes
 * are read in full every run (few); orders resume from the newest `changed` seen.
 */

export const EVENTBRITE = 'eventbrite';

const orgIds = new WeakMap<SyncIO, Promise<string>>();

/** The Eventbrite organization the connection reads (the account's first). */
export function eventbriteOrganization(io: SyncIO): Promise<string> {
  let p = orgIds.get(io);
  if (!p) {
    p = io.client.request({ method: 'GET', path: '/v3/users/me/organizations/' }).then((res) => {
      const body = res.body as { organizations?: { id?: unknown }[] };
      const id = body.organizations?.[0]?.id;
      if (typeof id !== 'string' || !/^\d{1,30}$/.test(id))
        throw new DomainError('not_found', 'No Eventbrite organization on this account', {
          reason: 'no_organization',
        });
      return id;
    });
    orgIds.set(io, p);
  }
  return p;
}

interface Cursor {
  /** Orders: changed after this (the newest `changed` of the previous complete read). */
  readonly s: string | null;
  /** The continuation token of the page to read next. */
  readonly c: string | null;
  /** The newest `changed` seen so far in this read. */
  readonly h: string | null;
}

const EMPTY: Cursor = { s: null, c: null, h: null };

function parseCursor(raw: string | null): Cursor {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<Cursor>;
    const str = (x: unknown) => (typeof x === 'string' && x.length <= 300 ? x : null);
    return { s: str(v.s), c: str(v.c), h: str(v.h) };
  } catch {
    return EMPTY;
  }
}

interface EbPagination {
  readonly has_more_items?: boolean;
  readonly continuation?: string;
}

async function listEvents(io: SyncIO, cursor: Cursor): Promise<{ events: EbEvent[]; next: string | null }> {
  const org = await eventbriteOrganization(io);
  const res = await io.client.request({
    method: 'GET',
    path: `/v3/organizations/${org}/events/`,
    query: { expand: 'ticket_classes,venue', ...(cursor.c ? { continuation: cursor.c } : {}) },
  });
  const body = res.body as { events?: EbEvent[]; pagination?: EbPagination };
  const next =
    body.pagination?.has_more_items && typeof body.pagination.continuation === 'string'
      ? body.pagination.continuation
      : null;
  return { events: Array.isArray(body.events) ? body.events : [], next };
}

/** Full re-read objects: a page, and where the next one starts (the start again once done). */
function fullReadPage(records: RemoteRecord[], next: string | null): Page<RemoteRecord> {
  return { records, hasMore: next !== null, cursor: JSON.stringify({ ...EMPTY, c: next }) };
}

const valid = (d: unknown) => typeof d === 'string' && !Number.isNaN(new Date(d).getTime());

export function eventRecord(e: EbEvent): RemoteRecord | null {
  if (typeof e?.id !== 'string' || !valid(e.changed)) return null;
  return {
    id: e.id,
    version: e.changed,
    updatedAt: new Date(e.changed),
    origin: null,
    fields: {
      name: e.name?.text ?? null,
      description: e.description?.text ?? null,
      start_utc: e.start?.utc ?? null,
      end_utc: e.end?.utc ?? null,
      timezone: e.start?.timezone ?? null,
      currency: e.currency ?? null,
      venue_name: e.venue?.name ?? null,
      city: e.venue?.address?.city ?? null,
      country: e.venue?.address?.country ?? null,
      status: e.status ?? null,
    },
  };
}

export function ticketClassRecord(c: EbTicketClass): RemoteRecord | null {
  if (typeof c?.id !== 'string' || typeof c.event_id !== 'string') return null;
  const fields = {
    name: c.name ?? null,
    description: c.description ?? null,
    price: c.free ? 0 : (c.cost?.value ?? 0),
    currency: c.cost?.currency ?? null,
    quantity_total: c.quantity_total ?? 0,
    quantity_sold: c.quantity_sold ?? 0,
    hidden: c.hidden === true,
    sales_start: c.sales_start ?? null,
    sales_end: c.sales_end ?? null,
    event_id: c.event_id,
  };
  // Ticket classes carry no change time: their content is their version.
  return { id: c.id, version: fieldsHash(fields).slice(0, 32), updatedAt: null, origin: null, fields };
}

export function orderRecord(o: EbOrder): RemoteRecord | null {
  if (typeof o?.id !== 'string' || !valid(o.changed)) return null;
  return {
    id: o.id,
    version: o.changed,
    updatedAt: new Date(o.changed),
    origin: null,
    fields: {
      email: o.email ?? null,
      name: o.name ?? null,
      status: o.status ?? null,
      base_price: o.costs?.base_price?.value ?? null,
      gross: o.costs?.gross?.value ?? null,
      currency: o.costs?.gross?.currency ?? null,
      created: o.created ?? null,
      event_id: o.event_id ?? null,
      // Not mappable (nested): the write reads it from the record.
      attendees: Array.isArray(o.attendees) ? o.attendees : [],
    },
  };
}

const flat = <T>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);

async function listOrders(io: SyncIO, raw: string | null): Promise<Page<RemoteRecord>> {
  const cursor = parseCursor(raw);
  const org = await eventbriteOrganization(io);
  const res = await io.client.request({
    method: 'GET',
    path: `/v3/organizations/${org}/orders/`,
    query: {
      expand: 'attendees',
      ...(cursor.s ? { changed_since: cursor.s } : {}),
      ...(cursor.c ? { continuation: cursor.c } : {}),
    },
  });
  const body = res.body as { orders?: EbOrder[]; pagination?: EbPagination };
  const records = flat((body.orders ?? []).map(orderRecord));
  const high = records.reduce<string | null>(
    (h, r) => (r.version > (h ?? '') ? r.version : h),
    cursor.h,
  );
  const next =
    body.pagination?.has_more_items && typeof body.pagination.continuation === 'string'
      ? body.pagination.continuation
      : null;
  return {
    records,
    hasMore: next !== null,
    // Done: the next run asks for orders changed after the newest one seen.
    cursor: JSON.stringify(next ? { s: cursor.s, c: next, h: high } : { s: high ?? cursor.s, c: null, h: null }),
  };
}

const noStepUp = async () => {};

/** A Yayatoh record an earlier import made for this provider id, or the parent it needs. */
async function linked(tx: TenantTx, meta: WriteMeta, objectType: string, externalId: string) {
  return linkedLocalIdTx(tx, EVENTBRITE, objectType, externalId, meta.connectionId);
}

async function parentOrMissing(tx: TenantTx, meta: WriteMeta, objectType: string, externalId: unknown) {
  const id = typeof externalId === 'string' ? await linked(tx, meta, objectType, externalId) : null;
  // Imported later in this run (or the next): the record is retried from the errors inbox.
  if (!id) throw new DomainError('not_found', 'Its parent is not imported yet', { reason: 'parent_missing' });
  return id;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const iso = (v: unknown) => (typeof v === 'string' && valid(v) ? new Date(v) : null);

async function writeEvent(
  tx: TenantTx,
  ctx: Ctx,
  values: Readonly<Record<string, unknown>>,
  localId: string | null,
  meta: WriteMeta,
) {
  const id = localId ?? (await linked(tx, meta, 'events', meta.record.id));
  const common = {
    name: String(values.name ?? '').slice(0, 160),
    tagline: str(values.tagline)?.slice(0, 280) ?? null,
    timezone: values.timezone,
    startsAt: values.starts_at,
    endsAt: values.ends_at,
    venueName: str(values.venue_name)?.slice(0, 160) ?? null,
    city: str(values.city)?.slice(0, 120) ?? null,
    country: str(values.country)?.toUpperCase() ?? null,
  };
  const args = { ctx, tx, emit: meta.emit, requireStepUp: noStepUp };
  if (id && (await findEventTx(tx, id))) {
    // The currency of an event with ticket types stays as imported.
    await updateEventCommand.handler({ ...args, input: UpdateEventInput.parse({ eventId: id, ...common }) });
    return { localId: id };
  }
  const slug = `${slugify(common.name).slice(0, 48).replace(/-+$/, '')}-${crypto.randomUUID().slice(0, 8)}`;
  // Imported as a draft: the organizer reviews it before it goes live here.
  const row = await createEventCommand.handler({
    ...args,
    input: CreateEventInput.parse({ ...common, slug, currency: values.currency }),
  });
  return { localId: row.id };
}

async function writeTicketClass(
  tx: TenantTx,
  ctx: Ctx,
  values: Readonly<Record<string, unknown>>,
  localId: string | null,
  meta: WriteMeta,
) {
  const eventId = await parentOrMissing(tx, meta, 'events', meta.record.fields.event_id);
  const id = localId ?? (await linked(tx, meta, 'ticket_classes', meta.record.id));
  const wanted = Math.max(Number(values.quantity_total ?? 0), Number(meta.record.fields.quantity_sold ?? 0));
  const common = {
    name: String(values.name ?? '').slice(0, 120),
    description: str(values.description)?.slice(0, 500) ?? null,
    priceMinor: Number(values.price_minor ?? 0),
    salesStartAt: iso(values.sales_start_at),
    salesEndAt: iso(values.sales_end_at),
    visibility: values.hidden === true ? 'hidden' : 'public',
  };
  const current = id ? await ticketTypeStockTx(tx, id) : null;
  if (id && current) {
    await updateTicketTypeTx(
      tx,
      ctx,
      meta.emit,
      UpdateTicketTypeInput.parse({
        ticketTypeId: id,
        ...common,
        // Never below what is sold here already.
        quantityTotal: Math.max(wanted, current.quantitySold + current.quantityHeld),
      }),
    );
    return { localId: id };
  }
  const row = await createTicketTypeTx(
    tx,
    ctx,
    meta.emit,
    CreateTicketTypeInput.parse({ ...common, eventId, quantityTotal: wanted }),
  );
  return { localId: row.id };
}

const Attendee = z.object({
  id: z.string(),
  ticket_class_id: z.string(),
  profile: z.object({ name: z.string().optional(), email: z.string().optional() }),
  costs: z.object({
    base_price: z.object({ value: z.int().min(0) }),
    gross: z.object({ value: z.int().min(0) }),
  }),
  cancelled: z.boolean().default(false),
  refunded: z.boolean().default(false),
});

async function writeOrder(
  tx: TenantTx,
  ctx: Ctx,
  values: Readonly<Record<string, unknown>>,
  _localId: string | null,
  meta: WriteMeta,
) {
  const eventId = await parentOrMissing(tx, meta, 'events', meta.record.fields.event_id);
  const parsed = z.array(Attendee).min(1).safeParse(meta.record.fields.attendees);
  if (!parsed.success)
    throw new DomainError('validation_failed', 'The order has no readable attendees', { reason: 'attendees' });
  const types = new Map<string, string>();
  for (const a of parsed.data)
    if (!types.has(a.ticket_class_id))
      types.set(a.ticket_class_id, await parentOrMissing(tx, meta, 'ticket_classes', a.ticket_class_id));
  const subtotal = Number(values.subtotal_minor ?? 0);
  const total = Number(values.total_minor ?? 0);
  if (!Number.isInteger(subtotal) || !Number.isInteger(total) || total < subtotal || subtotal < 0)
    throw new DomainError('validation_failed', 'The order totals do not add up', { reason: 'totals' });
  const event = await findEventTx(tx, eventId);
  const buyer = { email: String(values.buyer_email ?? ''), name: String(values.buyer_name ?? '').slice(0, 120) };
  const source = String(values.status ?? 'placed');
  const live = parsed.data.filter((a) => !a.cancelled && !a.refunded).length;
  const status =
    source === 'refunded'
      ? 'refunded'
      : source === 'deleted'
        ? 'cancelled'
        : live === 0
          ? 'refunded'
          : live < parsed.data.length
            ? 'partially_refunded'
            : 'paid';
  const { orderId } = await importOrderTx(tx, ctx, meta.emit, {
    source: 'eventbrite',
    externalId: meta.record.id,
    eventId,
    status,
    buyer,
    currency: String(values.currency ?? event?.currency ?? ''),
    subtotalMinor: subtotal,
    feeMinor: total - subtotal,
    placedAt: iso(values.placed_at) ?? ctx.now,
    attendees: parsed.data.map((a) => ({
      ticketTypeId: types.get(a.ticket_class_id) as string,
      name: (a.profile.name?.trim() || buyer.name).slice(0, 120),
      email: a.profile.email?.trim() || buyer.email,
      faceMinor: a.costs.base_price.value,
      feeMinor: Math.max(0, a.costs.gross.value - a.costs.base_price.value),
      active: !a.cancelled && !a.refunded,
    })),
  });
  return { localId: orderId };
}

export const eventbriteConnector = defineConnector({
  key: EVENTBRITE,
  name: 'Eventbrite',
  providerConfigKey: 'eventbrite',
  scopes: [],
  entitlement: 'integrations',
  availability: 'general',
  mode: 'import',
  fake: eventbriteFakeProvider,
  objects: [
    {
      key: 'events',
      remoteFields: [
        { key: 'name', label: 'name.text', type: 'string' },
        { key: 'description', label: 'description.text', type: 'string' },
        { key: 'start_utc', label: 'start.utc', type: 'date' },
        { key: 'end_utc', label: 'end.utc', type: 'date' },
        { key: 'timezone', label: 'start.timezone', type: 'string' },
        { key: 'currency', label: 'currency', type: 'string' },
        { key: 'venue_name', label: 'venue.name', type: 'string' },
        { key: 'city', label: 'venue.address.city', type: 'string' },
        { key: 'country', label: 'venue.address.country', type: 'string' },
        { key: 'status', label: 'status', type: 'string' },
      ],
      localFields: [
        { key: 'name', label: 'name', type: 'string', required: true },
        { key: 'tagline', label: 'tagline', type: 'string' },
        { key: 'starts_at', label: 'starts_at', type: 'date', required: true },
        { key: 'ends_at', label: 'ends_at', type: 'date', required: true },
        { key: 'timezone', label: 'timezone', type: 'string', required: true },
        { key: 'currency', label: 'currency', type: 'string', required: true },
        { key: 'venue_name', label: 'venue_name', type: 'string' },
        { key: 'city', label: 'city', type: 'string' },
        { key: 'country', label: 'country', type: 'string' },
      ],
      pull: {
        defaultMapping: [
          { source: 'name', target: 'name', transform: 'trim', default: null },
          { source: 'start_utc', target: 'starts_at', transform: 'to_date', default: null },
          { source: 'end_utc', target: 'ends_at', transform: 'to_date', default: null },
          { source: 'timezone', target: 'timezone', transform: 'none', default: null },
          { source: 'currency', target: 'currency', transform: 'uppercase', default: null },
          { source: 'venue_name', target: 'venue_name', transform: 'trim', default: null },
          { source: 'city', target: 'city', transform: 'trim', default: null },
          { source: 'country', target: 'country', transform: 'uppercase', default: null },
        ],
        async list(io, raw) {
          const { events, next } = await listEvents(io, parseCursor(raw));
          return fullReadPage(flat(events.map(eventRecord)), next);
        },
        async get(io, externalId) {
          // Not a single-event read: retries walk the list (an account has few events).
          for (let c: string | null = null, n = 0; n < 50; n++) {
            const { events, next } = await listEvents(io, { ...EMPTY, c });
            const e = events.find((x) => x.id === externalId);
            if (e) return eventRecord(e);
            if (!next) return null;
            c = next;
          }
          return null;
        },
        write: writeEvent,
      },
    },
    {
      key: 'ticket_classes',
      remoteFields: [
        { key: 'name', label: 'name', type: 'string' },
        { key: 'description', label: 'description', type: 'string' },
        { key: 'price', label: 'cost.value', type: 'number' },
        { key: 'quantity_total', label: 'quantity_total', type: 'number' },
        { key: 'hidden', label: 'hidden', type: 'boolean' },
        { key: 'sales_start', label: 'sales_start', type: 'date' },
        { key: 'sales_end', label: 'sales_end', type: 'date' },
      ],
      localFields: [
        { key: 'name', label: 'name', type: 'string', required: true },
        { key: 'description', label: 'description', type: 'string' },
        { key: 'price_minor', label: 'price_minor', type: 'number', required: true },
        { key: 'quantity_total', label: 'quantity_total', type: 'number', required: true },
        { key: 'hidden', label: 'hidden', type: 'boolean' },
        { key: 'sales_start_at', label: 'sales_start_at', type: 'date' },
        { key: 'sales_end_at', label: 'sales_end_at', type: 'date' },
      ],
      pull: {
        defaultMapping: [
          { source: 'name', target: 'name', transform: 'trim', default: null },
          { source: 'description', target: 'description', transform: 'trim', default: null },
          { source: 'price', target: 'price_minor', transform: 'to_number', default: '0' },
          { source: 'quantity_total', target: 'quantity_total', transform: 'to_number', default: '0' },
          { source: 'hidden', target: 'hidden', transform: 'to_boolean', default: 'false' },
          { source: 'sales_start', target: 'sales_start_at', transform: 'to_date', default: null },
          { source: 'sales_end', target: 'sales_end_at', transform: 'to_date', default: null },
        ],
        async list(io, raw) {
          const { events, next } = await listEvents(io, parseCursor(raw));
          return fullReadPage(flat(events.flatMap((e) => (e.ticket_classes ?? []).map(ticketClassRecord))), next);
        },
        async get(io, externalId) {
          for (let c: string | null = null, n = 0; n < 50; n++) {
            const { events, next } = await listEvents(io, { ...EMPTY, c });
            for (const e of events) {
              const t = (e.ticket_classes ?? []).find((x) => x.id === externalId);
              if (t) return ticketClassRecord(t);
            }
            if (!next) return null;
            c = next;
          }
          return null;
        },
        write: writeTicketClass,
      },
    },
    {
      key: 'orders',
      remoteFields: [
        { key: 'email', label: 'email', type: 'string' },
        { key: 'name', label: 'name', type: 'string' },
        { key: 'status', label: 'status', type: 'string' },
        { key: 'base_price', label: 'costs.base_price.value', type: 'number' },
        { key: 'gross', label: 'costs.gross.value', type: 'number' },
        { key: 'currency', label: 'costs.gross.currency', type: 'string' },
        { key: 'created', label: 'created', type: 'date' },
      ],
      localFields: [
        { key: 'buyer_email', label: 'buyer_email', type: 'email', required: true },
        { key: 'buyer_name', label: 'buyer_name', type: 'string', required: true },
        { key: 'status', label: 'status', type: 'string', required: true },
        { key: 'subtotal_minor', label: 'subtotal_minor', type: 'number', required: true },
        { key: 'total_minor', label: 'total_minor', type: 'number', required: true },
        { key: 'currency', label: 'currency', type: 'string', required: true },
        { key: 'placed_at', label: 'placed_at', type: 'date', required: true },
      ],
      pull: {
        defaultMapping: [
          { source: 'email', target: 'buyer_email', transform: 'lowercase', default: null },
          { source: 'name', target: 'buyer_name', transform: 'trim', default: null },
          { source: 'status', target: 'status', transform: 'lowercase', default: 'placed' },
          { source: 'base_price', target: 'subtotal_minor', transform: 'to_number', default: '0' },
          { source: 'gross', target: 'total_minor', transform: 'to_number', default: '0' },
          { source: 'currency', target: 'currency', transform: 'uppercase', default: null },
          { source: 'created', target: 'placed_at', transform: 'to_date', default: null },
        ],
        list: listOrders,
        async get(io, externalId) {
          for (let c: string | null = null, n = 0; n < 200; n++) {
            const p = await listOrders(io, JSON.stringify({ ...EMPTY, c }));
            const r = p.records.find((x) => x.id === externalId);
            if (r) return r;
            if (!p.hasMore) return null;
            c = parseCursor(p.cursor).c;
          }
          return null;
        },
        write: writeOrder,
      },
    },
  ],
});
