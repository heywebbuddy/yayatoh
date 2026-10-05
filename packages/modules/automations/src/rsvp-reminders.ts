import type { TenantTx } from '@yayatoh/db';
import { awaitingPartiesTx, rsvpDeadlineTx } from '@yayatoh/guests';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { cancelRunsTx, enrollTx, eventAnchorsTx, rescheduleEventTx, runsOfParty } from './lifecycle.ts';
import { ACTION_STATUSES, journeyRuns, journeySteps, journeys, scheduledActions } from './schema.ts';

/**
 * RSVP deadline reminders (M4.1f) on the journey engine (M3.7a). The host switches them on from
 * the event's RSVP page with the days before the deadline (e.g. 14 and 3) and the channels; that
 * makes a system journey (`rsvp_sent`, template `rsvp_reminders`) whose steps wait from the
 * RSVP deadline. A party is enrolled when its invitation is sent (`guests.invitation_queued@1`),
 * or at once when reminders are switched on after it was sent. Its run is cancelled the moment it
 * answers (`guests.party_responded@1`), and the runner checks again when each step is due, so a
 * party that answered never gets a reminder. A new deadline re-plans the pending steps. The
 * subject is the party, never a crm contact, and the messages are transactional (P4-3); quiet
 * hours apply (the event's timezone). Guests permissions, not marketing ones.
 */

export const RSVP_TEMPLATE = 'rsvp_reminders';
export const MAX_REMINDER_DAYS = 90;
export const REMINDER_CHANNELS = ['email', 'sms'] as const;
/** The marker copy of a reminder step (its words come from guests, per party language). */
const STEP_COPY = 'rsvp_reminder';

async function currentJourneyTx(tx: TenantTx, eventId: string) {
  const [row] = await tx
    .select()
    .from(journeys)
    .where(and(eq(journeys.eventId, eventId), eq(journeys.trigger, 'rsvp_sent')))
    .orderBy(desc(journeys.createdAt), desc(journeys.id))
    .limit(1);
  return row ?? null;
}

async function enrollPartyTx(
  tx: TenantTx,
  orgId: string,
  journey: typeof journeys.$inferSelect,
  eventId: string,
  partyId: string,
  locale: string,
  at: Date,
  now: Date,
) {
  return enrollTx(tx, orgId, { journey, eventId, partyId, triggeredAt: at, locale }, now);
}

export const RsvpRemindersDto = z.object({
  enabled: z.boolean(),
  /** Days before the deadline, largest first. */
  days: z.array(z.int()),
  channels: z.array(z.enum(REMINDER_CHANNELS)),
  hasDeadline: z.boolean(),
  /** Reminder steps by state (pending, done, skipped, cancelled, failed), for the current set-up. */
  counts: z.record(z.enum(ACTION_STATUSES), z.int()),
});
export type RsvpRemindersDto = z.infer<typeof RsvpRemindersDto>;

async function remindersDtoTx(tx: TenantTx, eventId: string): Promise<RsvpRemindersDto> {
  const j = await currentJourneyTx(tx, eventId);
  const counts = Object.fromEntries(ACTION_STATUSES.map((s) => [s, 0])) as Record<
    (typeof ACTION_STATUSES)[number],
    number
  >;
  const hasDeadline = (await rsvpDeadlineTx(tx, eventId)) !== null;
  if (!j) return { enabled: false, days: [14, 3], channels: ['email'], hasDeadline, counts };
  const steps = await tx
    .select()
    .from(journeySteps)
    .where(eq(journeySteps.journeyId, j.id))
    .orderBy(asc(journeySteps.position));
  const rows = await tx
    .select({ status: scheduledActions.status })
    .from(scheduledActions)
    .where(eq(scheduledActions.journeyId, j.id));
  for (const r of rows) counts[r.status as keyof typeof counts] += 1;
  return {
    enabled: j.enabled,
    days: [...new Set(steps.map((s) => -s.offsetDays))].sort((a, b) => b - a),
    channels: REMINDER_CHANNELS.filter((c) => steps.some((s) => s.action === c)),
    hasDeadline,
    counts,
  };
}

/** The event's RSVP reminder set-up and how many reminders are waiting, sent or stopped. */
export const rsvpRemindersQuery = tenantQuery({
  name: 'automations.rsvpReminders',
  input: z.object({ eventId: z.uuid() }),
  output: RsvpRemindersDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => remindersDtoTx(tx, input.eventId),
});

/**
 * Switch RSVP reminders on (with these days before the deadline and channels) or off. Changing
 * them retires the current set-up (its pending reminders are cancelled, what was sent stays in
 * its history) and starts a new one, enrolling every party that was sent its invitation and
 * hasn't answered. Needs a deadline to switch on.
 */
export const setRsvpRemindersCommand = tenantCommand({
  name: 'automations.setRsvpReminders',
  input: z.object({
    eventId: z.uuid(),
    enabled: z.boolean(),
    days: z
      .array(z.int().min(1).max(MAX_REMINDER_DAYS))
      .max(5)
      .default([14, 3])
      .transform((d) => [...new Set(d)].sort((a, b) => b - a)),
    channels: z
      .array(z.enum(REMINDER_CHANNELS))
      .max(2)
      .default(['email'])
      .transform((c) => [...new Set(c)]),
  }),
  output: RsvpRemindersDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const anchors = await eventAnchorsTx(tx, input.eventId, null);
    if (!anchors) throw new DomainError('not_found', 'Event not found', { field: 'eventId' });
    if (input.enabled) {
      if (!anchors.rsvpDeadline)
        throw new DomainError('invalid_state', 'Set an RSVP deadline first', { reason: 'no_deadline' });
      if (input.days.length === 0)
        throw new DomainError('validation_failed', 'Choose at least one day', {
          field: 'days',
          reason: 'required',
        });
      if (input.channels.length === 0)
        throw new DomainError('validation_failed', 'Choose a channel', {
          field: 'channels',
          reason: 'required',
        });
    }
    const current = await currentJourneyTx(tx, input.eventId);
    if (current?.enabled) {
      const before = await remindersDtoTx(tx, input.eventId);
      const same =
        input.enabled &&
        before.days.join(',') === input.days.join(',') &&
        before.channels.join(',') === input.channels.join(',');
      if (same) return before;
      await tx
        .update(journeys)
        .set({ enabled: false, updatedAt: ctx.now })
        .where(eq(journeys.id, current.id));
      await cancelRunsTx(tx, eq(journeyRuns.journeyId, current.id), 'journey_disabled', ctx.now);
    }
    if (!input.enabled) return remindersDtoTx(tx, input.eventId);
    const userId = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    const [journey] = await tx
      .insert(journeys)
      .values({
        orgId,
        name: 'RSVP reminders',
        eventId: input.eventId,
        trigger: 'rsvp_sent',
        enabled: true,
        enabledAt: ctx.now,
        template: RSVP_TEMPLATE,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    if (!journey) throw new DomainError('internal');
    let position = 0;
    for (const d of input.days)
      for (const channel of input.channels)
        await tx.insert(journeySteps).values({
          orgId,
          journeyId: journey.id,
          position: position++,
          anchor: 'rsvp_deadline',
          offsetDays: -d,
          offsetMinutes: 0,
          atTime: null,
          action: channel,
          subject: STEP_COPY,
          body: STEP_COPY,
        });
    for (const p of await awaitingPartiesTx(tx, input.eventId))
      await enrollPartyTx(tx, orgId, journey, input.eventId, p.partyId, p.locale, p.sentAt, ctx.now);
    return remindersDtoTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'automations.rsvp_reminders.set',
    targetType: 'event',
    targetId: input.eventId,
    data: { enabled: input.enabled, days: input.days, channels: input.channels },
  }),
});

export const PartyReminderDto = z.object({
  id: z.uuid(),
  scheduledFor: z.date(),
  action: z.string(),
  status: z.enum(ACTION_STATUSES),
  outcome: z.string().nullable(),
});
export type PartyReminderDto = z.infer<typeof PartyReminderDto>;

/** A party's reminders (every set-up), in time order: when, channel, state and why. */
export const partyRemindersQuery = tenantQuery({
  name: 'automations.partyReminders',
  input: z.object({ eventId: z.uuid(), partyId: z.uuid() }),
  output: z.array(PartyReminderDto),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(scheduledActions)
      .where(and(eq(scheduledActions.eventId, input.eventId), eq(scheduledActions.partyId, input.partyId)))
      .orderBy(asc(scheduledActions.scheduledFor), asc(scheduledActions.position))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      scheduledFor: r.scheduledFor,
      action: r.action,
      status: r.status as PartyReminderDto['status'],
      outcome: r.outcome,
    }));
  },
});

const Queued = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  partyId: z.uuid().nullable(),
  kind: z.string(),
  locale: z.string(),
});
const PartyRef = z.object({ orgId: z.uuid(), eventId: z.uuid(), partyId: z.uuid() });
const EventRef = z.object({ orgId: z.uuid(), eventId: z.uuid() });

/**
 * The reminder journey's hooks: a sent invitation enrolls the party, an answer cancels its run,
 * a new deadline re-plans the pending steps. Never for `replayed` history.
 */
export function rsvpReminderHooks() {
  return defineSubscriber({
    name: 'automations.rsvp-reminders',
    events: ['guests.invitation_queued@1', 'guests.party_responded@1', 'guests.rsvp_deadline_set@1'],
    handle: async (tx, event) => {
      if (event.replayed) return;
      const now = new Date();
      if (event.type === 'guests.invitation_queued') {
        const p = Queued.parse(event.payload);
        if (p.kind !== 'invitation' || !p.partyId) return;
        const j = await currentJourneyTx(tx, p.eventId);
        if (!j?.enabled) return;
        const at = event.occurredAt ? new Date(event.occurredAt) : now;
        await enrollPartyTx(tx, p.orgId, j, p.eventId, p.partyId, p.locale, at, now);
        return;
      }
      if (event.type === 'guests.party_responded') {
        const p = PartyRef.parse(event.payload);
        await cancelRunsTx(tx, runsOfParty(p.eventId, p.partyId), 'responded', now);
        return;
      }
      const p = EventRef.parse(event.payload);
      await rescheduleEventTx(tx, p.eventId, now);
    },
  });
}
