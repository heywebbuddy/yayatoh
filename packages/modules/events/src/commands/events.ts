import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { assertNotPausedTx, hasAcceptedTermsTx } from '@yayatoh/tenancy';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { EVENT_TRANSITIONS, type EventTransition, eventLifecycle, slugify } from '../domain/lifecycle.ts';
import { CreateEventInput, EventDto, EventRoleDto, UpdateEventInput } from '../dto.ts';
import { EVENT_ROLES, eventRoleAssignments, events } from '../schema.ts';
import { ensureAutoShortLinkTx } from './short-links.ts';

const PAST_TENSE: Record<EventTransition, string> = {
  publish: 'published',
  unpublish: 'unpublished',
  postpone: 'postponed',
  reschedule: 'rescheduled',
  cancel: 'cancelled',
  complete: 'completed',
  archive: 'archived',
};

async function findEvent(tx: TenantTx, eventId: string) {
  const [row] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!row) throw new DomainError('not_found');
  return row;
}

export const createEventCommand = tenantCommand({
  name: 'events.createEvent',
  input: CreateEventInput,
  output: EventDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const slug = input.slug ?? slugify(input.name);
    try {
      const [row] = await tx
        .insert(events)
        .values({ ...input, slug, orgId })
        .returning();
      if (!row) throw new DomainError('internal');
      // M1.4d: every event gets its automatic `/e/{code}` short link.
      await ensureAutoShortLinkTx(tx, orgId, row.id);
      emit({
        type: 'event.created',
        version: 1,
        aggregateType: 'event',
        aggregateId: row.id,
        payload: { orgId, eventId: row.id, slug: row.slug, profile: row.profile },
      });
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'events_slug_key')) {
        throw new DomainError('conflict', 'This event address is already taken', { field: 'slug' });
      }
      throw err;
    }
  },
  audit: (_i, row) => ({ action: 'event.create', targetType: 'event', targetId: row.id }),
});

export const updateEventCommand = tenantCommand({
  name: 'events.updateEvent',
  input: UpdateEventInput,
  output: EventDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const { eventId, ...fields } = input;
    const current = await findEvent(tx, eventId);
    if (fields.slug && fields.slug !== current.slug && current.publishedAt) {
      throw new DomainError('invalid_state', 'The address of a published event cannot change', {
        field: 'slug',
      });
    }
    const startsAt = fields.startsAt ?? current.startsAt;
    const endsAt = fields.endsAt ?? current.endsAt;
    if (endsAt <= startsAt) throw new DomainError('validation_failed', 'endsAt must be after startsAt');
    try {
      const [row] = await tx
        .update(events)
        .set({ ...fields, updatedAt: ctx.now })
        .where(eq(events.id, eventId))
        .returning();
      if (!row) throw new DomainError('not_found');
      emit({
        type: 'event.updated',
        version: 1,
        aggregateType: 'event',
        aggregateId: row.id,
        payload: { orgId: row.orgId, eventId: row.id, fields: Object.keys(fields) },
      });
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'events_slug_key')) {
        throw new DomainError('conflict', 'This event address is already taken', { field: 'slug' });
      }
      throw err;
    }
  },
  audit: (input) => ({
    action: 'event.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { fields: Object.keys(input).filter((k) => k !== 'eventId') },
  }),
});

/**
 * One command for every lifecycle transition. The UPDATE only matches rows in an allowed
 * `from` state, so concurrent transitions cannot both win.
 */
export const transitionEventCommand = tenantCommand({
  name: 'events.transitionEvent',
  input: z.object({
    eventId: z.uuid(),
    transition: z.enum(EVENT_TRANSITIONS as [EventTransition, ...EventTransition[]]),
  }),
  output: EventDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findEvent(tx, input.eventId);
    if (input.transition === 'publish') await assertNotPausedTx(tx, 'pause_publishing');
    // Going live needs the platform's current terms accepted (click-wrap, M1.3).
    if (input.transition === 'publish' && !(await hasAcceptedTermsTx(tx)))
      throw new DomainError('invalid_state', 'Accept the terms of service before publishing', {
        reason: 'terms_not_accepted',
      });
    const to = eventLifecycle.next(
      current.status as (typeof eventLifecycle.states)[number],
      input.transition,
    );
    const [row] = await tx
      .update(events)
      .set({
        status: to,
        updatedAt: ctx.now,
        ...(input.transition === 'publish' && !current.publishedAt ? { publishedAt: ctx.now } : {}),
      })
      .where(
        and(eq(events.id, input.eventId), inArray(events.status, [...eventLifecycle.from(input.transition)])),
      )
      .returning();
    if (!row) throw new DomainError('conflict', 'The event changed meanwhile; reload and try again');
    emit({
      type: `event.${PAST_TENSE[input.transition]}`,
      version: 1,
      aggregateType: 'event',
      aggregateId: row.id,
      payload: { orgId: row.orgId, eventId: row.id, from: current.status, to },
    });
    return row;
  },
  audit: (input, row) => ({
    action: `event.${input.transition}`,
    targetType: 'event',
    targetId: row.id,
    data: { to: row.status },
  }),
});

export const assignEventRoleCommand = tenantCommand({
  name: 'events.assignEventRole',
  input: z.object({
    eventId: z.uuid(),
    userId: z.uuid(),
    role: z.enum(EVENT_ROLES),
    expiresAt: z.coerce.date().nullable().default(null),
  }),
  output: EventRoleDto,
  entitlement: 'core',
  permission: 'members:manage',
  handler: async ({ input, ctx, tx }) => {
    await findEvent(tx, input.eventId);
    const [row] = await tx
      .insert(eventRoleAssignments)
      .values({ ...input, orgId: requireOrg(ctx) })
      .onConflictDoUpdate({
        target: [
          eventRoleAssignments.orgId,
          eventRoleAssignments.eventId,
          eventRoleAssignments.userId,
          eventRoleAssignments.role,
        ],
        set: { expiresAt: input.expiresAt, updatedAt: ctx.now },
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input) => ({
    action: 'event.role.assign',
    targetType: 'event',
    targetId: input.eventId,
    data: { userId: input.userId, role: input.role },
  }),
});
