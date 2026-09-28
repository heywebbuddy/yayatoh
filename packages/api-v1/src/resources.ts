import { z } from '@hono/zod-openapi';
import { ATTENDEE_SOURCES, ATTENDEE_STATUSES } from '@yayatoh/attendees';
import { SCAN_RESULTS } from '@yayatoh/checkin';
import type { ProblemDto } from '@yayatoh/contracts';
import { EVENT_PROFILES, EVENT_STATUSES, EVENT_VISIBILITIES } from '@yayatoh/events';
import { ORDER_STATUSES, REFUND_REASONS } from '@yayatoh/orders';
import { API_KEY_SCOPES, ORG_ROLES } from '@yayatoh/tenancy';
import { FEE_MODES, TICKET_TYPE_VISIBILITIES } from '@yayatoh/ticketing';

/**
 * The /v1 wire resources. Each is an allowlist: `toWire` turns dates into ISO strings and the
 * schema parse drops every key it does not declare, so an ORM row can never leak through.
 */
export function toWire<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  return schema.parse(isoDates(value));
}

function isoDates(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(isoDates);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, isoDates(x)]));
  }
  return v;
}

const DateTime = z.iso.datetime({ offset: true });

/** RFC 9457 problem details (the same shape as `ProblemDto`). */
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    code: z.string().openapi({ description: 'Stable machine code, e.g. `forbidden`, `rate_limited`.' }),
    detail: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('Problem') satisfies z.ZodType<ProblemDto>;

export const User = z.object({ id: z.uuid(), name: z.string(), email: z.string() }).openapi('User');

export const Session = z
  .object({
    token: z.string().openapi({ description: 'Send as `Authorization: Bearer <token>`.' }),
    tokenType: z.literal('bearer'),
    expiresAt: DateTime,
    user: User,
  })
  .openapi('Session');

export const Membership = z
  .object({ id: z.uuid(), slug: z.string(), name: z.string(), role: z.enum(ORG_ROLES) })
  .openapi('Membership');

export const Organization = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    country: z.string(),
    currency: z.string(),
    defaultLocale: z.string(),
  })
  .openapi('Organization');

export const Event = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    tagline: z.string().nullable(),
    profile: z.enum(EVENT_PROFILES),
    status: z.enum(EVENT_STATUSES),
    visibility: z.enum(EVENT_VISIBILITIES),
    timezone: z.string().openapi({ description: 'IANA timezone; event times render in it.' }),
    startsAt: DateTime,
    endsAt: DateTime,
    venueName: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    currency: z.string(),
    publishedAt: DateTime.nullable(),
  })
  .openapi('Event');

const AccessDate = z.object({ date: z.string(), name: z.string() });

export const TicketType = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    priceMinor: z.int().openapi({ description: 'Face value in minor units.' }),
    currency: z.string(),
    feeMode: z.enum(FEE_MODES),
    quantityTotal: z.int(),
    quantitySold: z.int(),
    quantityHeld: z.int(),
    minPerOrder: z.int(),
    maxPerOrder: z.int(),
    salesStartAt: DateTime.nullable(),
    salesEndAt: DateTime.nullable(),
    visibility: z.enum(TICKET_TYPE_VISIBILITIES),
    sortOrder: z.int(),
    earlyPriceMinor: z.int().nullable(),
    earlyEndsAt: DateTime.nullable(),
    isDonation: z.boolean(),
    accessDates: z.array(AccessDate),
    allInMinor: z.int(),
    feeMinor: z.int(),
  })
  .openapi('TicketType');

const OrderItem = z.object({
  ticketTypeId: z.uuid(),
  name: z.string(),
  quantity: z.int(),
  unitAllInMinor: z.int(),
});

export const Order = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    status: z.enum(ORDER_STATUSES),
    buyerName: z.string(),
    buyerEmail: z.string(),
    currency: z.string(),
    subtotalMinor: z.int(),
    discountMinor: z.int(),
    promoCode: z.string().nullable(),
    feeMinor: z.int(),
    totalMinor: z.int(),
    paidAt: DateTime.nullable(),
    createdAt: DateTime,
    items: z.array(OrderItem),
  })
  .openapi('Order');

export const OrderTicket = z.object({
  id: z.uuid(),
  serial: z.int(),
  shortCode: z.string(),
  status: z.string(),
  holderName: z.string().nullable(),
  holderEmail: z.string().nullable(),
  itemName: z.string(),
  seatLabel: z.string().nullable(),
});

export const OrderDetail = Order.extend({ tickets: z.array(OrderTicket) }).openapi('OrderDetail');

export const Refund = z
  .object({
    refundId: z.uuid(),
    status: z.enum(['succeeded', 'failed', 'pending']),
    amountMinor: z.int(),
    feeRefundedMinor: z.int(),
    currency: z.string(),
  })
  .openapi('Refund');

export const RefundRequest = z
  .object({
    reason: z.enum(REFUND_REASONS),
    ticketIds: z.array(z.uuid()).min(1).max(500).optional(),
    amountMinor: z.int().positive().optional(),
    note: z.string().max(500).optional(),
  })
  .openapi('RefundRequest', {
    description: 'Refund whole tickets (`ticketIds`) or an amount (`amountMinor`), not both.',
  });

export const Attendee = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    name: z.string(),
    email: z.string(),
    source: z.enum(ATTENDEE_SOURCES),
    status: z.enum(ATTENDEE_STATUSES),
    ticketId: z.uuid().nullable(),
    labels: z.array(z.string()),
    createdAt: DateTime,
  })
  .openapi('Attendee');

export const AttendeeHit = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    name: z.string(),
    email: z.string(),
    ticketId: z.uuid().nullable(),
  })
  .openapi('AttendeeHit');

export const ScanVerdict = z
  .object({
    result: z.enum(SCAN_RESULTS),
    ticket: z
      .object({
        holderName: z.string().nullable(),
        typeName: z.string(),
        serial: z.int(),
        shortCode: z.string(),
      })
      .nullable(),
    admissionId: z.uuid().nullable(),
    firstAdmittedAt: DateTime.nullable(),
  })
  .openapi('ScanVerdict');

export const PublicEvent = z
  .object({
    slug: z.string(),
    name: z.string(),
    tagline: z.string().nullable(),
    profile: z.enum(EVENT_PROFILES),
    status: z.enum(EVENT_STATUSES),
    timezone: z.string(),
    startsAt: DateTime,
    endsAt: DateTime,
    venueName: z.string().nullable(),
    city: z.string().nullable(),
    currency: z.string(),
    organizerName: z.string(),
  })
  .openapi('PublicEvent');

export const PublicTicketType = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    currency: z.string(),
    allInMinor: z.int(),
    regularAllInMinor: z.int().nullable(),
    earlyEndsAt: DateTime.nullable(),
    isDonation: z.boolean(),
    accessDates: z.array(AccessDate),
    availability: z.enum(['available', 'sold_out', 'not_yet_on_sale', 'sales_ended']),
    fewLeft: z.boolean(),
    minPerOrder: z.int(),
    maxPerOrder: z.int(),
  })
  .openapi('PublicTicketType');

export const MobileConfig = z
  .object({
    apiVersion: z.string(),
    minimumVersions: z.object({ ios: z.string(), android: z.string() }),
    latestVersions: z.object({ ios: z.string(), android: z.string() }),
    baseUrls: z.object({ api: z.string(), web: z.string() }),
    features: z.record(z.string(), z.boolean()),
  })
  .openapi('MobileConfig');

export const ApiKeyScopes = z.array(z.enum(API_KEY_SCOPES));

/** Bulk actions on `/v1` (M1.13d): one path segment per registered M1.8 bulk action. */
export const BULK_KINDS = [
  'labels',
  'emails',
  'seat-assignments',
  'ticket-resends',
  'ticket-cancellations',
] as const;
export type BulkKind = (typeof BULK_KINDS)[number];
const BULK_OPERATION_STATUSES = ['queued', 'running', 'done', 'failed', 'undoing', 'undone'] as const;
const MAX_BULK_IDS = 50_000;

const BulkItem = z.object({
  attendeeId: z.uuid(),
  code: z.string().openapi({ description: 'Stable code, e.g. `not_found`, `no_ticket`, `ada_kept_back`.' }),
});

export const BulkOperation = z
  .object({
    id: z.uuid(),
    kind: z.enum(BULK_KINDS),
    eventId: z.uuid().nullable(),
    status: z.enum(BULK_OPERATION_STATUSES),
    total: z.int(),
    processed: z.int(),
    succeeded: z.int(),
    failed: z.int(),
    undone: z.int(),
    createdAt: DateTime,
    finishedAt: DateTime.nullable(),
    undoUntil: DateTime.nullable().openapi({ description: 'Set while the operation can still be undone.' }),
    failures: z.array(BulkItem).openapi({ description: 'The first 50 attendees that failed.' }),
    warnings: z
      .array(BulkItem)
      .openapi({ description: 'The first 50 attendees that succeeded with a caveat.' }),
  })
  .openapi('BulkOperation');

const Label = z.string().min(1).max(40);
/** The attendee list filters a selection may use ("everything matching"). */
export const BulkAttendeeFilter = z
  .object({
    search: z.string().max(200).optional().openapi({ description: 'Name or email contains' }),
    labels: z.array(Label).max(20).optional().openapi({ description: 'Carrying any of these labels' }),
    source: z.enum(ATTENDEE_SOURCES).optional(),
    status: z.enum(ATTENDEE_STATUSES).optional(),
  })
  .openapi('BulkAttendeeFilter');
const ByIds = z.object({ ids: z.array(z.uuid()).min(1).max(MAX_BULK_IDS) }).openapi('BulkSelectionByIds');
export const BulkSelection = z
  .union([ByIds, z.object({ filter: BulkAttendeeFilter }).openapi('BulkSelectionByFilter')])
  .openapi('BulkSelection');

export const BulkLabelRequest = z
  .object({
    selection: BulkSelection,
    add: z.array(Label).max(20).optional(),
    remove: z.array(Label).max(20).optional(),
  })
  .openapi('BulkLabelRequest');
export const BulkEmailRequest = z
  .object({
    selection: BulkSelection,
    subject: z.string().min(1).max(150),
    body: z.string().min(1).max(5_000).openapi({ description: 'Plain text.' }),
  })
  .openapi('BulkEmailRequest');
export const BulkSeatTarget = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), itemId: z.uuid() }),
    z.object({ kind: z.literal('section'), sectionId: z.uuid() }),
    z.object({ kind: z.literal('best') }),
    z.object({ kind: z.literal('group'), label: Label }),
  ])
  .openapi('BulkSeatTarget', {
    description: 'A table or row (`item`), a section, the best available seats, or a group’s block.',
  });
export const BulkSeatRequest = z
  .object({
    selection: BulkSelection,
    target: BulkSeatTarget,
    overrideRules: z
      .boolean()
      .optional()
      .openapi({ description: 'Use accessible seats an enforced rule keeps back (audited).' }),
  })
  .openapi('BulkSeatRequest');
export const BulkResendRequest = z.object({ selection: BulkSelection }).openapi('BulkResendRequest');
export const BulkCancelRequest = z.object({ selection: ByIds }).openapi('BulkCancelRequest');

/** `{ data, nextCursor }`: pass `nextCursor` back as `cursor`; null means the last page. */
export function pageSchema<T extends z.ZodType>(item: T, name: string) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() }).openapi(name);
}
export function listSchema<T extends z.ZodType>(item: T, name: string) {
  return z.object({ data: z.array(item) }).openapi(name);
}
