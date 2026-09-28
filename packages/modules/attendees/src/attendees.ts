import { KeysetAfter } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AttendeeDto, attendeeSerializer } from './dto.ts';
import { attendeePairsTx, emitAttendeesChangedTx } from './participation.ts';
import { ATTENDEE_SOURCES, ATTENDEE_STATUSES, attendees } from './schema.ts';

export interface NewAttendee {
  readonly eventId: string;
  readonly contactId: string;
  readonly source: (typeof ATTENDEE_SOURCES)[number];
  readonly ticketId?: string | null;
  readonly name: string;
  readonly email: string;
}

/** Create attendees inside the caller's transaction (ticket issue, import, comps). */
export async function createAttendeesTx(
  tx: TenantTx,
  ctx: Ctx,
  rows: readonly NewAttendee[],
): Promise<{ id: string; ticketId: string | null }[]> {
  if (rows.length === 0) return [];
  const orgId = requireOrg(ctx);
  const out = await tx
    .insert(attendees)
    .values(rows.map((r) => ({ orgId, ...r, ticketId: r.ticketId ?? null })))
    .returning({ id: attendees.id, ticketId: attendees.ticketId });
  if (out.length !== rows.length) throw new DomainError('internal');
  await emitAttendeesChangedTx(tx, ctx, rows);
  return out;
}

/**
 * A ticket changed hands (claim or transfer): its attendee becomes the new holder. Labels stay;
 * the person and their contact change.
 */
export async function reassignAttendeeTx(
  tx: TenantTx,
  ctx: Ctx,
  attendeeId: string,
  to: { contactId: string; name: string; email: string },
): Promise<void> {
  const before = await attendeePairsTx(tx, [attendeeId]);
  const rows = await tx
    .update(attendees)
    .set({ contactId: to.contactId, name: to.name, email: to.email, updatedAt: ctx.now })
    .where(eq(attendees.id, attendeeId))
    .returning({ id: attendees.id, eventId: attendees.eventId, contactId: attendees.contactId });
  if (rows.length === 0) throw new DomainError('not_found', 'Attendee not found');
  // Both people's participation changes: the ticket left one and reached the other.
  await emitAttendeesChangedTx(tx, ctx, [...before, ...rows]);
}

/** Tickets were voided (refund, cancellation): their attendees leave the list; records stay. */
export async function cancelAttendeesTx(
  tx: TenantTx,
  ctx: Ctx,
  attendeeIds: readonly string[],
): Promise<void> {
  if (attendeeIds.length === 0) return;
  const rows = await tx
    .update(attendees)
    .set({ status: 'cancelled', updatedAt: ctx.now })
    .where(inArray(attendees.id, [...attendeeIds]))
    .returning({ eventId: attendees.eventId, contactId: attendees.contactId });
  await emitAttendeesChangedTx(tx, ctx, rows);
}

/**
 * The active people of one event, by name (seating, M1.7d). Internal fields only: callers
 * serialize what they show.
 */
export async function eventAttendeesTx(tx: TenantTx, eventId: string) {
  return tx
    .select({
      id: attendees.id,
      name: attendees.name,
      email: attendees.email,
      source: attendees.source,
      ticketId: attendees.ticketId,
      labels: attendees.labels,
      contactId: attendees.contactId,
    })
    .from(attendees)
    .where(and(eq(attendees.eventId, eventId), eq(attendees.status, 'active')))
    .orderBy(attendees.name, attendees.id);
}

/** How a name is compared in exact lookups: trimmed, inner whitespace collapsed, lower case. */
export const normalizePersonName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Exact lookups among one event's active people (the public seat finder, M1.7e): by email
 * (case-insensitive) or by full name (case- and spacing-insensitive, never partial). Ids and
 * ticket ids only: callers never learn names or emails they didn't already have.
 */
export async function eventAttendeesMatchingTx(
  tx: TenantTx,
  eventId: string,
  by: { email: string } | { name: string },
): Promise<{ id: string; ticketId: string | null }[]> {
  const match =
    'email' in by
      ? sql`lower(btrim(${attendees.email})) = ${by.email.trim().toLowerCase()}`
      : sql`lower(regexp_replace(btrim(${attendees.name}), '\\s+', ' ', 'g')) = ${normalizePersonName(by.name)}`;
  return tx
    .select({ id: attendees.id, ticketId: attendees.ticketId })
    .from(attendees)
    .where(and(eq(attendees.eventId, eventId), eq(attendees.status, 'active'), match))
    .orderBy(attendees.createdAt, attendees.id)
    .limit(50);
}

/** Attendees by id, with their event and status (callers check both). */
export async function attendeesByIdsTx(tx: TenantTx, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({
      id: attendees.id,
      eventId: attendees.eventId,
      status: attendees.status,
      ticketId: attendees.ticketId,
      name: attendees.name,
    })
    .from(attendees)
    .where(inArray(attendees.id, [...ids]));
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Name or email contains the text (ILIKE, wildcards literal). The match runs in
 * `attendees.search_ids` (migration 0051): under row-level security the planner can't use the
 * trigram indexes for ILIKE, so that function applies the same ILIKE to the caller's own org and
 * returns ids; the rest of the query stays under RLS. Same rows as a plain ILIKE, served by the
 * indexes (M1.8f).
 */
const nameOrEmailContains = (text: string) =>
  sql`${attendees.id} in (select attendees.search_ids(${`%${escapeLike(text)}%`}))`;

/** Labels are short free text: trimmed, inner whitespace collapsed, 1–40 characters. */
export const Label = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(40));
export const MAX_LABELS = 20;

/** An attendee's labels after adding and removing (removal wins), sorted and deduplicated. */
export const nextLabels = (add: readonly string[], remove: readonly string[]) => sql`(
  select coalesce(array_agg(distinct l order by l), '{}'::text[])
  from unnest(array_cat(${attendees.labels}, ${textArray(add)})) as l
  where not (l = any(${textArray(remove)}))
)`;

/** A bound `text[]` literal: one parameter per element. */
const textArray = (values: readonly string[]) =>
  values.length
    ? sql`ARRAY[${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`
    : sql`'{}'::text[]`;

export const AttendeeFilter = z.object({
  search: z.string().trim().max(200).optional(),
  /** Attendees carrying any of these labels. */
  labels: z.array(Label).max(20).default([]),
  source: z.enum(ATTENDEE_SOURCES).optional(),
  status: z.enum(ATTENDEE_STATUSES).optional(),
});
export type AttendeeFilter = z.input<typeof AttendeeFilter>;

/**
 * Filters on data higher tiers own (ticket type, check-in, M1.8f), as ticket-id subqueries those
 * modules build over their own tables: attendees whose ticket is in each `ticketIn` subquery, and
 * in none of the `ticketNotIn` ones (people without a ticket count as "not in").
 */
export interface TicketFilterExtension {
  readonly ticketIn?: readonly SQL[];
  readonly ticketNotIn?: readonly SQL[];
}

export function filterWhere(
  eventId: string,
  f: z.output<typeof AttendeeFilter>,
  ext: TicketFilterExtension = {},
) {
  return and(
    eq(attendees.eventId, eventId),
    f.search ? nameOrEmailContains(f.search) : undefined,
    f.labels.length ? sql`${attendees.labels} && ${textArray(f.labels)}` : undefined,
    f.source ? eq(attendees.source, f.source) : undefined,
    f.status ? eq(attendees.status, f.status) : undefined,
    ...(ext.ticketIn ?? []).map((sub) => sql`${attendees.ticketId} in (${sub})`),
    ...(ext.ticketNotIn ?? []).map(
      (sub) => sql`(${attendees.ticketId} is null or ${attendees.ticketId} not in (${sub}))`,
    ),
  );
}

export const ListAttendeesInput = AttendeeFilter.extend({
  eventId: z.uuid(),
  limit: z.int().min(1).max(500).default(200),
  offset: z.int().min(0).max(1_000_000).default(0),
  /** Keyset position (newest first) for /v1 cursors; used instead of `offset`. */
  after: KeysetAfter.optional(),
});

export const AttendeeListDto = z.object({ items: z.array(AttendeeDto), total: z.int() });

/** One page of an event's attendees, newest first, with the filtered total. */
export async function listAttendeesTx(
  tx: TenantTx,
  input: z.output<typeof ListAttendeesInput>,
  ext: TicketFilterExtension = {},
): Promise<z.output<typeof AttendeeListDto>> {
  const where = filterWhere(input.eventId, input, ext);
  const createdMs = sql`date_trunc('milliseconds', ${attendees.createdAt})`;
  const rows = await tx
    .select()
    .from(attendees)
    .where(
      input.after
        ? and(
            where,
            sql`(${createdMs}, ${attendees.id}) < (${input.after.at.toISOString()}::timestamptz, ${input.after.id}::uuid)`,
          )
        : where,
    )
    .orderBy(desc(createdMs), desc(attendees.id))
    .limit(input.limit)
    .offset(input.offset);
  const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(attendees).where(where);
  return { items: rows.map((r) => attendeeSerializer.serialize(r)), total: count?.n ?? 0 };
}

export const listAttendeesQuery = tenantQuery({
  name: 'attendees.listAttendees',
  input: ListAttendeesInput,
  output: AttendeeListDto,
  entitlement: 'attendees',
  permission: 'attendees:read',
  handler: ({ input, tx }) => listAttendeesTx(tx, input),
});

export const getAttendeeQuery = tenantQuery({
  name: 'attendees.getAttendee',
  input: z.object({ eventId: z.uuid(), attendeeId: z.uuid() }),
  output: AttendeeDto,
  entitlement: 'attendees',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx
      .select()
      .from(attendees)
      .where(and(eq(attendees.eventId, input.eventId), eq(attendees.id, input.attendeeId)));
    if (!row) throw new DomainError('not_found', 'Attendee not found');
    return attendeeSerializer.serialize(row);
  },
});

/** Every label used at an event, with how many attendees carry it (for the filter chips). */
export const attendeeLabelsQuery = tenantQuery({
  name: 'attendees.labels',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(z.object({ label: z.string(), count: z.int() })),
  entitlement: 'attendees',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const rows = await tx.execute<{ label: string; count: number }>(sql`
      select l as label, count(*)::int as count
      from ${attendees}, unnest(${attendees.labels}) as l
      where ${attendees.eventId} = ${input.eventId}
      group by l
      order by count(*) desc, l
      limit 200`);
    return rows.map((r) => ({ label: r.label, count: r.count }));
  },
});

/**
 * Add and remove labels on up to 500 attendees of one event. Removal wins over addition; each
 * attendee keeps at most 20 labels (the whole change is refused otherwise).
 */
export const setAttendeeLabelsCommand = tenantCommand({
  name: 'attendees.setLabels',
  input: z
    .object({
      eventId: z.uuid(),
      attendeeIds: z.array(z.uuid()).min(1).max(500),
      add: z.array(Label).max(MAX_LABELS).default([]),
      remove: z.array(Label).max(MAX_LABELS).default([]),
    })
    .refine((v) => v.add.length + v.remove.length > 0, { message: 'Nothing to change' }),
  output: z.object({ updated: z.int() }),
  entitlement: 'attendees',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const ids = [...new Set(input.attendeeIds)];
    const next = nextLabels(input.add, input.remove);
    const over = await tx
      .select({ id: attendees.id })
      .from(attendees)
      .where(
        and(
          eq(attendees.eventId, input.eventId),
          inArray(attendees.id, ids),
          sql`cardinality(${next}) > ${MAX_LABELS}`,
        ),
      )
      .limit(1);
    if (over.length)
      throw new DomainError('validation_failed', `At most ${MAX_LABELS} labels per attendee`, {
        field: 'add',
      });
    const rows = await tx
      .update(attendees)
      .set({ labels: next, updatedAt: ctx.now })
      .where(and(eq(attendees.eventId, input.eventId), inArray(attendees.id, ids)))
      .returning({ id: attendees.id, eventId: attendees.eventId, contactId: attendees.contactId });
    if (rows.length !== ids.length) throw new DomainError('not_found', 'Attendee not found');
    await emitAttendeesChangedTx(tx, ctx, rows);
    return { updated: rows.length };
  },
  audit: (input, r) => ({
    action: 'attendees.labels',
    targetType: 'event',
    targetId: input.eventId,
    data: { count: r?.updated ?? 0, add: input.add, remove: input.remove },
  }),
});

export const AttendeeHitDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  email: z.string(),
  ticketId: z.uuid().nullable(),
});

/** Org-wide search (the command palette): by name or email, or by the tickets a code matched. */
export const searchAttendeesQuery = tenantQuery({
  name: 'attendees.search',
  input: z.object({
    q: z.string().trim().min(2).max(200),
    ticketIds: z.array(z.uuid()).max(50).default([]),
    limit: z.int().min(1).max(50).default(10),
  }),
  output: z.array(AttendeeHitDto),
  entitlement: 'attendees',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({
        id: attendees.id,
        eventId: attendees.eventId,
        name: attendees.name,
        email: attendees.email,
        ticketId: attendees.ticketId,
      })
      .from(attendees)
      .where(
        or(
          nameOrEmailContains(input.q),
          input.ticketIds.length ? inArray(attendees.ticketId, input.ticketIds) : undefined,
        ),
      )
      .orderBy(desc(attendees.createdAt), desc(attendees.id))
      .limit(input.limit);
    return rows;
  },
});
