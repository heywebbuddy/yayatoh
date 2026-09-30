import { z } from '@hono/zod-openapi';
import { ATTENDEE_SOURCES, ATTENDEE_STATUSES } from '@yayatoh/attendees';
import { ScanResult } from '@yayatoh/checkin/routes';
import type { ProblemDto } from '@yayatoh/contracts';
import {
  ANNOUNCEMENT_AUDIENCES,
  ATTENDANCE_MODES,
  EVENT_CATEGORIES,
  EVENT_PROFILES,
  EVENT_STATUSES,
  EVENT_VISIBILITIES,
  OCCURRENCE_STATUSES,
  SECTION_KINDS,
} from '@yayatoh/events';
import { SLOTS, VARIANT_FORMATS } from '@yayatoh/media';
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

/*
 * Named enums (Spectral `yayatoh-named-enums`): every choice list is a component, so the
 * generated TS/Swift/Kotlin clients get one type per enum instead of anonymous inline ones.
 */
export const OrgRole = z.enum(ORG_ROLES).openapi('OrgRole');
export const EventProfile = z.enum(EVENT_PROFILES).openapi('EventProfile');
export const EventStatus = z.enum(EVENT_STATUSES).openapi('EventStatus');
export const EventVisibility = z.enum(EVENT_VISIBILITIES).openapi('EventVisibility');
export const EventCategory = z.enum(EVENT_CATEGORIES).openapi('EventCategory');
export const AttendanceMode = z.enum(ATTENDANCE_MODES).openapi('AttendanceMode');
export const FeeMode = z.enum(FEE_MODES).openapi('FeeMode');
export const TicketTypeVisibility = z.enum(TICKET_TYPE_VISIBILITIES).openapi('TicketTypeVisibility');
export const Availability = z
  .enum(['available', 'sold_out', 'not_yet_on_sale', 'sales_ended'])
  .openapi('Availability');
export const OrderStatus = z.enum(ORDER_STATUSES).openapi('OrderStatus');
export const RefundStatus = z.enum(['succeeded', 'failed', 'pending']).openapi('RefundStatus');
export const RefundReason = z.enum(REFUND_REASONS).openapi('RefundReason');
export const AttendeeSource = z.enum(ATTENDEE_SOURCES).openapi('AttendeeSource');
export const AttendeeStatus = z.enum(ATTENDEE_STATUSES).openapi('AttendeeStatus');
export { ScanResult };
export const HealthStatus = z.enum(['ok', 'degraded']).openapi('HealthStatus');
export const Health = z
  .object({ status: HealthStatus, service: z.string(), version: z.string(), time: z.iso.datetime() })
  .openapi('Health');
export const SectionKind = z.enum(SECTION_KINDS).openapi('SectionKind');
export const AnnouncementAudience = z.enum(ANNOUNCEMENT_AUDIENCES).openapi('AnnouncementAudience');
export const DateStatus = z.enum(OCCURRENCE_STATUSES).openapi('DateStatus');
export const ImageSlot = z.enum(SLOTS).openapi('ImageSlot');
export const ImageFormat = z.enum(VARIANT_FORMATS).openapi('ImageFormat');

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

/** M1.2f: a short-lived access token and a rotating refresh token (`POST /v1/auth/token`). */
export const TokenPair = z
  .object({
    accessToken: z.string().openapi({
      description: 'Send as `Authorization: Bearer <accessToken>`. Lasts 15 minutes and is never extended.',
    }),
    tokenType: z.literal('bearer'),
    accessTokenExpiresAt: DateTime,
    refreshToken: z.string().openapi({
      description:
        'Single use: exchange it for a new pair before the access token ends. Presenting a spent refresh token again revokes the whole chain (reuse detection).',
    }),
    refreshTokenExpiresAt: DateTime,
    user: User,
  })
  .openapi('TokenPair');

export const Membership = z
  .object({ id: z.uuid(), slug: z.string(), name: z.string(), role: OrgRole })
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
    profile: EventProfile,
    status: EventStatus,
    visibility: EventVisibility,
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
    feeMode: FeeMode,
    quantityTotal: z.int(),
    quantitySold: z.int(),
    quantityHeld: z.int(),
    minPerOrder: z.int(),
    maxPerOrder: z.int(),
    salesStartAt: DateTime.nullable(),
    salesEndAt: DateTime.nullable(),
    visibility: TicketTypeVisibility,
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
    status: OrderStatus,
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
    status: RefundStatus,
    amountMinor: z.int(),
    feeRefundedMinor: z.int(),
    currency: z.string(),
  })
  .openapi('Refund');

export const RefundRequest = z
  .object({
    reason: RefundReason,
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
    source: AttendeeSource,
    status: AttendeeStatus,
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
    result: ScanResult,
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
    profile: EventProfile,
    status: EventStatus,
    timezone: z.string(),
    startsAt: DateTime,
    endsAt: DateTime,
    venueName: z.string().nullable(),
    city: z.string().nullable(),
    currency: z.string(),
    organizerName: z.string(),
    // M1.13d (additive): what a client needs to link the venue and label the event.
    category: EventCategory.nullable(),
    attendanceMode: AttendanceMode,
    venueSlug: z.string().nullable().openapi({
      description: 'The venue’s slug when it is in the directory (`GET /v1/public/venues/{slug}`).',
    }),
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
    availability: Availability,
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
export const BulkKindSchema = z.enum(BULK_KINDS).openapi('BulkKind');
export const BulkOperationStatus = z.enum(BULK_OPERATION_STATUSES).openapi('BulkOperationStatus');
const MAX_BULK_IDS = 50_000;

const BulkItem = z.object({
  attendeeId: z.uuid(),
  code: z.string().openapi({ description: 'Stable code, e.g. `not_found`, `no_ticket`, `ada_kept_back`.' }),
});

export const BulkOperation = z
  .object({
    id: z.uuid(),
    kind: BulkKindSchema,
    eventId: z.uuid().nullable(),
    status: BulkOperationStatus,
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
    source: AttendeeSource.optional(),
    status: AttendeeStatus.optional(),
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

/* ------------------------------------------------ M1.13d: event content, venues, program ---- */

const Link = z.object({ label: z.string(), url: z.string() }).openapi('Link');

const sectionVariant = <K extends (typeof SECTION_KINDS)[number], C extends z.ZodType>(
  kind: K,
  content: C,
  name: string,
  extra: z.ZodRawShape = {},
) => z.object({ id: z.uuid(), title: z.string(), kind: z.literal(kind), content, ...extra }).openapi(name);

const TextContent = z
  .object({ markdown: z.string().openapi({ description: 'Sanitized Markdown (small subset).' }) })
  .openapi('TextSectionContent');
const FaqContent = z
  .object({ items: z.array(z.object({ question: z.string(), answer: z.string() })) })
  .openapi('FaqSectionContent');
const ScheduleContent = z
  .object({
    items: z.array(
      z.object({
        time: z.string().openapi({ description: '`HH:MM`, wall-clock in the event’s timezone.' }),
        title: z.string(),
        detail: z.string().nullable(),
      }),
    ),
  })
  .openapi('ScheduleSectionContent');
const LocationContent = z
  .object({ address: z.string(), directions: z.string(), mapUrl: z.string().nullable() })
  .openapi('LocationSectionContent');
const LinksContent = z.object({ items: z.array(Link) }).openapi('LinksSectionContent');

function sectionSchema(prefix: string, extra: z.ZodRawShape = {}) {
  return z
    .discriminatedUnion('kind', [
      sectionVariant('text', TextContent, `${prefix}TextSection`, extra),
      sectionVariant('faq', FaqContent, `${prefix}FaqSection`, extra),
      sectionVariant('schedule', ScheduleContent, `${prefix}ScheduleSection`, extra),
      sectionVariant('location', LocationContent, `${prefix}LocationSection`, extra),
      sectionVariant('links', LinksContent, `${prefix}LinksSection`, extra),
    ])
    .openapi(`${prefix}EventSection`, {
      description: 'A content block of the event page; `kind` says which `content` shape it has.',
    });
}

/** A visible section of a public event page (hidden sections never appear). */
export const PublicEventSection = sectionSchema('Public');
/** An event page section as the organizer sees it, hidden ones included. */
export const EventSection = sectionSchema('', { position: z.int(), visible: z.boolean() });

export const PublicAnnouncement = z
  .object({
    id: z.uuid(),
    title: z.string(),
    body: z.string().openapi({ description: 'Sanitized Markdown.' }),
    pinned: z.boolean(),
    publishedAt: DateTime,
  })
  .openapi('PublicAnnouncement', {
    description: 'A published announcement for everyone (`public` audience).',
  });

export const Announcement = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    title: z.string(),
    body: z.string(),
    audience: AnnouncementAudience,
    pinned: z.boolean(),
    publishedAt: DateTime.nullable().openapi({ description: 'Null while it is a draft.' }),
    createdAt: DateTime,
  })
  .openapi('Announcement');

export const PublicEventDate = z
  .object({
    id: z.uuid(),
    startsAt: DateTime,
    endsAt: DateTime,
    status: DateStatus,
    soldOut: z.boolean(),
  })
  .openapi('PublicEventDate', { description: 'One date of a multi-date event (no capacity numbers).' });

export const EventDate = z
  .object({
    id: z.uuid(),
    eventId: z.uuid(),
    startsAt: DateTime,
    endsAt: DateTime,
    capacity: z.int().nullable(),
    status: DateStatus,
  })
  .openapi('EventDate');

export const ImageVariant = z
  .object({
    format: ImageFormat,
    width: z.int(),
    height: z.int(),
    url: z.url().openapi({
      description: 'Absolute, content-hashed and immutable (`…/{width}-{sha256}.{ext}`): cache it forever.',
    }),
    fallback: z.boolean().openapi({ description: 'The JPEG/PNG (or SVG) every client can show.' }),
  })
  .openapi('ImageVariant');

export const Image = z
  .object({
    id: z.uuid(),
    slot: ImageSlot,
    position: z.int(),
    width: z.int(),
    height: z.int(),
    alt: z.string().openapi({ description: 'Empty for decorative images.' }),
    decorative: z.boolean(),
    variants: z.array(ImageVariant),
  })
  .openapi('Image');

const VenueEvent = z
  .object({ slug: z.string(), name: z.string(), startsAt: DateTime, endsAt: DateTime, timezone: z.string() })
  .openapi('VenueEvent');

export const DirectoryVenue = z
  .object({
    slug: z.string(),
    name: z.string(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string(),
    capacity: z.int().nullable(),
  })
  .openapi('DirectoryVenue');

const venueFields = {
  slug: z.string(),
  name: z.string(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timezone: z.string(),
  capacity: z.int().nullable(),
  accessibilityNotes: z.string().nullable(),
  mapUrl: z.string().nullable(),
};

export const PublicVenue = z
  .object({
    ...venueFields,
    organizerName: z.string(),
    photos: z.array(Image),
    upcomingEvents: z.array(VenueEvent).openapi({ description: 'Upcoming public events at the venue.' }),
  })
  .openapi('PublicVenue', {
    description: 'A venue listed in the directory (quote requests are not exposed).',
  });

export const Venue = z
  .object({ id: z.uuid(), ...venueFields, directoryListed: z.boolean(), archivedAt: DateTime.nullable() })
  .openapi('Venue');

const SpeakerRef = z.object({ id: z.uuid(), name: z.string() }).openapi('SpeakerRef');

export const AgendaSession = z
  .object({
    id: z.uuid(),
    title: z.string(),
    description: z.string().openapi({ description: 'Sanitized Markdown.' }),
    startsAt: DateTime,
    endsAt: DateTime,
    dateId: z.uuid().nullable().openapi({ description: 'The event date it belongs to (multi-date events).' }),
    track: z.string().nullable(),
    room: z.string().nullable(),
    speakers: z.array(SpeakerRef),
  })
  .openapi('AgendaSession');

const agendaDay = <T extends z.ZodType>(session: T, name: string) =>
  z
    .object({
      date: z.iso.date().openapi({ description: 'The day in the event’s timezone (`YYYY-MM-DD`).' }),
      sessions: z.array(session),
    })
    .openapi(name);

export const PublicAgenda = z
  .object({
    timezone: z.string().openapi({ description: 'The event’s IANA timezone; days and times render in it.' }),
    days: z.array(agendaDay(AgendaSession, 'AgendaDay')),
  })
  .openapi('PublicAgenda', {
    description: 'Sessions grouped by day in the event’s timezone, in start order.',
  });

export const Track = z.object({ id: z.uuid(), name: z.string() }).openapi('Track');
export const Room = z
  .object({ id: z.uuid(), name: z.string(), capacity: z.int().nullable() })
  .openapi('Room');

export const ProgramSession = z
  .object({
    id: z.uuid(),
    title: z.string(),
    description: z.string(),
    startsAt: DateTime,
    endsAt: DateTime,
    dateId: z.uuid().nullable(),
    trackId: z.uuid().nullable(),
    roomId: z.uuid().nullable(),
    capacity: z.int().nullable(),
    speakerIds: z.array(z.uuid()),
  })
  .openapi('ProgramSession');

export const Agenda = z
  .object({
    timezone: z.string(),
    tracks: z.array(Track),
    rooms: z.array(Room),
    days: z.array(agendaDay(ProgramSession, 'ProgramDay')),
  })
  .openapi('Agenda', { description: 'The organizer’s agenda with track and room ids and capacities.' });

export const Speaker = z
  .object({
    id: z.uuid(),
    name: z.string(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    bio: z.string().openapi({ description: 'Sanitized Markdown.' }),
    links: z.array(Link),
    image: Image.nullable().openapi({
      description:
        'The speaker’s photo (M1.4h); null when none. Public reads show it only when the event page is public.',
    }),
  })
  .openapi('Speaker');

export const SpeakerDetail = z
  .object({ speaker: Speaker, sessions: z.array(AgendaSession) })
  .openapi('SpeakerDetail', { description: 'A speaker and the sessions they speak in.' });

export const Exhibitor = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string(),
    boothLabel: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    image: Image.nullable().openapi({
      description:
        'The exhibitor’s logo (M1.4h); null when none. Public reads show it only when the event page is public.',
    }),
  })
  .openapi('Exhibitor');

const Sponsor = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string(),
    websiteUrl: z.string().nullable(),
    image: Image.nullable().openapi({
      description:
        'The sponsor’s logo (M1.4h); null when none. Public reads show it only when the event page is public.',
    }),
  })
  .openapi('Sponsor');

export const SponsorTier = z
  .object({
    id: z.uuid(),
    name: z.string(),
    position: z.int().openapi({ description: 'Display order (1 first).' }),
    sponsors: z.array(Sponsor),
  })
  .openapi('SponsorTier');

export const PublicSponsorTier = z
  .object({ name: z.string(), sponsors: z.array(Sponsor) })
  .openapi('PublicSponsorTier', { description: 'A sponsor package with its sponsors, in display order.' });
