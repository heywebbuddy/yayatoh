import { defineSerializer } from '@yayatoh/contracts';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { listTicketTypesQuery, ticketsForOrderTx } from '@yayatoh/ticketing';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { substitutionClosesAt } from './domain/approval.ts';
import {
  groupToken,
  liveGuestCountTx,
  orderIdFromGroupToken,
  registrantIdFromToken,
} from './registrant-records.ts';
import {
  admissionItems,
  DECISION_SOURCES,
  REGISTRANT_STATUSES,
  registrants,
  registrationTypes,
  typeItems,
} from './schema.ts';

export const QUEUE_PAGE = 50;
/** The queue's status filters, in the order the console shows them. */
export const QUEUE_STATUS_FILTERS = [
  'pending',
  'approved',
  'confirmed',
  'reserved',
  'denied',
  'cancelled',
  'all',
] as const;

export const QueueRowDto = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  status: z.enum(REGISTRANT_STATUSES),
  registrationTypeId: z.uuid(),
  typeName: z.string(),
  itemName: z.string(),
  company: z.string().nullable(),
  decisionSource: z.enum(DECISION_SOURCES).nullable(),
  /** A +1's host (their name). */
  hostName: z.string().nullable(),
  createdAt: z.date(),
});
export type QueueRowDto = z.infer<typeof QueueRowDto>;

export const QueueDto = z.object({
  rows: z.array(QueueRowDto),
  total: z.int(),
  /** Registrants per status (whatever the status filter), for the filter chips. */
  counts: z.record(z.string(), z.int()),
});
export type QueueDto = z.infer<typeof QueueDto>;
const queueSerializer = defineSerializer('registration.queue', QueueDto);

export const QueueInput = z.object({
  eventId: z.uuid(),
  status: z.enum([...REGISTRANT_STATUSES, 'all']).default('pending'),
  registrationTypeId: z.uuid().nullable().default(null),
  search: z.string().trim().max(120).default(''),
  page: z.int().min(0).max(10_000).default(0),
});

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The approval queue (console, M5.1c): registrants of the event by status (pending first by
 * default), type and a name/email search, oldest first, 50 per page, with counts per status.
 */
export const registrationQueueQuery = tenantQuery({
  name: 'registration.queue',
  input: QueueInput,
  output: QueueDto,
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const host = sql`(select h.name from registration.registrants h where h.id = ${registrants.hostRegistrantId})`;
    const scope = and(
      eq(registrants.eventId, input.eventId),
      input.registrationTypeId ? eq(registrants.registrationTypeId, input.registrationTypeId) : undefined,
      input.search
        ? or(ilike(registrants.name, like(input.search)), ilike(registrants.email, like(input.search)))
        : undefined,
    );
    const where = and(scope, input.status === 'all' ? undefined : eq(registrants.status, input.status));
    const rows = await tx
      .select({
        id: registrants.id,
        name: registrants.name,
        email: registrants.email,
        status: registrants.status,
        registrationTypeId: registrants.registrationTypeId,
        typeName: registrationTypes.name,
        itemName: admissionItems.name,
        company: registrants.company,
        decisionSource: registrants.decisionSource,
        hostName: sql<string | null>`${host}`,
        createdAt: registrants.createdAt,
      })
      .from(registrants)
      .innerJoin(registrationTypes, eq(registrationTypes.id, registrants.registrationTypeId))
      .innerJoin(admissionItems, eq(admissionItems.id, registrants.admissionItemId))
      .where(where)
      .orderBy(
        input.status === 'pending' ? asc(registrants.createdAt) : desc(registrants.createdAt),
        asc(registrants.id),
      )
      .limit(QUEUE_PAGE)
      .offset(input.page * QUEUE_PAGE);
    const counts = await tx
      .select({ status: registrants.status, n: sql<number>`count(*)::int` })
      .from(registrants)
      .where(scope)
      .groupBy(registrants.status);
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
    const total =
      input.status === 'all' ? counts.reduce((n, c) => n + c.n, 0) : (byStatus[input.status] ?? 0);
    return queueSerializer.serialize({
      rows: rows.map((r) => ({
        ...r,
        status: r.status as 'pending',
        decisionSource: r.decisionSource as 'open',
      })),
      total,
      counts: byStatus,
    });
  },
});

const PersonDto = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  status: z.enum(REGISTRANT_STATUSES),
});

export const RegistrantDetailDto = QueueRowDto.extend({
  jobTitle: z.string().nullable(),
  message: z.string().nullable(),
  addOns: z.array(z.string()),
  decisionReason: z.string().nullable(),
  decidedAt: z.date().nullable(),
  confirmedAt: z.date().nullable(),
  substitutions: z.int(),
  /** The registrant's ticket short code (door staff and the organizer only). */
  ticketShortCode: z.string().nullable(),
  /** Other registrants paid in the same order (a group), and this host's +1 guests. */
  group: z.array(PersonDto),
  guests: z.array(PersonDto),
  substitutionClosesAt: z.date(),
});
export type RegistrantDetailDto = z.infer<typeof RegistrantDetailDto>;
const detailSerializer = defineSerializer('registration.registrant', RegistrantDetailDto);

/** One registrant for the queue's detail drawer: the application answers and the decision trail. */
export const registrantDetailQuery = tenantQuery({
  name: 'registration.registrant',
  input: z.object({ eventId: z.uuid(), registrantId: z.uuid() }),
  output: RegistrantDetailDto,
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [r] = await tx.select().from(registrants).where(eq(registrants.id, input.registrantId));
    if (!r || r.eventId !== input.eventId) throw new DomainError('not_found', 'Registrant not found');
    const [type] = await tx
      .select()
      .from(registrationTypes)
      .where(eq(registrationTypes.id, r.registrationTypeId));
    const items = await tx
      .select({ id: admissionItems.id, name: admissionItems.name })
      .from(admissionItems)
      .where(inArray(admissionItems.id, [r.admissionItemId, ...r.addOnItemIds]));
    const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? '';
    const [hostRow] = r.hostRegistrantId
      ? await tx
          .select({ name: registrants.name })
          .from(registrants)
          .where(eq(registrants.id, r.hostRegistrantId))
      : [];
    const person = {
      id: registrants.id,
      name: registrants.name,
      email: registrants.email,
      status: registrants.status,
    };
    const group = r.orderId
      ? await tx
          .select(person)
          .from(registrants)
          .where(and(eq(registrants.orderId, r.orderId), sql`${registrants.id} <> ${r.id}`))
          .orderBy(asc(registrants.createdAt))
      : [];
    const guests = await tx
      .select(person)
      .from(registrants)
      .where(eq(registrants.hostRegistrantId, r.id))
      .orderBy(asc(registrants.createdAt));
    const ticket =
      r.orderId && r.ticketId
        ? (await ticketsForOrderTx(tx, r.orderId)).find((t) => t.id === r.ticketId)
        : undefined;
    const event = await findEventTx(tx, r.eventId);
    if (!type || !event) throw new DomainError('not_found');
    return detailSerializer.serialize({
      id: r.id,
      name: r.name,
      email: r.email,
      status: r.status as 'pending',
      registrationTypeId: r.registrationTypeId,
      typeName: type.name,
      itemName: nameOf(r.admissionItemId),
      company: r.company,
      decisionSource: r.decisionSource as 'open' | null,
      hostName: hostRow?.name ?? null,
      createdAt: r.createdAt,
      jobTitle: r.jobTitle,
      message: r.message,
      addOns: r.addOnItemIds.map(nameOf),
      decisionReason: r.decisionReason,
      decidedAt: r.decidedAt,
      confirmedAt: r.confirmedAt,
      substitutions: r.substitutions,
      ticketShortCode: ticket?.shortCode ?? null,
      group: group.map((g) => ({ ...g, status: g.status as 'pending' })),
      guests: guests.map((g) => ({ ...g, status: g.status as 'pending' })),
      substitutionClosesAt: substitutionClosesAt(event.startsAt, type.substitutionCutoffHours),
    });
  },
});

// ---------------------------------------------------------------------------------------------
// Public views (by signed link; allowlisted, the person's own data only).

const GuestTypeDto = z.object({
  id: z.uuid(),
  name: z.string(),
  items: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export const PublicRegistrantDto = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(REGISTRANT_STATUSES),
  typeName: z.string(),
  itemName: z.string(),
  /** The reason the organizer gave (denials and approvals), as emailed. */
  reason: z.string().nullable(),
  /** Paid order in progress (the pay step reuses it). */
  paying: z.boolean(),
  /** +1: the guest types this registrant may add, and how many more guests they may bring. */
  guestTypes: z.array(GuestTypeDto),
  guestsLeft: z.int(),
  guests: z.array(z.object({ name: z.string(), status: z.enum(REGISTRANT_STATUSES) })),
  /** Their order's group link (payer), when they paid for it. */
  groupToken: z.string().nullable(),
});
export type PublicRegistrantDto = z.infer<typeof PublicRegistrantDto>;
const publicRegistrantSerializer = defineSerializer('registration.publicRegistrant', PublicRegistrantDto);

async function guestTypesTx(tx: TenantTx, eventId: string) {
  const types = await tx
    .select()
    .from(registrationTypes)
    .where(
      and(
        eq(registrationTypes.eventId, eventId),
        eq(registrationTypes.kind, 'guest'),
        isNull(registrationTypes.archivedAt),
      ),
    )
    .orderBy(asc(registrationTypes.sortOrder));
  const out = [];
  for (const t of types) {
    const items = await tx
      .select({ id: admissionItems.id, name: admissionItems.name })
      .from(typeItems)
      .innerJoin(admissionItems, eq(admissionItems.id, typeItems.admissionItemId))
      .where(
        and(
          eq(typeItems.registrationTypeId, t.id),
          isNull(typeItems.archivedAt),
          isNull(admissionItems.archivedAt),
          eq(admissionItems.kind, 'admission'),
        ),
      )
      .orderBy(asc(admissionItems.sortOrder), asc(admissionItems.createdAt));
    if (items.length) out.push({ id: t.id, name: t.name, items: [...items], guestsPerHost: t.guestsPerHost });
  }
  return out;
}

/** A registrant's own page (public, by their link): status, reason, pay step and +1. */
export async function publicRegistrant(orgId: string, token: string): Promise<PublicRegistrantDto> {
  const id = registrantIdFromToken(token);
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'registration.public' } });
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select().from(registrants).where(eq(registrants.id, id));
    if (!r) throw new DomainError('not_found', 'This link is not valid');
    const [type] = await tx
      .select()
      .from(registrationTypes)
      .where(eq(registrationTypes.id, r.registrationTypeId));
    const [item] = await tx.select().from(admissionItems).where(eq(admissionItems.id, r.admissionItemId));
    const canHost = r.status === 'confirmed' && !r.hostRegistrantId && type?.kind === 'standard';
    const guestTypes = canHost ? await guestTypesTx(tx, r.eventId) : [];
    const allowance = Math.max(0, ...guestTypes.map((g) => g.guestsPerHost));
    const used = canHost ? await liveGuestCountTx(tx, r.id) : 0;
    const guests = await tx
      .select({ name: registrants.name, status: registrants.status })
      .from(registrants)
      .where(eq(registrants.hostRegistrantId, r.id))
      .orderBy(asc(registrants.createdAt));
    return publicRegistrantSerializer.serialize({
      id: r.id,
      name: r.name,
      status: r.status as 'pending',
      typeName: type?.name ?? '',
      itemName: item?.name ?? '',
      reason: r.status === 'denied' || r.status === 'approved' ? r.decisionReason : null,
      paying: r.status === 'approved' && r.orderId !== null,
      guestTypes: guestTypes.map(({ guestsPerHost: _g, ...g }) => g),
      guestsLeft: Math.max(0, allowance - used),
      guests: guests.map((g) => ({ ...g, status: g.status as 'pending' })),
      groupToken: r.orderId && !r.hostRegistrantId ? groupToken(r.orderId) : null,
    });
  });
}

export const PublicGroupDto = z.object({
  orderId: z.uuid(),
  /** Paid: the names can be replaced until each type's cut-off. */
  paid: z.boolean(),
  members: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      status: z.enum(REGISTRANT_STATUSES),
      typeName: z.string(),
      substitutionClosesAt: z.date(),
      canSubstitute: z.boolean(),
    }),
  ),
});
export type PublicGroupDto = z.infer<typeof PublicGroupDto>;
const publicGroupSerializer = defineSerializer('registration.publicGroup', PublicGroupDto);

/** A payer's group page (public, by the group link): the people they named, substitution. */
export async function publicGroup(orgId: string, token: string, now = new Date()): Promise<PublicGroupDto> {
  const orderId = orderIdFromGroupToken(token);
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'registration.public' } });
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: registrants.id,
        name: registrants.name,
        email: registrants.email,
        status: registrants.status,
        eventId: registrants.eventId,
        typeName: registrationTypes.name,
        cutoff: registrationTypes.substitutionCutoffHours,
      })
      .from(registrants)
      .innerJoin(registrationTypes, eq(registrationTypes.id, registrants.registrationTypeId))
      .where(eq(registrants.orderId, orderId))
      .orderBy(asc(registrants.createdAt), asc(registrants.id));
    if (rows.length === 0) throw new DomainError('not_found', 'This link is not valid');
    const event = await findEventTx(tx, rows[0]?.eventId as string);
    if (!event) throw new DomainError('not_found');
    return publicGroupSerializer.serialize({
      orderId,
      paid: rows.some((r) => r.status === 'confirmed'),
      members: rows.map((r) => {
        const closes = substitutionClosesAt(event.startsAt, r.cutoff);
        return {
          id: r.id,
          name: r.name,
          email: r.email,
          status: r.status as 'pending',
          typeName: r.typeName,
          substitutionClosesAt: closes,
          canSubstitute: r.status === 'confirmed' && now < closes,
        };
      }),
    });
  });
}

export const GroupOptionDto = z.object({
  registrationTypeId: z.uuid(),
  typeName: z.string(),
  admissionItemId: z.uuid(),
  itemName: z.string(),
  allInMinor: z.int(),
  currency: z.string(),
});
export type GroupOptionDto = z.infer<typeof GroupOptionDto>;
const groupOptionsSerializer = defineSerializer('registration.groupOptions', z.array(GroupOptionDto));

/**
 * What each person of a group may be registered as (public; allowlisted): the passes of the
 * event's open and email-domain types (the server checks each person's own address against a
 * domain rule; the domains never reach the page). Approval, +1 and code-only types are not sold
 * as groups.
 */
export async function publicGroupOptions(orgId: string, eventId: string): Promise<GroupOptionDto[]> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'registration.public' } });
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        registrationTypeId: registrationTypes.id,
        typeName: registrationTypes.name,
        admissionItemId: admissionItems.id,
        itemName: admissionItems.name,
        ticketTypeId: typeItems.ticketTypeId,
      })
      .from(typeItems)
      .innerJoin(registrationTypes, eq(registrationTypes.id, typeItems.registrationTypeId))
      .innerJoin(admissionItems, eq(admissionItems.id, typeItems.admissionItemId))
      .where(
        and(
          eq(typeItems.eventId, eventId),
          isNull(typeItems.archivedAt),
          isNull(registrationTypes.archivedAt),
          isNull(admissionItems.archivedAt),
          eq(admissionItems.kind, 'admission'),
          eq(registrationTypes.approval, 'none'),
          eq(registrationTypes.kind, 'standard'),
          inArray(registrationTypes.eligibility, ['open', 'email_domain']),
        ),
      )
      .orderBy(
        asc(registrationTypes.sortOrder),
        asc(registrationTypes.createdAt),
        asc(admissionItems.sortOrder),
        asc(admissionItems.createdAt),
      );
    const tickets = new Map(
      (await listTicketTypesQuery.handler({ input: { eventId }, ctx, tx })).map((t) => [t.id, t]),
    );
    return groupOptionsSerializer.serialize(
      rows.flatMap((r) => {
        const t = tickets.get(r.ticketTypeId);
        return t
          ? [
              {
                registrationTypeId: r.registrationTypeId,
                typeName: r.typeName,
                admissionItemId: r.admissionItemId,
                itemName: r.itemName,
                allInMinor: t.allInMinor,
                currency: t.currency,
              },
            ]
          : [];
      }),
    );
  });
}
