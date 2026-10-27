import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { REENTRY_MAX_HOURS, REENTRY_MIN_HOURS } from './domain/reentry.ts';
import { admissions, reentrySettings } from './schema.ts';

/** The event's re-entry window in hours, or null when re-entry is off (the default). */
export async function reentryHoursTx(tx: TenantTx, eventId: string): Promise<number | null> {
  const [row] = await tx
    .select({ hours: reentrySettings.hours })
    .from(reentrySettings)
    .where(eq(reentrySettings.eventId, eventId));
  return row?.hours ?? null;
}

/**
 * Admit a ticket that is already in again, if its last entry is at least `hours` ago: one
 * conditional UPDATE, so two scanners racing for the same re-entry admit it once. Returns whether
 * this call was the re-entry.
 */
export async function reenterTx(
  tx: TenantTx,
  admissionId: string,
  now: Date,
  hours: number,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - hours * 3_600_000);
  const rows = await tx
    .update(admissions)
    .set({ lastEntryAt: now, entries: sql`${admissions.entries} + 1`, updatedAt: now })
    .where(
      and(
        eq(admissions.id, admissionId),
        isNull(admissions.undoneAt),
        or(
          and(isNull(admissions.lastEntryAt), lte(admissions.admittedAt, cutoff)),
          lte(admissions.lastEntryAt, cutoff),
        ),
      ),
    )
    .returning({ id: admissions.id });
  return rows.length === 1;
}

export const ReentrySettingsDto = z.object({
  /** Null: re-entry is off. */
  hours: z.int().min(REENTRY_MIN_HOURS).max(REENTRY_MAX_HOURS).nullable(),
});

export const reentrySettingsQuery = tenantQuery({
  name: 'checkin.reentrySettings',
  input: z.object({ eventId: z.uuid() }),
  output: ReentrySettingsDto,
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, tx }) => ({ hours: await reentryHoursTx(tx, input.eventId) }),
});

/**
 * "A ticket can be scanned in again N hours after its last entry" (1–72), or off. Scans inside the
 * window stay duplicates, as without it.
 */
export const setReentrySettingsCommand = tenantCommand({
  name: 'checkin.setReentrySettings',
  input: z.object({
    eventId: z.uuid(),
    hours: z.int().min(REENTRY_MIN_HOURS).max(REENTRY_MAX_HOURS).nullable(),
  }),
  output: ReentrySettingsDto,
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    if (input.hours === null) {
      await tx.delete(reentrySettings).where(eq(reentrySettings.eventId, event.id));
      return { hours: null };
    }
    const updatedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    await tx
      .insert(reentrySettings)
      .values({ orgId: requireOrg(ctx), eventId: event.id, hours: input.hours, updatedBy })
      .onConflictDoUpdate({
        target: [reentrySettings.orgId, reentrySettings.eventId],
        set: { hours: input.hours, updatedBy, updatedAt: ctx.now },
      });
    return { hours: input.hours };
  },
  audit: (input) => ({
    action: 'checkin.reentry_settings',
    targetType: 'event',
    targetId: input.eventId,
    data: { hours: input.hours },
  }),
});
