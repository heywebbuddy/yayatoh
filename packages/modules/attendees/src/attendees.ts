import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AttendeeDto, attendeeSerializer } from './dto.ts';
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
  return out;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Labels are short free text: trimmed, inner whitespace collapsed, 1–40 characters. */
export const Label = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(40));
export const MAX_LABELS = 20;

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

function filterWhere(eventId: string, f: z.output<typeof AttendeeFilter>) {
  const q = f.search ? `%${escapeLike(f.search)}%` : null;
  return and(
    eq(attendees.eventId, eventId),
    q ? or(ilike(attendees.name, q), ilike(attendees.email, q)) : undefined,
    f.labels.length ? sql`${attendees.labels} && ${textArray(f.labels)}` : undefined,
    f.source ? eq(attendees.source, f.source) : undefined,
    f.status ? eq(attendees.status, f.status) : undefined,
  );
}

export const listAttendeesQuery = tenantQuery({
  name: 'attendees.listAttendees',
  input: AttendeeFilter.extend({
    eventId: z.uuid(),
    limit: z.int().min(1).max(500).default(200),
    offset: z.int().min(0).max(1_000_000).default(0),
  }),
  output: z.object({ items: z.array(AttendeeDto), total: z.int() }),
  entitlement: 'attendees',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const where = filterWhere(input.eventId, input);
    const rows = await tx
      .select()
      .from(attendees)
      .where(where)
      .orderBy(desc(attendees.createdAt), desc(attendees.id))
      .limit(input.limit)
      .offset(input.offset);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(attendees).where(where);
    return { items: rows.map((r) => attendeeSerializer.serialize(r)), total: count?.n ?? 0 };
  },
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
    const next = sql`(
      select coalesce(array_agg(distinct l order by l), '{}'::text[])
      from unnest(array_cat(${attendees.labels}, ${textArray(input.add)})) as l
      where not (l = any(${textArray(input.remove)}))
    )`;
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
      .returning({ id: attendees.id });
    if (rows.length !== ids.length) throw new DomainError('not_found', 'Attendee not found');
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
    const q = `%${escapeLike(input.q)}%`;
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
          ilike(attendees.name, q),
          ilike(attendees.email, q),
          input.ticketIds.length ? inArray(attendees.ticketId, input.ticketIds) : undefined,
        ),
      )
      .orderBy(desc(attendees.createdAt), desc(attendees.id))
      .limit(input.limit);
    return rows;
  },
});
