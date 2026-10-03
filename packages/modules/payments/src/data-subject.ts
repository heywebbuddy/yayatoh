import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  defineDataSubjectContributor,
  ERASED_NAME,
  hold,
  refsOf,
  type SubjectErasure,
} from '@yayatoh/platform';
import { and, asc, inArray, isNotNull } from 'drizzle-orm';
import { disputes } from './schema.ts';

/** Disputes (chargebacks) on orders the person placed. */
async function disputesTx(tx: TenantTx, s: DataSubject) {
  const orders = refsOf(s, 'order');
  if (orders.length === 0) return [];
  return tx.select().from(disputes).where(inArray(disputes.orderId, orders)).orderBy(asc(disputes.createdAt));
}

/**
 * payments' part of a data-subject request (M6.1c). Disputes on the person's orders are evidence
 * the provider and card networks may still ask for: they are kept under the payment-dispute hold
 * with the written evidence statement (buyer details) replaced, and listed in the receipt. The
 * ledger (journal entries and postings) holds ids, amounts and currencies only (no personal
 * values) and is immutable for the runtime role, so it is not touched.
 */
export const paymentsDataSubjects = defineDataSubjectContributor({
  module: 'payments',
  tables: {
    'payments.disputes': hold('payment_dispute'),
  },
  async export(tx, s) {
    const rows = await disputesTx(tx, s);
    return {
      sections: {
        disputes: rows.map((d) => ({
          orderId: d.orderId,
          eventId: d.eventId,
          status: d.status,
          reason: d.reason,
          amountMinor: d.amountMinor,
          currency: d.currency,
          evidenceSummary: d.evidenceSummary,
          evidenceSubmittedAt: d.evidenceSubmittedAt,
          openedAt: d.createdAt,
          closedAt: d.closedAt,
        })),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const rows = await disputesTx(tx, s);
    if (rows.length === 0) return { erased: {} };
    await tx
      .update(disputes)
      .set({ evidenceSummary: ERASED_NAME, updatedAt: ctx.now })
      .where(
        and(
          inArray(
            disputes.id,
            rows.map((d) => d.id),
          ),
          isNotNull(disputes.evidenceSummary),
        ),
      );
    return {
      erased: {},
      held: rows.map((d) => ({
        table: 'payments.disputes',
        id: d.id,
        ref: `dispute:${d.status}`,
        basis: 'payment_dispute' as const,
      })),
    };
  },
});
