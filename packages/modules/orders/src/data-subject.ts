import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  ERASED_EMAIL,
  ERASED_NAME,
  type HeldRecord,
  hold,
  notSubject,
  REDACT,
  type SubjectErasure,
  type SubjectRefs,
} from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { eraseOrdersDsarTx, ordersDsarTx } from './dsar.ts';
import {
  creditNotes,
  invoices,
  orderNotes,
  orders,
  refundRequests,
  supportMacroRuns,
  waitlistEntries,
} from './schema.ts';
import { waitlistDsarTx } from './waitlist.ts';

/** Orders that were ever paid: tax and accounting records (D11: kept 7 years). */
const SOLD = new Set(['paid', 'partially_refunded', 'refunded']);
const HOLD_YEARS = 7;

const holdUntil = (from: Date) => {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + HOLD_YEARS);
  return d.toISOString().slice(0, 10);
};

/** The orders the person placed (they are the buyer): by address. */
async function buyerOrderIdsTx(tx: TenantTx, s: DataSubject): Promise<string[]> {
  const rows = await tx.select({ id: orders.id }).from(orders).where(eq(orders.buyerEmail, s.email));
  return rows.map((r) => r.id);
}

/**
 * orders' part of a data-subject request (M6.1c). Orders the person placed are redacted; paid
 * ones (and their credit notes) are kept under the tax and accounting hold with the buyer's name
 * and address replaced, and listed in the receipt. Refund-request messages, support replies sent
 * to them and staff notes on their orders go; waitlist places are deleted (open offers release
 * their stock first); this org's site sign-ins and codes for the address are deleted.
 */
export const ordersDataSubjects = defineDataSubjectContributor({
  module: 'orders',
  tables: {
    'orders.orders': hold('tax_accounting'),
    'orders.credit_notes': hold('tax_accounting'),
    'orders.invoices': hold('tax_accounting'),
    'orders.refunds': REDACT,
    'orders.refund_requests': REDACT,
    'orders.order_notes': DELETE,
    'orders.support_macro_runs': REDACT,
    'orders.support_macros': notSubject('reply templates the organizer writes; runs on an order are covered'),
    'orders.waitlist_entries': DELETE,
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const rows = await tx
      .select({ id: orders.id, name: orders.buyerName })
      .from(orders)
      .where(eq(orders.buyerEmail, s.email));
    const waiting = await tx
      .select({ name: waitlistEntries.name })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, s.email));
    return {
      order: rows.map((r) => r.id),
      name: [...rows.map((r) => r.name), ...waiting.flatMap((w) => (w.name ? [w.name] : []))],
    };
  },
  async export(tx, s) {
    const ids = await buyerOrderIdsTx(tx, s);
    const placed = await ordersDsarTx(tx, s.email);
    const notes = ids.length
      ? await tx
          .select()
          .from(creditNotes)
          .where(inArray(creditNotes.orderId, ids))
          .orderBy(asc(creditNotes.number))
      : [];
    const requests = ids.length
      ? await tx.select().from(refundRequests).where(inArray(refundRequests.orderId, ids))
      : [];
    const replies = ids.length
      ? await tx.select().from(supportMacroRuns).where(inArray(supportMacroRuns.orderId, ids))
      : [];
    const issued = ids.length
      ? await tx.select().from(invoices).where(inArray(invoices.orderId, ids)).orderBy(asc(invoices.number))
      : [];
    return {
      sections: {
        orders: placed,
        invoices: issued.map((i) => ({
          orderId: i.orderId,
          number: i.number,
          status: i.status,
          poNumber: i.poNumber,
          billingCompany: i.billingCompany,
          buyerName: i.buyerName,
          buyerEmail: i.buyerEmail,
          totalMinor: i.totalMinor,
          paidMinor: i.paidMinor,
          currency: i.currency,
          issuedOn: i.issuedOn,
          dueOn: i.dueOn,
          paidAt: i.paidAt,
          voidedAt: i.voidedAt,
        })),
        creditNotes: notes.map((n) => ({
          orderId: n.orderId,
          number: n.number,
          kind: n.kind,
          disposition: n.disposition,
          reason: n.reason,
          amountMinor: n.amountMinor,
          currency: n.currency,
          buyerName: n.buyerName,
          buyerEmail: n.buyerEmail,
          issuedAt: n.createdAt,
        })),
        refundRequests: requests.map((r) => ({
          orderId: r.orderId,
          status: r.status,
          message: r.message,
          declineReason: r.declineReason,
          createdAt: r.createdAt,
          decidedAt: r.decidedAt,
        })),
        supportReplies: replies.map((r) => ({
          orderId: r.orderId,
          subject: r.replySubject,
          body: r.replyBody,
          sentAt: r.createdAt,
        })),
        waitlist: await waitlistDsarTx(tx, s.email),
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const now = ctx.now;
    const placed = await tx
      .select({ id: orders.id, status: orders.status, paidAt: orders.paidAt, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.buyerEmail, s.email));
    const ids = placed.map((o) => o.id);
    const waiting = (
      await tx
        .select({ id: waitlistEntries.id })
        .from(waitlistEntries)
        .where(eq(waitlistEntries.email, s.email))
    ).length;
    // Orders, refund notes, guest sign-ins and waitlist places (M1.14c).
    const r = await eraseOrdersDsarTx(tx, s.email, now);
    const notes = ids.length
      ? await tx
          .update(creditNotes)
          .set({ buyerName: ERASED_NAME, buyerEmail: ERASED_EMAIL, updatedAt: now })
          .where(inArray(creditNotes.orderId, ids))
          .returning({ id: creditNotes.id, number: creditNotes.number, createdAt: creditNotes.createdAt })
      : [];
    const messages = ids.length
      ? await tx
          .update(refundRequests)
          .set({ message: null, updatedAt: now })
          .where(and(inArray(refundRequests.orderId, ids), isNotNull(refundRequests.message)))
          .returning({ id: refundRequests.id })
      : [];
    const declines = ids.length
      ? await tx
          .update(refundRequests)
          .set({ declineReason: ERASED_NAME, updatedAt: now })
          .where(and(inArray(refundRequests.orderId, ids), isNotNull(refundRequests.declineReason)))
          .returning({ id: refundRequests.id })
      : [];
    const replies = ids.length
      ? await tx
          .update(supportMacroRuns)
          .set({ replySubject: ERASED_NAME, replyBody: ERASED_NAME, updatedAt: now })
          .where(inArray(supportMacroRuns.orderId, ids))
          .returning({ id: supportMacroRuns.id })
      : [];
    // M5.1d invoices: accounting documents, kept under the hold with the buyer's details replaced.
    const billed = ids.length
      ? await tx
          .update(invoices)
          .set({
            buyerName: ERASED_NAME,
            buyerEmail: ERASED_EMAIL,
            poNumber: null,
            billingCompany: null,
            updatedAt: now,
          })
          .where(inArray(invoices.orderId, ids))
          .returning({ id: invoices.id, number: invoices.number, createdAt: invoices.createdAt })
      : [];
    const staffNotes = ids.length
      ? await tx.delete(orderNotes).where(inArray(orderNotes.orderId, ids)).returning({ id: orderNotes.id })
      : [];
    const held: HeldRecord[] = [
      ...placed
        .filter((o) => SOLD.has(o.status))
        .map((o) => ({
          table: 'orders.orders',
          id: o.id,
          ref: o.status,
          basis: 'tax_accounting' as const,
          until: holdUntil(o.paidAt ?? o.createdAt),
        })),
      ...notes.map((n) => ({
        table: 'orders.credit_notes',
        id: n.id,
        ref: `#${n.number}`,
        basis: 'tax_accounting' as const,
        until: holdUntil(n.createdAt),
      })),
      ...billed.map((i) => ({
        table: 'orders.invoices',
        id: i.id,
        ref: `#${i.number}`,
        basis: 'tax_accounting' as const,
        until: holdUntil(i.createdAt),
      })),
    ];
    const heldOrders = held.filter((h) => h.table === 'orders.orders').length;
    return {
      erased: {
        'orders.orders': r.erased - heldOrders,
        'orders.refunds': r.refundNotes,
        'orders.refund_requests': new Set([...messages, ...declines].map((m) => m.id)).size,
        'orders.support_macro_runs': replies.length,
        'orders.order_notes': staffNotes.length,
        'orders.waitlist_entries': waiting,
      },
      held,
    };
  },
});
