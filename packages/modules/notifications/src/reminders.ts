import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { decryptParams, encryptParams } from './notifier.ts';
import { planReminder } from './reminder-time.ts';
import { MESSAGE_CHANNELS, messages } from './schema.ts';

/** Where a reminder's event (or date) stands now. `null`: leave the reminder as it is. */
export interface ReminderTarget {
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly eventName: string;
  readonly venue: string;
  readonly cancelled?: boolean;
  readonly postponed?: boolean;
}

export interface RescheduleResult {
  rescheduled: number;
  canceled: number;
  unchanged: number;
}

/**
 * Bring an event's queued reminders in line with its current start time (M1.10d). Each reminder is
 * re-planned from the event's (or its date's) start as it is now, never from the change that
 * triggered it, so replays, duplicates and out-of-order events all land on the same result: the
 * new send time, the new time in the email (params, re-encrypted), or `canceled` when the event
 * started or was cancelled (parked as `event_postponed` while it is postponed, and queued again
 * once it is rescheduled). Sent reminders are history and are never touched.
 */
export async function rescheduleRemindersTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  targetOf: (occurrenceId: string | null) => ReminderTarget | null,
  now: Date,
): Promise<RescheduleResult> {
  const result: RescheduleResult = { rescheduled: 0, canceled: 0, unchanged: 0 };
  const rows = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.eventId, eventId),
        eq(messages.kind, 'events.reminder'),
        or(
          eq(messages.status, 'queued'),
          // Parked while the event was postponed: rescheduling brings it back.
          and(eq(messages.status, 'canceled'), eq(messages.reason, 'event_postponed')),
        ),
      ),
    )
    .orderBy(asc(messages.id))
    .for('update');
  for (const row of rows) {
    const target = targetOf(row.occurrenceId);
    if (!target) {
      result.unchanged += 1;
      continue;
    }
    const plan = planReminder(target, now);
    if ('cancel' in plan) {
      if (row.status === 'canceled' && row.reason === plan.cancel) {
        result.unchanged += 1;
        continue;
      }
      await tx
        .update(messages)
        .set({ status: 'canceled', reason: plan.cancel, updatedAt: now })
        .where(eq(messages.id, row.id));
      result.canceled += 1;
      continue;
    }
    const params = await decryptParams(orgId, row.paramsCiphertext);
    const next = {
      ...params,
      startsAt: target.startsAt.toISOString(),
      timeZone: target.timeZone,
      eventName: target.eventName,
      venue: target.venue,
    };
    const same =
      row.status === 'queued' &&
      // Already due and still due (a replay a moment later): not a change.
      (row.sendAfter.getTime() === plan.sendAfter.getTime() ||
        (plan.sendAfter.getTime() <= now.getTime() && row.sendAfter.getTime() <= now.getTime())) &&
      row.timeZone === target.timeZone &&
      (['startsAt', 'timeZone', 'eventName', 'venue'] as const).every((k) => params[k] === next[k]);
    if (same) {
      result.unchanged += 1;
      continue;
    }
    await tx
      .update(messages)
      .set({
        status: 'queued',
        sendAfter: plan.sendAfter,
        timeZone: target.timeZone,
        paramsCiphertext: await encryptParams(orgId, next),
        reason: null,
        updatedAt: now,
      })
      .where(eq(messages.id, row.id));
    result.rescheduled += 1;
  }
  return result;
}

/**
 * Cancel queued messages by their dedupe keys (e.g. a survey reminder once the person answered,
 * M3.9a), with a reason for the message log. Sent, failed and suppressed messages are history
 * and never change; a key with no queued message is skipped. Returns how many were canceled.
 */
export async function cancelQueuedTx(
  tx: TenantTx,
  dedupeKeys: readonly string[],
  reason: string,
  now: Date,
): Promise<number> {
  if (dedupeKeys.length === 0) return 0;
  const rows = await tx
    .update(messages)
    .set({ status: 'canceled', reason, updatedAt: now })
    .where(
      and(
        // Every channel, spelled out so the (org, channel, dedupe_key) index serves the lookup.
        inArray(messages.channel, [...MESSAGE_CHANNELS]),
        inArray(messages.dedupeKey, [...dedupeKeys]),
        eq(messages.status, 'queued'),
      ),
    )
    .returning({ id: messages.id });
  return rows.length;
}
