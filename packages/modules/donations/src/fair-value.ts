import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { onlineGivingTx } from '@yayatoh/orders';
import { tenantCommand } from '@yayatoh/platform';
import { ticketTypePricesTx } from '@yayatoh/ticketing';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { charityProfileTx } from './charity.ts';
import { FMV_MAX_MINOR, quidProQuoNotice } from './domain/receipts.ts';
import { ticketFairValues } from './schema.ts';

/** An event's fair-market values by ticket type (inside its tenant transaction). */
export async function fairValuesOfEventTx(tx: TenantTx, eventId: string) {
  const rows = await tx.select().from(ticketFairValues).where(eq(ticketFairValues.eventId, eventId));
  return new Map(rows.map((r) => [r.ticketTypeId, r]));
}

/** Fair-market values of these ticket types. */
export async function fairValuesOfTypesTx(tx: TenantTx, ticketTypeIds: readonly string[]) {
  if (ticketTypeIds.length === 0) return new Map<string, typeof ticketFairValues.$inferSelect>();
  const rows = await tx
    .select()
    .from(ticketFairValues)
    .where(inArray(ticketFairValues.ticketTypeId, [...ticketTypeIds]));
  return new Map(rows.map((r) => [r.ticketTypeId, r]));
}

/**
 * Set a ticket type's fair-market value (M4.8b, P4-11): the good-faith value of what a buyer
 * receives, and what it is. Hosts with `events:write`. Turns receipts on for that ticket type's
 * orders; its page shows the quid-pro-quo notice over $75 once the charity is verified.
 */
export const setFairValueCommand = tenantCommand({
  name: 'donations.setFairValue',
  input: z.object({
    eventId: z.uuid(),
    ticketTypeId: z.uuid(),
    fmvMinor: z.int().min(0).max(FMV_MAX_MINOR),
    description: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((v) => (v ? v : null)),
  }),
  output: z.object({ ticketTypeId: z.uuid(), fmvMinor: z.int() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const type = (await ticketTypePricesTx(tx, event.id, ctx.now)).find((t) => t.id === input.ticketTypeId);
    if (!type) throw new DomainError('not_found', 'Ticket type not found');
    await tx
      .insert(ticketFairValues)
      .values({
        orgId,
        eventId: event.id,
        ticketTypeId: type.id,
        fmvMinor: input.fmvMinor,
        currency: type.currency,
        description: input.description,
      })
      .onConflictDoUpdate({
        target: [ticketFairValues.orgId, ticketFairValues.ticketTypeId],
        set: { fmvMinor: input.fmvMinor, description: input.description, updatedAt: ctx.now },
      });
    return { ticketTypeId: type.id, fmvMinor: input.fmvMinor };
  },
  audit: (input) => ({
    action: 'donations.fair_value.set',
    targetType: 'ticket_type',
    targetId: input.ticketTypeId,
    data: { eventId: input.eventId, fmvMinor: input.fmvMinor, description: input.description },
  }),
});

/** Clear a ticket type's fair-market value: its orders get no receipt from then on. */
export const clearFairValueCommand = tenantCommand({
  name: 'donations.clearFairValue',
  input: z.object({ eventId: z.uuid(), ticketTypeId: z.uuid() }),
  output: z.object({ cleared: z.boolean() }),
  entitlement: 'donations',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const gone = await tx
      .delete(ticketFairValues)
      .where(
        and(
          eq(ticketFairValues.eventId, input.eventId),
          eq(ticketFairValues.ticketTypeId, input.ticketTypeId),
        ),
      )
      .returning({ id: ticketFairValues.id });
    return { cleared: gone.length > 0 };
  },
  audit: (input) => ({
    action: 'donations.fair_value.clear',
    targetType: 'ticket_type',
    targetId: input.ticketTypeId,
    data: { eventId: input.eventId },
  }),
});

export interface PublicTaxNotice {
  readonly priceMinor: number;
  readonly fmvMinor: number;
  readonly deductibleMinor: number;
  readonly currency: string;
}

/**
 * The quid-pro-quo notices of an event's ticket page (public): per ticket type over $75 with a
 * fair-market value, when the org's charity profile is verified and its tickets are paid to its
 * own connected account. Only the price, the value and the deductible part: no donor data.
 */
export async function publicTaxNotices(
  orgId: string,
  eventId: string,
): Promise<Map<string, PublicTaxNotice>> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.public' } });
  return withTenant(ctx, async (tx) => {
    const out = new Map<string, PublicTaxNotice>();
    const profile = await charityProfileTx(tx);
    if (profile?.status !== 'verified') return out;
    if (!(await onlineGivingTx(tx)).connected) return out;
    const values = await fairValuesOfEventTx(tx, eventId);
    if (values.size === 0) return out;
    for (const t of await ticketTypePricesTx(tx, eventId, ctx.now)) {
      const v = values.get(t.id);
      if (!v || t.isDonation || t.archived) continue;
      const n = quidProQuoNotice({ priceMinor: t.priceMinor, fmvMinor: v.fmvMinor, currency: t.currency });
      if (n) out.set(t.id, { ...n, currency: t.currency });
    }
    return out;
  });
}
