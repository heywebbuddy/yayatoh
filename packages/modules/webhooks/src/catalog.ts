// The zod of @hono/zod-openapi: catalog schemas are published in the /v1 OpenAPI document's
// `webhooks`, so their enums carry component names (Spectral `yayatoh-named-enums`).
import { z } from '@hono/zod-openapi';

/**
 * The public event catalog (M6.3b, roadmap §6.3, D21). Every event an org's webhook endpoint can
 * receive is listed here with a versioned schema, a description and an example. The catalog is
 * the only bridge from the outbox to the outside: an outbox event that is not a `source` here is
 * never sent anywhere (`INTERNAL_EVENTS` lists those, each with a reason, and a test fails on
 * any outbox event that is in neither list).
 *
 * Payloads are **thin** (D21): ids, closed-set values, integer amounts and counts, currencies
 * and timestamps. Never a name, email, phone, address, answer, note or message. A receiver that
 * needs more reads it from `/v1` with its API key (scopes apply there). The schemas are strict
 * about it: every string is a uuid, a date-time, a date, an enum or a short pattern, so free text
 * cannot ride along (`catalog.test.ts` checks the shapes and a leak canary).
 */

/** The public type groups, in documentation order. */
export const EVENT_GROUPS = [
  'orders',
  'tickets',
  'checkin',
  'events',
  'registration',
  'engagement',
  'meta',
] as const;
export type EventGroup = (typeof EVENT_GROUPS)[number];

/** Field names a thin payload may use (D21). Anything else fails `catalog.test.ts`. */
export const THIN_FIELDS = [
  'admissionId',
  'admittedAt',
  'agendaVersion',
  'amountMinor',
  'claimId',
  'currency',
  'day',
  'disputeId',
  'endpointId',
  'entryId',
  'eventId',
  'fields',
  'from',
  'formVersion',
  'fully',
  'invitationId',
  'occurrenceId',
  'offer',
  'offline',
  'operationId',
  'orderId',
  'outcome',
  'profile',
  'publishedAt',
  'rating',
  'refundId',
  'registrationTypeId',
  'respondentId',
  'rev',
  'reviewId',
  'sessions',
  'slug',
  'startsAt',
  'surveyId',
  'test',
  'ticketId',
  'ticketIds',
  'ticketTypeId',
  'tickets',
  'to',
  'totalMinor',
  'transferId',
  'via',
] as const;

const id = () => z.uuid();
const currency = () => z.string().regex(/^[A-Z]{3}$/);
const minor = () => z.number().int();
const at = () => z.iso.datetime({ offset: true });
/** Names of changed fields (machine names such as `startsAt`), never their values. */
const fieldNames = () => z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,47}$/)).max(64);

export interface CatalogEntry<S extends z.ZodObject = z.ZodObject> {
  /** The public type, e.g. `order.paid` (also the Svix event type). */
  readonly type: string;
  /** Schema version. A breaking change ships as a new version next to the old one. */
  readonly version: number;
  readonly group: EventGroup;
  /** One line for lists and the OpenAPI summary. */
  readonly summary: string;
  readonly description: string;
  /** The outbox `type@version` it comes from; null for meta events sent by the platform itself. */
  readonly source: string | null;
  /** The `data` object of the envelope. */
  readonly schema: S;
  /** OpenAPI component name of `schema`. */
  readonly schemaName: string;
  readonly example: z.infer<S>;
  /** Internal payload → public data. Defaults to `schema.parse` (unknown keys are dropped). */
  readonly fromInternal?: (payload: Record<string, unknown>) => z.infer<S>;
}

const entry = <S extends z.ZodObject>(e: CatalogEntry<S>): CatalogEntry<S> => e;

const ORDER = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a81';
const EVENT = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a82';
const TICKET = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a83';
const OTHER = '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a84';
const WHEN = '2030-03-01T23:04:11.000Z';

export const PAYMENT_VIA = ['free', 'box_office', 'fake', 'stripe'] as const;
export const DISPUTE_OUTCOMES = ['won', 'lost'] as const;
/** Event statuses (events module); a new status is an additive enum value (announced ahead). */
export const EVENT_STATUSES = [
  'draft',
  'published',
  'postponed',
  'cancelled',
  'completed',
  'archived',
] as const;

const statusChange = () =>
  z.object({
    eventId: id(),
    from: z.enum(EVENT_STATUSES).openapi('WebhookEventStatus'),
    to: z.enum(EVENT_STATUSES).openapi('WebhookEventStatus'),
  });

/** The event lifecycle transitions (`event.published`, `event.cancelled`, …), one entry each. */
const LIFECYCLE = [
  [
    'published',
    'An event was published.',
    'It is on sale and visible according to its visibility.',
    'draft',
    'published',
  ],
  [
    'unpublished',
    'An event was taken offline.',
    'It went back to draft; its page and sales are closed.',
    'published',
    'draft',
  ],
  [
    'postponed',
    'An event was postponed.',
    'The date is to be announced; ticket holders keep their tickets.',
    'published',
    'postponed',
  ],
  [
    'rescheduled',
    'A postponed event has a new date.',
    'Read the event for its new `startsAt`.',
    'postponed',
    'published',
  ],
  [
    'cancelled',
    'An event was cancelled.',
    'Refunds follow the organizer’s policy (`order.refunded` per order).',
    'published',
    'cancelled',
  ],
  [
    'completed',
    'An event was marked as completed.',
    'It is over; reports are final.',
    'published',
    'completed',
  ],
  [
    'archived',
    'An event was archived.',
    'It is hidden from lists; its data is kept.',
    'completed',
    'archived',
  ],
] as const;
const titleCase = (s: string) => s[0]?.toUpperCase() + s.slice(1);

export const EVENT_CATALOG = [
  // Orders and payments
  entry({
    type: 'order.paid',
    version: 1,
    group: 'orders',
    summary: 'An order was paid and its tickets issued.',
    description:
      'Sent once per order when payment completes (online, at the box office, or a free order). `via` says how it was paid. Read the order and its tickets with `GET /v1/orgs/{org}/orders/{orderId}`.',
    source: 'order.paid@1',
    schemaName: 'WebhookOrderPaidV1',
    schema: z.object({
      orderId: id(),
      eventId: id(),
      totalMinor: minor(),
      currency: currency(),
      via: z.enum(PAYMENT_VIA).openapi('WebhookPaymentVia'),
    }),
    example: { orderId: ORDER, eventId: EVENT, totalMinor: 5000, currency: 'USD', via: 'stripe' },
  }),
  entry({
    type: 'order.refunded',
    version: 1,
    group: 'orders',
    summary: 'All or part of an order was refunded.',
    description:
      'Sent for each refund. `fully` is true when nothing is left to refund; `tickets` counts the tickets the refund cancelled.',
    source: 'order.refunded@1',
    schemaName: 'WebhookOrderRefundedV1',
    schema: z.object({
      orderId: id(),
      refundId: id(),
      amountMinor: minor(),
      currency: currency(),
      tickets: z.number().int().min(0),
      fully: z.boolean(),
    }),
    example: {
      orderId: ORDER,
      refundId: OTHER,
      amountMinor: 2500,
      currency: 'USD',
      tickets: 1,
      fully: false,
    },
  }),
  entry({
    type: 'order.expired',
    version: 1,
    group: 'orders',
    summary: 'An unpaid order expired and released its tickets.',
    description: 'The checkout hold ran out before payment; the held tickets went back on sale.',
    source: 'order.expired@1',
    schemaName: 'WebhookOrderExpiredV1',
    schema: z.object({ orderId: id() }),
    example: { orderId: ORDER },
  }),
  entry({
    type: 'order.payment_failed',
    version: 1,
    group: 'orders',
    summary: 'A payment attempt for an order failed.',
    description: 'The buyer can try again until the order expires.',
    source: 'order.payment_failed@1',
    schemaName: 'WebhookOrderPaymentFailedV1',
    schema: z.object({ orderId: id(), eventId: id() }),
    example: { orderId: ORDER, eventId: EVENT },
  }),
  entry({
    type: 'order.disputed',
    version: 1,
    group: 'orders',
    summary: 'A buyer disputed a payment (chargeback).',
    description: 'Evidence can be submitted from the console before the provider’s deadline.',
    source: 'order.disputed@1',
    schemaName: 'WebhookOrderDisputedV1',
    schema: z.object({ orderId: id(), disputeId: id(), amountMinor: minor() }),
    example: { orderId: ORDER, disputeId: OTHER, amountMinor: 5000 },
  }),
  entry({
    type: 'order.dispute_closed',
    version: 1,
    group: 'orders',
    summary: 'A dispute was decided.',
    description: 'A lost dispute cancels the order’s live tickets.',
    source: 'order.dispute_closed@1',
    schemaName: 'WebhookOrderDisputeClosedV1',
    schema: z.object({
      orderId: id(),
      disputeId: id(),
      outcome: z.enum(DISPUTE_OUTCOMES).openapi('WebhookDisputeOutcome'),
    }),
    example: { orderId: ORDER, disputeId: OTHER, outcome: 'won' },
  }),
  // Tickets
  entry({
    type: 'tickets.cancelled',
    version: 1,
    group: 'tickets',
    summary: 'Tickets were cancelled in bulk.',
    description: 'One message per bulk cancellation, with the ids of the tickets it voided.',
    source: 'tickets.cancelled@1',
    schemaName: 'WebhookTicketsCancelledV1',
    schema: z.object({ operationId: id(), eventId: id(), ticketIds: z.array(id()).max(1000) }),
    example: { operationId: OTHER, eventId: EVENT, ticketIds: [TICKET] },
  }),
  entry({
    type: 'ticket.transferred',
    version: 1,
    group: 'tickets',
    summary: 'A ticket moved to a new holder.',
    description:
      'The previous QR code stops working; `rev` is the ticket’s new revision. The new holder’s details are not in the payload.',
    source: 'ticket.transferred@1',
    schemaName: 'WebhookTicketTransferredV1',
    schema: z.object({ transferId: id(), ticketId: id(), eventId: id(), rev: z.number().int().min(0) }),
    example: { transferId: OTHER, ticketId: TICKET, eventId: EVENT, rev: 2 },
  }),
  entry({
    type: 'ticket.claimed',
    version: 1,
    group: 'tickets',
    summary: 'A distributed ticket was claimed by its guest.',
    description: 'Sent when someone opens a claim link and takes the ticket.',
    source: 'ticket.claimed@1',
    schemaName: 'WebhookTicketClaimedV1',
    schema: z.object({
      ticketId: id(),
      claimId: id(),
      eventId: id().nullable(),
      rev: z.number().int().min(0),
    }),
    example: { ticketId: TICKET, claimId: OTHER, eventId: EVENT, rev: 1 },
  }),
  // Check-in
  entry({
    type: 'ticket.admitted',
    version: 1,
    group: 'checkin',
    summary: 'A ticket was scanned in.',
    description:
      '`day` is the event day in the event’s time zone. `offline` is true when a door device scanned without a connection and synced later.',
    source: 'ticket.admitted@1',
    schemaName: 'WebhookTicketAdmittedV1',
    schema: z.object({
      eventId: id(),
      ticketId: id(),
      admissionId: id(),
      day: z.iso.date(),
      admittedAt: at(),
      offline: z.boolean().optional(),
    }),
    example: { eventId: EVENT, ticketId: TICKET, admissionId: OTHER, day: '2030-03-01', admittedAt: WHEN },
  }),
  entry({
    type: 'ticket.admission_undone',
    version: 1,
    group: 'checkin',
    summary: 'A scan was undone.',
    description: 'Door staff reversed an admission (a mistaken scan); the ticket can be scanned again.',
    source: 'ticket.admission_undone@1',
    schemaName: 'WebhookTicketAdmissionUndoneV1',
    schema: z.object({
      eventId: id(),
      ticketId: id(),
      admissionId: id(),
      day: z.iso.date(),
      admittedAt: at(),
    }),
    example: { eventId: EVENT, ticketId: TICKET, admissionId: OTHER, day: '2030-03-01', admittedAt: WHEN },
  }),
  // Events and ticket types
  entry({
    type: 'event.created',
    version: 1,
    group: 'events',
    summary: 'An event was created (new, duplicated or from a template).',
    description: 'The event starts as a draft. `profile` is its kind (concert, gala, conference…).',
    source: 'event.created@1',
    schemaName: 'WebhookEventCreatedV1',
    schema: z.object({
      eventId: id(),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
      profile: z.string().regex(/^[a-z_]{1,32}$/),
    }),
    example: { eventId: EVENT, slug: 'spring-gala', profile: 'gala' },
  }),
  ...LIFECYCLE.map(([past, summary, description, from, to]) =>
    entry({
      type: `event.${past}`,
      version: 1,
      group: 'events',
      summary,
      description: `${description} \`from\` and \`to\` are the event’s status before and after.`,
      source: `event.${past}@1`,
      schemaName: `WebhookEvent${titleCase(past)}V1`,
      schema: statusChange(),
      example: { eventId: EVENT, from, to },
    }),
  ),
  entry({
    type: 'event.updated',
    version: 1,
    group: 'events',
    summary: 'An event’s details changed.',
    description: '`fields` names what changed (for example `startsAt`); read the event for the new values.',
    source: 'event.updated@1',
    schemaName: 'WebhookEventUpdatedV1',
    schema: z.object({ eventId: id(), fields: fieldNames() }),
    example: { eventId: EVENT, fields: ['name', 'startsAt'] },
  }),
  entry({
    type: 'event.occurrence_cancelled',
    version: 1,
    group: 'events',
    summary: 'One date of a recurring event was cancelled.',
    description: '`startsAt` is when the cancelled date was due to start.',
    source: 'event.occurrence_cancelled@1',
    schemaName: 'WebhookEventOccurrenceCancelledV1',
    schema: z.object({ eventId: id(), occurrenceId: id(), startsAt: at() }),
    example: { eventId: EVENT, occurrenceId: OTHER, startsAt: WHEN },
  }),
  entry({
    type: 'ticket_type.created',
    version: 1,
    group: 'events',
    summary: 'A ticket type was added to an event.',
    description: 'Read it with `GET /v1/orgs/{org}/events/{eventId}/ticket-types`.',
    source: 'ticket_type.created@1',
    schemaName: 'WebhookTicketTypeCreatedV1',
    schema: z.object({ eventId: id(), ticketTypeId: id() }),
    example: { eventId: EVENT, ticketTypeId: OTHER },
  }),
  entry({
    type: 'ticket_type.updated',
    version: 1,
    group: 'events',
    summary: 'A ticket type changed.',
    description: '`fields` names what changed (for example `priceMinor`).',
    source: 'ticket_type.updated@1',
    schemaName: 'WebhookTicketTypeUpdatedV1',
    schema: z.object({ eventId: id(), ticketTypeId: id(), fields: fieldNames() }),
    example: { eventId: EVENT, ticketTypeId: OTHER, fields: ['priceMinor'] },
  }),
  entry({
    type: 'ticket_type.archived',
    version: 1,
    group: 'events',
    summary: 'A ticket type was archived.',
    description: 'It is no longer sold; tickets already issued stay valid.',
    source: 'ticket_type.archived@1',
    schemaName: 'WebhookTicketTypeArchivedV1',
    schema: z.object({ eventId: id(), ticketTypeId: id() }),
    example: { eventId: EVENT, ticketTypeId: OTHER },
  }),
  // Registration
  entry({
    type: 'form.registration_submitted',
    version: 1,
    group: 'registration',
    summary: 'A registration form was submitted.',
    description:
      'The answers are never in the payload; they stay in the console. `formVersion` is the form version answered.',
    source: 'form.registration_submitted@1',
    schemaName: 'WebhookRegistrationSubmittedV1',
    schema: z.object({
      respondentId: id(),
      eventId: id().nullable(),
      // The registration type's key (organizer-defined, e.g. `vip`), as in the form definition.
      registrationTypeId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/)
        .nullable(),
      formVersion: z.number().int().min(1).nullable(),
    }),
    example: { respondentId: OTHER, eventId: EVENT, registrationTypeId: 'vip', formVersion: 3 },
    fromInternal: (p) => ({
      respondentId: p.respondentId as string,
      eventId: (p.eventId as string | null) ?? null,
      registrationTypeId: (p.registrationTypeId as string | null) ?? null,
      formVersion: (p.version as number | null) ?? null,
    }),
  }),
  entry({
    type: 'waitlist.joined',
    version: 1,
    group: 'registration',
    summary: 'Someone joined an event’s waitlist.',
    description: 'Who joined is not in the payload.',
    source: 'waitlist.joined@1',
    schemaName: 'WebhookWaitlistJoinedV1',
    schema: z.object({ entryId: id(), eventId: id() }),
    example: { entryId: OTHER, eventId: EVENT },
  }),
  entry({
    type: 'waitlist.offered',
    version: 1,
    group: 'registration',
    summary: 'A waitlist entry was offered a place.',
    description: '`offer` counts the offers this entry has had (1 for the first).',
    source: 'waitlist.offered@1',
    schemaName: 'WebhookWaitlistOfferedV1',
    schema: z.object({ entryId: id(), eventId: id(), offer: z.number().int().min(1) }),
    example: { entryId: OTHER, eventId: EVENT, offer: 1 },
  }),
  // Engagement
  entry({
    type: 'survey.responded',
    version: 1,
    group: 'engagement',
    summary: 'A survey was answered.',
    description: 'The answers stay in the console; the payload says which survey and invitation.',
    source: 'survey.responded@1',
    schemaName: 'WebhookSurveyRespondedV1',
    schema: z.object({ surveyId: id(), eventId: id().nullable(), invitationId: id() }),
    example: { surveyId: OTHER, eventId: EVENT, invitationId: TICKET },
  }),
  entry({
    type: 'review.submitted',
    version: 1,
    group: 'engagement',
    summary: 'An attendee rated an event.',
    description: '`rating` is 1 to 5. The review text is not in the payload.',
    source: 'review.submitted@1',
    schemaName: 'WebhookReviewSubmittedV1',
    schema: z.object({ eventId: id(), reviewId: id(), rating: z.number().int().min(1).max(5) }),
    example: { eventId: EVENT, reviewId: OTHER, rating: 5 },
  }),
  entry({
    type: 'program.agenda_published',
    version: 1,
    group: 'engagement',
    summary: 'An event’s agenda was published.',
    description: '`agendaVersion` increases with each publish; read the agenda from the public content API.',
    source: 'program.agenda.published@1',
    schemaName: 'WebhookAgendaPublishedV1',
    schema: z.object({
      eventId: id(),
      agendaVersion: z.number().int().min(1),
      sessions: z.number().int().min(0),
      publishedAt: at(),
    }),
    example: { eventId: EVENT, agendaVersion: 2, sessions: 14, publishedAt: WHEN },
    fromInternal: (p) => ({
      eventId: p.eventId as string,
      agendaVersion: p.version as number,
      sessions: p.sessions as number,
      publishedAt: p.publishedAt as string,
    }),
  }),
  // Meta
  entry({
    type: 'webhook.test',
    version: 1,
    group: 'meta',
    summary: 'A test message sent from the console.',
    description:
      'Sent only to the endpoint you test, with `test: true`. Use it to check that your endpoint verifies signatures and answers 2xx.',
    source: null,
    schemaName: 'WebhookTestV1',
    schema: z.object({ endpointId: id(), test: z.literal(true) }),
    example: { endpointId: OTHER, test: true },
  }),
] as const satisfies readonly CatalogEntry[];

export type PublicEventType = (typeof EVENT_CATALOG)[number]['type'];

export const PUBLIC_EVENT_TYPES: readonly string[] = EVENT_CATALOG.map((e) => e.type);

/** Types an endpoint can subscribe to (all but meta events, which are sent on request). */
export const SUBSCRIBABLE_EVENT_TYPES: readonly string[] = EVENT_CATALOG.filter(
  (e) => e.group !== 'meta',
).map((e) => e.type);

export function catalogEntry(type: string): CatalogEntry | null {
  return (EVENT_CATALOG as readonly CatalogEntry[]).find((e) => e.type === type) ?? null;
}

const BY_SOURCE = new Map<string, CatalogEntry>(
  (EVENT_CATALOG as readonly CatalogEntry[]).filter((e) => e.source).map((e) => [e.source as string, e]),
);

/** The catalog entry an outbox `type@version` publishes as, if any. */
export function entryForSource(key: string): CatalogEntry | null {
  return BY_SOURCE.get(key) ?? null;
}

/** Outbox `type@version` keys that leave the platform as webhooks. */
export const PUBLIC_SOURCES: readonly string[] = [...BY_SOURCE.keys()];

/** The message every endpoint receives: the envelope around `data`. */
export const WEBHOOK_API_VERSION = 'v1';

export interface WebhookEnvelope<D = unknown> {
  /** The message id (the outbox event id; a retry or replay reuses it). */
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly apiVersion: typeof WEBHOOK_API_VERSION;
  readonly occurredAt: string;
  readonly orgId: string;
  readonly data: D;
}

export const WebhookEnvelopeBase = z.object({
  id: z.uuid(),
  type: z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/),
  version: z.number().int().min(1),
  apiVersion: z.literal(WEBHOOK_API_VERSION),
  occurredAt: at(),
  orgId: z.uuid(),
});

/**
 * Serialize an internal outbox payload for the outside (the allowlist step): the entry's mapper or
 * its schema, then the schema again, so whatever the mapper returns is checked. Throws on a payload
 * that does not fit (never sends a partial or unchecked one).
 */
export function toPublicData(e: CatalogEntry, payload: unknown): Record<string, unknown> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const mapped = e.fromInternal ? e.fromInternal(p) : p;
  return e.schema.parse(mapped) as Record<string, unknown>;
}

export function envelope(
  e: CatalogEntry,
  meta: { id: string; orgId: string; occurredAt: string },
  data: Record<string, unknown>,
): WebhookEnvelope<Record<string, unknown>> {
  return {
    id: meta.id,
    type: e.type,
    version: e.version,
    apiVersion: WEBHOOK_API_VERSION,
    occurredAt: meta.occurredAt,
    orgId: meta.orgId,
    data,
  };
}

/** The example envelope for docs and test sends. */
export function exampleEnvelope(e: CatalogEntry): WebhookEnvelope<Record<string, unknown>> {
  return envelope(
    e,
    {
      id: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a80',
      orgId: '0192f1a4-7c3e-7d51-9a2b-3c4d5e6f7a7f',
      occurredAt: WHEN,
    },
    e.example as Record<string, unknown>,
  );
}
