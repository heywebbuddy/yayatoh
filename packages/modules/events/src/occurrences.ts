import { defineSerializer } from '@yayatoh/contracts';
import { isUniqueViolation, type TenantTx, withoutTenant } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, count, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { expandRecurrence, MAX_OCCURRENCES, RECURRENCE_FREQS, retimeLocal } from './domain/recurrence.ts';
import { events, OCCURRENCE_STATUSES, occurrences } from './schema.ts';

export const OccurrenceDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  startsAt: z.date(),
  endsAt: z.date(),
  capacity: z.int().nullable(),
  status: z.enum(OCCURRENCE_STATUSES),
});
export type OccurrenceDto = z.infer<typeof OccurrenceDto>;

/** What the public event page may show about a date: no capacity numbers, only "sold out". */
export const PublicOccurrenceDto = z.object({
  id: z.uuid(),
  startsAt: z.date(),
  endsAt: z.date(),
  status: z.enum(OCCURRENCE_STATUSES),
  soldOut: z.boolean(),
});
export type PublicOccurrenceDto = z.infer<typeof PublicOccurrenceDto>;
export const publicOccurrenceSerializer = defineSerializer('events.publicOccurrence', PublicOccurrenceDto);

const Capacity = z.int().min(1).max(1_000_000).nullable();

export const RecurrenceRuleInput = z.object({
  startDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.int().min(1).max(52).default(1),
  byWeekday: z.array(z.int().min(1).max(7)).max(7).default([]),
  byMonthDay: z.int().min(1).max(31).nullable().default(null),
  until: z.string().nullable().default(null),
  count: z.int().min(1).nullable().default(null),
});
export type RecurrenceRuleInput = z.input<typeof RecurrenceRuleInput>;

const toDto = (r: typeof occurrences.$inferSelect): OccurrenceDto => ({
  id: r.id,
  eventId: r.eventId,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  capacity: r.capacity,
  status: r.status as OccurrenceDto['status'],
});

async function eventFor(tx: TenantTx, eventId: string, forWrite: boolean) {
  const q = tx.select().from(events).where(eq(events.id, eventId));
  // Writers lock the event: concurrent date changes then count and sync one after the other.
  const [ev] = await (forWrite ? q.for('update') : q);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  if (forWrite && ['cancelled', 'completed', 'archived'].includes(ev.status))
    throw new DomainError('invalid_state', 'The dates of a finished event cannot change', {
      reason: 'event_finished',
    });
  return ev;
}

async function occurrenceRow(tx: TenantTx, occurrenceId: string, lock = false) {
  const q = tx.select().from(occurrences).where(eq(occurrences.id, occurrenceId));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError('not_found', 'Date not found');
  return row;
}

async function scheduledCount(tx: TenantTx, eventId: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(occurrences)
    .where(and(eq(occurrences.eventId, eventId), eq(occurrences.status, 'scheduled')));
  return r?.n ?? 0;
}

/**
 * Keep the event's own times equal to the span of its scheduled dates, so lists, the public page
 * and check-in windows stay right. With every date cancelled the event keeps its last span.
 */
export async function syncEventSpanTx(tx: TenantTx, eventId: string, now: Date): Promise<void> {
  await tx.execute(sql`
    update events.events e set starts_at = s.min_start, ends_at = s.max_end, updated_at = ${now.toISOString()}::timestamptz
    from (
      select min(starts_at) as min_start, max(ends_at) as max_end
      from events.occurrences where event_id = ${eventId} and status = 'scheduled'
    ) s
    where e.id = ${eventId} and s.min_start is not null
      and (e.starts_at <> s.min_start or e.ends_at <> s.max_end)`);
}

async function insertDates(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  dates: readonly { startsAt: Date; endsAt: Date; capacity: number | null }[],
) {
  const existing = await scheduledCount(tx, eventId);
  if (existing + dates.length > MAX_OCCURRENCES)
    throw new DomainError('validation_failed', `An event can have at most ${MAX_OCCURRENCES} dates`, {
      reason: 'too_many',
      field: 'count',
      existing,
    });
  for (const d of dates)
    if (d.endsAt <= d.startsAt)
      throw new DomainError('validation_failed', 'The end must be after the start', {
        reason: 'end_before_start',
        field: 'endsAt',
      });
  try {
    return await tx
      .insert(occurrences)
      .values(dates.map((d) => ({ orgId, eventId, ...d })))
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, 'occurrences_org_event_starts_key'))
      throw new DomainError('conflict', 'The event already has a date starting then', {
        reason: 'date_exists',
        field: 'startsAt',
      });
    throw err;
  }
}

/** Add one or more dates (each with its own start and end). */
export const addOccurrencesCommand = tenantCommand({
  name: 'events.addOccurrences',
  input: z.object({
    eventId: z.uuid(),
    dates: z
      .array(
        z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date(), capacity: Capacity.default(null) }),
      )
      .min(1)
      .max(MAX_OCCURRENCES),
  }),
  output: z.array(OccurrenceDto),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await eventFor(tx, input.eventId, true);
    const rows = await insertDates(tx, orgId, input.eventId, input.dates);
    await syncEventSpanTx(tx, input.eventId, ctx.now);
    emit({
      type: 'event.occurrences_added',
      version: 1,
      aggregateType: 'event',
      aggregateId: input.eventId,
      payload: { orgId, eventId: input.eventId, occurrenceIds: rows.map((r) => r.id) },
    });
    return rows.map(toDto);
  },
  audit: (input, rows) => ({
    action: 'event.occurrences.add',
    targetType: 'event',
    targetId: input.eventId,
    data: { count: rows?.length ?? 0 },
  }),
});

/** Expand a recurrence rule in the event's timezone (preview and save share this). */
async function expandFor(tx: TenantTx, eventId: string, rule: z.output<typeof RecurrenceRuleInput>) {
  const ev = await eventFor(tx, eventId, false);
  const existing = await scheduledCount(tx, eventId);
  const dates = expandRecurrence(rule, ev.timezone, MAX_OCCURRENCES);
  return { ev, existing, dates };
}

export const PreviewDto = z.object({
  timezone: z.string(),
  dates: z.array(z.object({ localDate: z.string(), startsAt: z.date(), endsAt: z.date() })),
  existing: z.int(),
  /** Adding these would pass the per-event limit. */
  overLimit: z.boolean(),
  max: z.int(),
});

/** Preview the dates a rule would add, before saving. */
export const previewOccurrencesQuery = tenantQuery({
  name: 'events.previewOccurrences',
  input: z.object({ eventId: z.uuid(), rule: RecurrenceRuleInput }),
  output: PreviewDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const { ev, existing, dates } = await expandFor(tx, input.eventId, input.rule);
    return {
      timezone: ev.timezone,
      dates,
      existing,
      overLimit: existing + dates.length > MAX_OCCURRENCES,
      max: MAX_OCCURRENCES,
    };
  },
});

/** Add every date a recurrence rule produces (wall-clock times in the event's timezone). */
export const addRecurringOccurrencesCommand = tenantCommand({
  name: 'events.addRecurringOccurrences',
  input: z.object({ eventId: z.uuid(), rule: RecurrenceRuleInput, capacity: Capacity.default(null) }),
  output: z.object({ created: z.int() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await eventFor(tx, input.eventId, true);
    const { dates } = await expandFor(tx, input.eventId, input.rule);
    const rows = await insertDates(
      tx,
      orgId,
      input.eventId,
      dates.map((d) => ({ startsAt: d.startsAt, endsAt: d.endsAt, capacity: input.capacity })),
    );
    await syncEventSpanTx(tx, input.eventId, ctx.now);
    emit({
      type: 'event.occurrences_added',
      version: 1,
      aggregateType: 'event',
      aggregateId: input.eventId,
      payload: { orgId, eventId: input.eventId, occurrenceIds: rows.map((r) => r.id) },
    });
    return { created: rows.length };
  },
  audit: (input, r) => ({
    action: 'event.occurrences.add_recurring',
    targetType: 'event',
    targetId: input.eventId,
    data: { freq: input.rule.freq, created: r?.created ?? 0 },
  }),
});

/**
 * Change one date (new start/end instants), or this date and every later scheduled date of the
 * event (new wall-clock times of day; each keeps its local day, so DST never shifts them).
 */
export const updateOccurrenceCommand = tenantCommand({
  name: 'events.updateOccurrence',
  input: z.discriminatedUnion('scope', [
    z.object({
      scope: z.literal('one'),
      occurrenceId: z.uuid(),
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date(),
      capacity: Capacity.optional(),
    }),
    z.object({
      scope: z.literal('following'),
      occurrenceId: z.uuid(),
      startTime: z.string(),
      endTime: z.string(),
      capacity: Capacity.optional(),
    }),
  ]),
  output: z.object({ updated: z.int() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const target = await occurrenceRow(tx, input.occurrenceId, true);
    const ev = await eventFor(tx, target.eventId, true);
    if (target.status !== 'scheduled')
      throw new DomainError('invalid_state', 'A cancelled date cannot be changed', { reason: 'cancelled' });
    const rows =
      input.scope === 'one'
        ? [target]
        : await tx
            .select()
            .from(occurrences)
            .where(
              and(
                eq(occurrences.eventId, target.eventId),
                eq(occurrences.status, 'scheduled'),
                gte(occurrences.startsAt, target.startsAt),
              ),
            )
            .orderBy(asc(occurrences.startsAt))
            .for('update');
    try {
      for (const r of rows) {
        const times =
          input.scope === 'one'
            ? { startsAt: input.startsAt, endsAt: input.endsAt }
            : retimeLocal(r.startsAt, ev.timezone, input.startTime, input.endTime);
        if (times.endsAt <= times.startsAt)
          throw new DomainError('validation_failed', 'The end must be after the start', {
            reason: 'end_before_start',
            field: 'endsAt',
          });
        await tx
          .update(occurrences)
          .set({
            ...times,
            ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
            updatedAt: ctx.now,
          })
          .where(eq(occurrences.id, r.id));
      }
    } catch (err) {
      if (isUniqueViolation(err, 'occurrences_org_event_starts_key'))
        throw new DomainError('conflict', 'The event already has a date starting then', {
          reason: 'date_exists',
          field: 'startsAt',
        });
      throw err;
    }
    await syncEventSpanTx(tx, target.eventId, ctx.now);
    emit({
      type: 'event.occurrences_updated',
      version: 1,
      aggregateType: 'event',
      aggregateId: target.eventId,
      payload: {
        orgId: target.orgId,
        eventId: target.eventId,
        scope: input.scope,
        occurrenceIds: rows.map((r) => r.id),
      },
    });
    return { updated: rows.length };
  },
  audit: (input, r) => ({
    action: 'event.occurrence.update',
    targetType: 'occurrence',
    targetId: input.occurrenceId,
    data: { scope: input.scope, updated: r?.updated ?? 0 },
  }),
});

/**
 * Cancel one date. Its tickets stay valid records (refunds are the organizer's decision, from the
 * orders list); they no longer admit, and the date stops selling.
 */
export const cancelOccurrenceCommand = tenantCommand({
  name: 'events.cancelOccurrence',
  input: z.object({ occurrenceId: z.uuid() }),
  output: OccurrenceDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await occurrenceRow(tx, input.occurrenceId, true);
    await eventFor(tx, current.eventId, true);
    const [row] = await tx
      .update(occurrences)
      .set({ status: 'cancelled', cancelledAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(occurrences.id, input.occurrenceId), eq(occurrences.status, 'scheduled')))
      .returning();
    if (!row)
      throw new DomainError('invalid_state', 'This date is already cancelled', { reason: 'cancelled' });
    await syncEventSpanTx(tx, row.eventId, ctx.now);
    emit({
      type: 'event.occurrence_cancelled',
      version: 1,
      aggregateType: 'event',
      aggregateId: row.eventId,
      payload: { orgId: row.orgId, eventId: row.eventId, occurrenceId: row.id, startsAt: row.startsAt },
    });
    return toDto(row);
  },
  audit: (input) => ({
    action: 'event.occurrence.cancel',
    targetType: 'occurrence',
    targetId: input.occurrenceId,
  }),
});

export const listOccurrencesQuery = tenantQuery({
  name: 'events.listOccurrences',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(OccurrenceDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    (
      await tx
        .select()
        .from(occurrences)
        .where(eq(occurrences.eventId, input.eventId))
        .orderBy(asc(occurrences.startsAt))
    ).map(toDto),
});

/** For higher tiers inside their tenant transaction: an event's dates, in order. */
export async function occurrencesOfEventTx(tx: TenantTx, eventId: string): Promise<OccurrenceDto[]> {
  return (
    await tx
      .select()
      .from(occurrences)
      .where(eq(occurrences.eventId, eventId))
      .orderBy(asc(occurrences.startsAt))
  ).map(toDto);
}

/** One date, or null. `lock` takes a row lock (checkout serializes a date's capacity on it). */
export async function findOccurrenceTx(
  tx: TenantTx,
  occurrenceId: string,
  lock = false,
): Promise<OccurrenceDto | null> {
  const q = tx.select().from(occurrences).where(eq(occurrences.id, occurrenceId));
  const [row] = await (lock ? q.for('update') : q);
  return row ? toDto(row) : null;
}

/** Whether the event has any dates of its own (multi-date). */
export async function hasOccurrencesTx(tx: TenantTx, eventId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: occurrences.id })
    .from(occurrences)
    .where(eq(occurrences.eventId, eventId))
    .limit(1);
  return Boolean(row);
}

/**
 * The public event page's dates (cross-tenant by slug, SECURITY DEFINER `events.public_occurrences`):
 * only for events the public page shows; each date says whether it is sold out, never its numbers.
 */
export async function publicOccurrences(slug: string): Promise<PublicOccurrenceDto[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ id: string; starts_at: string; ends_at: string; status: string; sold_out: boolean }>(
      sql`select * from events.public_occurrences(${slug})`,
    ),
  );
  return rows.map((r) =>
    publicOccurrenceSerializer.serialize({
      id: r.id,
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      status: r.status,
      soldOut: r.sold_out,
    }),
  );
}
