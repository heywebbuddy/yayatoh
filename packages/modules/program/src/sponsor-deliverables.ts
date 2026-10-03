import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  dueAtFromDate,
  dueDateOf,
  isCalendarDate,
  isOverdue,
  overdueDeliverables,
} from './domain/sponsorship.ts';
import { sponsors } from './schema.ts';
import { DELIVERABLE_OWNERS, sponsorDeliverables } from './schema-sponsors.ts';
import { eventOf } from './shared.ts';
import { sponsorPrincipalTx } from './sponsor-allowances.ts';
import { type DeliverableDto, DeliverablesDto } from './sponsor-dto.ts';

/**
 * M5.4b sponsor deliverables: a checklist per sponsor of what is due from whom (the sponsor or
 * the organizer), by when (a date in the event's time zone; due by the end of that day) and who is
 * responsible. Overdue = open past its due date. The organizer manages them (`events:write`);
 * a sponsor contact ticks off only the sponsor's own ones (`portal:sponsor_contact`).
 */
export const MAX_DELIVERABLES_PER_SPONSOR = 100;

type Row = typeof sponsorDeliverables.$inferSelect;

export const toDeliverable = (d: Row, sponsorName: string, timeZone: string, now: Date): DeliverableDto => ({
  id: d.id,
  sponsorId: d.sponsorId,
  sponsorName,
  title: d.title,
  owner: d.owner as DeliverableDto['owner'],
  ownerName: d.ownerName,
  dueAt: d.dueAt,
  dueDate: dueDateOf(d.dueAt, timeZone),
  status: d.status as DeliverableDto['status'],
  completedAt: d.completedAt,
  completedBy: d.completedBy as DeliverableDto['completedBy'],
  overdue: isOverdue(d, now),
  fromPackage: d.fromPackage,
});

const DueDate = z.string().trim().refine(isCalendarDate, 'must be a date (YYYY-MM-DD)');

async function deliverableTx(tx: TenantTx, eventId: string, id: string) {
  const [row] = await tx
    .select()
    .from(sponsorDeliverables)
    .where(and(eq(sponsorDeliverables.id, id), eq(sponsorDeliverables.eventId, eventId)))
    .for('update');
  if (!row) throw new DomainError('not_found');
  return row;
}

export const addSponsorDeliverableCommand = tenantCommand({
  name: 'program.addSponsorDeliverable',
  input: z.object({
    eventId: z.uuid(),
    sponsorId: z.uuid(),
    title: z.string().trim().min(1).max(120),
    owner: z.enum(DELIVERABLE_OWNERS),
    ownerName: z
      .string()
      .trim()
      .max(80)
      .nullable()
      .default(null)
      .transform((v) => v || null),
    dueDate: DueDate,
  }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await eventOf(tx, input.eventId);
    const [s] = await tx
      .select({ id: sponsors.id })
      .from(sponsors)
      .where(and(eq(sponsors.id, input.sponsorId), eq(sponsors.eventId, input.eventId)))
      .for('update');
    if (!s)
      throw new DomainError('validation_failed', 'Unknown sponsor', {
        field: 'sponsorId',
        reason: 'unknown',
      });
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sponsorDeliverables)
      .where(eq(sponsorDeliverables.sponsorId, s.id));
    if (n >= MAX_DELIVERABLES_PER_SPONSOR)
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
    const [row] = await tx
      .insert(sponsorDeliverables)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        sponsorId: s.id,
        title: input.title,
        owner: input.owner,
        ownerName: input.ownerName,
        dueAt: dueAtFromDate(input.dueDate, event.timezone),
      })
      .returning({ id: sponsorDeliverables.id });
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input, r) => ({
    action: 'program.sponsor_deliverable.add',
    targetType: 'event',
    targetId: input.eventId,
    data: { sponsorId: input.sponsorId, deliverableId: r?.id, owner: input.owner },
  }),
});

/** Tick a deliverable off (done) or reopen it (the organizer, any owner). */
export const setSponsorDeliverableDoneCommand = tenantCommand({
  name: 'program.setSponsorDeliverableDone',
  input: z.object({ eventId: z.uuid(), deliverableId: z.uuid(), done: z.boolean() }),
  output: z.object({ status: z.enum(['open', 'done']) }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const d = await deliverableTx(tx, input.eventId, input.deliverableId);
    const status = input.done ? ('done' as const) : ('open' as const);
    await tx
      .update(sponsorDeliverables)
      .set(
        input.done
          ? {
              status,
              completedAt: d.completedAt ?? ctx.now,
              completedBy: d.completedBy ?? 'organizer',
              updatedAt: ctx.now,
            }
          : { status, completedAt: null, completedBy: null, updatedAt: ctx.now },
      )
      .where(eq(sponsorDeliverables.id, d.id));
    return { status };
  },
  audit: (input) => ({
    action: 'program.sponsor_deliverable.status',
    targetType: 'event',
    targetId: input.eventId,
    data: { deliverableId: input.deliverableId, done: input.done, by: 'organizer' },
  }),
});

export const deleteSponsorDeliverableCommand = tenantCommand({
  name: 'program.deleteSponsorDeliverable',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), deliverableId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sponsors',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const d = await deliverableTx(tx, input.eventId, input.deliverableId);
    await tx.delete(sponsorDeliverables).where(eq(sponsorDeliverables.id, d.id));
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.sponsor_deliverable.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { deliverableId: input.deliverableId },
  }),
});

/** The event's deliverables (due date order) and the overdue list, most overdue first. */
export const sponsorDeliverablesQuery = tenantQuery({
  name: 'program.sponsorDeliverables',
  input: z.object({ eventId: z.uuid() }),
  output: DeliverablesDto,
  entitlement: 'sponsors',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await eventOf(tx, input.eventId);
    const list = await tx
      .select({ id: sponsors.id, name: sponsors.name })
      .from(sponsors)
      .where(eq(sponsors.eventId, input.eventId))
      .orderBy(asc(sponsors.name), asc(sponsors.createdAt));
    const names = new Map(list.map((s) => [s.id, s.name]));
    const rows = await tx
      .select()
      .from(sponsorDeliverables)
      .where(eq(sponsorDeliverables.eventId, input.eventId))
      .orderBy(asc(sponsorDeliverables.dueAt), asc(sponsorDeliverables.title), asc(sponsorDeliverables.id));
    const all = rows.map((d) => toDeliverable(d, names.get(d.sponsorId) ?? '', event.timezone, ctx.now));
    return {
      timezone: event.timezone,
      sponsors: list,
      deliverables: all,
      overdue: overdueDeliverables(all, ctx.now),
    };
  },
});

/**
 * A sponsor contact ticks off (or reopens) one of their sponsor's own deliverables. The
 * organizer's ones, and every other sponsor's, look the same as unknown ids (`not_found`).
 */
export const portalSetDeliverableDoneCommand = tenantCommand({
  name: 'program.portalSetDeliverableDone',
  input: z.object({ deliverableId: z.uuid(), done: z.boolean() }),
  output: z.object({ status: z.enum(['open', 'done']), sponsorId: z.uuid() }),
  entitlement: 'sponsors',
  permission: 'portal:sponsor_contact',
  handler: async ({ input, ctx, tx }) => {
    const { principal, sponsor } = await sponsorPrincipalTx(tx, ctx);
    const d = await deliverableTx(tx, principal.eventId, input.deliverableId);
    if (d.sponsorId !== sponsor.id || d.owner !== 'sponsor') throw new DomainError('not_found');
    const status = input.done ? ('done' as const) : ('open' as const);
    await tx
      .update(sponsorDeliverables)
      .set(
        input.done
          ? {
              status,
              completedAt: d.completedAt ?? ctx.now,
              completedBy: d.completedBy ?? 'sponsor',
              updatedAt: ctx.now,
            }
          : { status, completedAt: null, completedBy: null, updatedAt: ctx.now },
      )
      .where(eq(sponsorDeliverables.id, d.id));
    return { status, sponsorId: sponsor.id };
  },
  audit: (input, r) => ({
    action: 'program.sponsor_deliverable.status',
    targetType: 'program_sponsor',
    targetId: r?.sponsorId ?? null,
    data: { deliverableId: input.deliverableId, done: input.done, by: 'sponsor' },
  }),
});
