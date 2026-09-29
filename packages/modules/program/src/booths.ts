import { isUniqueViolation, type TenantTx, withTenant } from '@yayatoh/db';
import type { EventTarget } from '@yayatoh/events';
import { boothPlan } from '@yayatoh/floorplan';
import { createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { boothWarnings, nextPrimary, planAssignment } from './domain/exhibitors.ts';
import {
  BoothDto,
  BoothPlanDto,
  type PublicExhibitorMapDto,
  publicExhibitorMapSerializer,
} from './exhibitor-dto.ts';
import { exhibitorCategoriesTx, unlistedExhibitorIdsTx } from './exhibitor-portal.ts';
import { boothAssignments, booths, exhibitors } from './schema.ts';
import { eventOf } from './shared.ts';

export const MAX_BOOTHS_PER_EVENT = 500;

const BoothFields = z.object({
  number: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._/-]*$/u, 'letters, digits, spaces and . _ / -'),
  category: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .default(null)
    .transform((v) => v || null),
  /** Centimetres from the hall's top-left corner. */
  x: z.number().int().min(0).max(100_000),
  y: z.number().int().min(0).max(100_000),
  /** Width and depth in centimetres (0.5 m to 100 m). */
  width: z.number().int().min(50).max(10_000),
  height: z.number().int().min(50).max(10_000),
});

export function boothAssigned(
  eventId: string,
  boothId: string,
  exhibitorId: string,
  primary: boolean,
): DomainEvent {
  return {
    type: 'program.booth.assigned',
    version: 1,
    aggregateType: 'program_booth',
    aggregateId: boothId,
    payload: { eventId, boothId, exhibitorId, primary },
  };
}

/** Every booth of an event with who is at it, and the plan's warnings. */
export async function boothPlanTx(tx: TenantTx, eventId: string): Promise<BoothPlanDto> {
  const rows = await tx
    .select()
    .from(booths)
    .where(eq(booths.eventId, eventId))
    .orderBy(sql`lower(${booths.number})`, asc(booths.createdAt));
  const seats = await tx
    .select()
    .from(boothAssignments)
    .where(eq(boothAssignments.eventId, eventId))
    .orderBy(asc(boothAssignments.createdAt));
  const list = rows
    .map((b) =>
      BoothDto.parse({
        ...b,
        exhibitors: seats
          .filter((s) => s.boothId === b.id)
          .sort((a, c) => Number(c.isPrimary) - Number(a.isPrimary))
          .map((s) => ({ exhibitorId: s.exhibitorId, isPrimary: s.isPrimary })),
      }),
    )
    .sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
  return {
    booths: list,
    warnings: boothWarnings(list, seats, await exhibitorCategoriesTx(tx, eventId)),
  };
}

async function boothTx(tx: TenantTx, eventId: string, boothId: string, lock = false) {
  const q = tx
    .select()
    .from(booths)
    .where(and(eq(booths.id, boothId), eq(booths.eventId, eventId)));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError('not_found', 'Booth not found');
  return row;
}

export const boothPlanQuery = tenantQuery({
  name: 'program.boothPlan',
  input: z.object({ eventId: z.uuid() }),
  output: BoothPlanDto,
  entitlement: 'exhibitors',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOf(tx, input.eventId);
    return boothPlanTx(tx, input.eventId);
  },
});

/** Add a booth (no `boothId`) or change one: number (unique per event), category, size, position. */
export const saveBoothCommand = tenantCommand({
  name: 'program.saveBooth',
  input: BoothFields.extend({ eventId: z.uuid(), boothId: z.uuid().optional() }),
  output: BoothPlanDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { eventId, boothId, ...fields } = input;
    await eventOf(tx, eventId);
    try {
      if (boothId) {
        await boothTx(tx, eventId, boothId, true);
        await tx
          .update(booths)
          .set({ ...fields, updatedAt: ctx.now })
          .where(eq(booths.id, boothId));
      } else {
        const [n] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(booths)
          .where(eq(booths.eventId, eventId));
        if ((n?.n ?? 0) >= MAX_BOOTHS_PER_EVENT)
          throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
        await tx.insert(booths).values({ orgId: requireOrg(ctx), eventId, ...fields });
      }
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DomainError('conflict', 'Booth number in use', { field: 'number', reason: 'taken' });
      throw err;
    }
    return boothPlanTx(tx, eventId);
  },
  audit: (input) => ({
    action: input.boothId ? 'program.booth.update' : 'program.booth.create',
    targetType: 'event',
    targetId: input.eventId,
    data: { boothId: input.boothId ?? null, number: input.number },
  }),
});

export const deleteBoothCommand = tenantCommand({
  name: 'program.deleteBooth',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), boothId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    // Its assignments go with it (cascade); the exhibitors stay.
    const rows = await tx
      .delete(booths)
      .where(and(eq(booths.id, input.boothId), eq(booths.eventId, input.eventId)))
      .returning({ id: booths.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true };
  },
  audit: (input) => ({
    action: 'program.booth.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { boothId: input.boothId },
  }),
});

/**
 * Put an exhibitor at a booth (co-exhibitors allowed; one primary per booth, the first by
 * default). The booth row is locked so two assignments can't both become primary. Conflicts
 * (shared booth, several booths, category) come back as warnings.
 */
export const assignBoothCommand = tenantCommand({
  name: 'program.assignBooth',
  input: z.object({
    eventId: z.uuid(),
    boothId: z.uuid(),
    exhibitorId: z.uuid(),
    primary: z.boolean().default(false),
  }),
  output: BoothPlanDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await boothTx(tx, input.eventId, input.boothId, true);
    const [x] = await tx
      .select({ id: exhibitors.id })
      .from(exhibitors)
      .where(and(eq(exhibitors.id, input.exhibitorId), eq(exhibitors.eventId, input.eventId)));
    if (!x)
      throw new DomainError('validation_failed', 'Unknown exhibitor', { field: 'exhibitorId', reason: 'unknown' });
    const current = await tx.select().from(boothAssignments).where(eq(boothAssignments.boothId, input.boothId));
    const plan = planAssignment(current, input.exhibitorId, input.primary);
    if (plan.kind === 'already')
      throw new DomainError('conflict', 'Already at this booth', { field: 'exhibitorId', reason: 'already_assigned' });
    if (plan.demote)
      await tx
        .update(boothAssignments)
        .set({ isPrimary: false, updatedAt: ctx.now })
        .where(and(eq(boothAssignments.boothId, input.boothId), eq(boothAssignments.exhibitorId, plan.demote)));
    if (plan.existing)
      await tx
        .update(boothAssignments)
        .set({ isPrimary: plan.primary, updatedAt: ctx.now })
        .where(
          and(eq(boothAssignments.boothId, input.boothId), eq(boothAssignments.exhibitorId, input.exhibitorId)),
        );
    else
      await tx.insert(boothAssignments).values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        boothId: input.boothId,
        exhibitorId: input.exhibitorId,
        isPrimary: plan.primary,
      });
    emit(boothAssigned(input.eventId, input.boothId, input.exhibitorId, plan.primary));
    return boothPlanTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'program.booth.assign',
    targetType: 'event',
    targetId: input.eventId,
    data: { boothId: input.boothId, exhibitorId: input.exhibitorId, primary: input.primary },
  }),
});

/** Take an exhibitor off a booth; when it was primary, the longest-standing co-exhibitor takes over. */
export const unassignBoothCommand = tenantCommand({
  name: 'program.unassignBooth',
  input: z.object({ eventId: z.uuid(), boothId: z.uuid(), exhibitorId: z.uuid() }),
  output: BoothPlanDto,
  entitlement: 'exhibitors',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await boothTx(tx, input.eventId, input.boothId, true);
    const [gone] = await tx
      .delete(boothAssignments)
      .where(and(eq(boothAssignments.boothId, input.boothId), eq(boothAssignments.exhibitorId, input.exhibitorId)))
      .returning();
    if (!gone) throw new DomainError('not_found');
    const rest = await tx.select().from(boothAssignments).where(eq(boothAssignments.boothId, input.boothId));
    const next = nextPrimary(rest, gone.isPrimary);
    if (next)
      await tx
        .update(boothAssignments)
        .set({ isPrimary: true, updatedAt: ctx.now })
        .where(and(eq(boothAssignments.boothId, input.boothId), eq(boothAssignments.exhibitorId, next)));
    return boothPlanTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'program.booth.unassign',
    targetType: 'event',
    targetId: input.eventId,
    data: { boothId: input.boothId, exhibitorId: input.exhibitorId },
  }),
});

/**
 * The public exhibitor map of an event with a public page (callers resolve the target first, as
 * for `publicProgram`). Allowlist: booths and listed exhibitors only (see `PublicExhibitorMapDto`).
 * Null when the event has no booths.
 */
export async function publicExhibitorMap(target: EventTarget): Promise<PublicExhibitorMapDto | null> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const plan = await boothPlanTx(tx, target.eventId);
    if (plan.booths.length === 0) return null;
    const hidden = await unlistedExhibitorIdsTx(tx, target.eventId);
    const categories = await exhibitorCategoriesTx(tx, target.eventId);
    const rows = await tx
      .select({ id: exhibitors.id, name: exhibitors.name, description: exhibitors.description })
      .from(exhibitors)
      .where(eq(exhibitors.eventId, target.eventId))
      .orderBy(asc(exhibitors.name), asc(exhibitors.createdAt));
    const shown = rows.filter((x) => !hidden.has(x.id));
    const ids = new Set(shown.map((x) => x.id));
    const doc = boothPlan(plan.booths);
    return publicExhibitorMapSerializer.serialize({
      width: doc.width,
      height: doc.height,
      booths: plan.booths.map((b) => ({
        id: b.id,
        number: b.number,
        category: b.category,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        exhibitorIds: b.exhibitors.map((e) => e.exhibitorId).filter((id) => ids.has(id)),
      })),
      exhibitors: shown.map((x) => ({
        id: x.id,
        name: x.name,
        description: x.description,
        categories: categories.get(x.id) ?? [],
        boothNumbers: plan.booths
          .filter((b) => b.exhibitors.some((e) => e.exhibitorId === x.id))
          .map((b) => b.number),
      })),
    });
  });
}
