import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent } from '@yayatoh/kernel';
import { issueInvoiceTx, normalizePoNumber } from '@yayatoh/orders';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { registrationTypes } from './schema.ts';

/**
 * Pay later by invoice (M5.1d, P5-5): an organizer opt-in per registration type, with its PO
 * number rule. A buyer of such a type may register now and pay by invoice (Net 30, due no later
 * than 7 days before the event): the order is invoiced in the checkout transaction, the place is
 * taken and the registrant confirmed; the balance is paid by the pay link or recorded by staff.
 * Approval types (paid from the applicant's link) and +1 guest types (paid by their host) don't
 * offer it.
 */

export const PO_MODES = ['off', 'optional', 'required'] as const;
export type PoMode = (typeof PO_MODES)[number];

type TypeRow = typeof registrationTypes.$inferSelect;
type Emit = (e: DomainEvent) => void;

/** Whether a type offers pay later to the public checkout as it is now. */
export const offersPayLater = (t: Pick<TypeRow, 'payLater' | 'approval' | 'kind'>) =>
  t.payLater && t.approval !== 'manual' && t.kind !== 'guest';

export const PayLaterInput = z.object({
  /** The PO number the buyer typed (the type may require one). */
  poNumber: z.string().max(60).nullish(),
  /** Who the invoice is made out to, when not the buyer themselves. */
  billingCompany: z.string().max(120).nullish(),
});
export type PayLaterInput = z.infer<typeof PayLaterInput>;

/** Refuse a pay-later request the type doesn't allow, or without the PO number it requires. */
export function assertPayLater(type: TypeRow, p: PayLaterInput): void {
  if (!offersPayLater(type))
    throw new DomainError('forbidden', 'This registration type is paid at checkout', {
      reason: 'pay_later_off',
    });
  if (type.poNumber === 'required' && !normalizePoNumber(p.poNumber))
    throw new DomainError('validation_failed', 'Enter your PO number', {
      reason: 'po_required',
      field: 'poNumber',
    });
}

/** Invoice a just-reserved registration order (the checkout's transaction). */
export async function invoiceRegistrationTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  type: TypeRow,
  orderId: string,
  p: PayLaterInput,
) {
  return issueInvoiceTx(tx, ctx, emit, {
    orderId,
    poNumber: type.poNumber === 'off' ? null : normalizePoNumber(p.poNumber),
    billingCompany: (p.billingCompany ?? '').trim().replace(/\s+/g, ' ') || null,
  });
}

export const PayLaterRulesDto = z.object({
  registrationTypeId: z.uuid(),
  payLater: z.boolean(),
  poNumber: z.enum(PO_MODES),
  /** Approval and +1 types can't offer pay later. */
  eligible: z.boolean(),
});
export type PayLaterRulesDto = z.infer<typeof PayLaterRulesDto>;

/** Each live type's pay-later rule (the Registration page). */
export const payLaterRulesQuery = tenantQuery({
  name: 'registration.payLaterRules',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(PayLaterRulesDto),
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(registrationTypes)
      .where(and(eq(registrationTypes.eventId, input.eventId), isNull(registrationTypes.archivedAt)))
      .orderBy(asc(registrationTypes.sortOrder), asc(registrationTypes.createdAt));
    return rows.map((t) => ({
      registrationTypeId: t.id,
      payLater: t.payLater,
      poNumber: t.poNumber as PoMode,
      eligible: t.approval !== 'manual' && t.kind !== 'guest',
    }));
  },
});

/**
 * Turn pay later on or off for a type, and set its PO rule (off, optional, required). Applies to
 * registrations from now on; invoices already issued keep their terms.
 */
export const setPayLaterCommand = tenantCommand({
  name: 'registration.setPayLater',
  input: z.object({
    eventId: z.uuid(),
    registrationTypeId: z.uuid(),
    payLater: z.boolean(),
    poNumber: z.enum(PO_MODES).default('off'),
  }),
  output: PayLaterRulesDto,
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    if (['cancelled', 'completed', 'archived'].includes(event.status))
      throw new DomainError('invalid_state', 'Registration cannot change on a finished event', {
        reason: 'event_finished',
      });
    const [type] = await tx
      .select()
      .from(registrationTypes)
      .where(eq(registrationTypes.id, input.registrationTypeId))
      .for('update');
    if (!type || type.eventId !== event.id || type.archivedAt)
      throw new DomainError('not_found', 'Registration type not found');
    if (input.payLater && (type.approval === 'manual' || type.kind === 'guest'))
      throw new DomainError('validation_failed', 'This type is paid another way', {
        field: 'payLater',
        reason: type.kind === 'guest' ? 'guest_type' : 'approval_type',
      });
    const [row] = await tx
      .update(registrationTypes)
      .set({
        payLater: input.payLater,
        poNumber: input.payLater ? input.poNumber : 'off',
        updatedAt: ctx.now,
      })
      .where(eq(registrationTypes.id, type.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return {
      registrationTypeId: row.id,
      payLater: row.payLater,
      poNumber: row.poNumber as PoMode,
      eligible: true,
    };
  },
  audit: (input) => ({
    action: 'registration.type.pay_later',
    targetType: 'registration_type',
    targetId: input.registrationTypeId,
    data: {
      eventId: input.eventId,
      payLater: input.payLater,
      poNumber: input.payLater ? input.poNumber : 'off',
    },
  }),
});
