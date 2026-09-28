import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { ERASED_EMAIL, ERASED_NAME } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNotNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { orderItems, orders, refunds } from './schema.ts';

/** Orders that were ever paid: kept for tax and accounting (legal hold), only redacted. */
const SOLD = ['paid', 'partially_refunded', 'refunded'] as const;

/** A person's orders as buyer, with items and refunds, allowlisted (M1.14c). */
export async function ordersDsarTx(tx: TenantTx, emailNorm: string) {
  return ordersWhereTx(tx, eq(orders.buyerEmail, emailNorm));
}

/**
 * A signed-in person's own orders in the current org (M1.14e account export): those linked to
 * their account or bought with their email. Same allowlist as the org-side export: what the
 * buyer sees on their order page (status, names, amounts, items, refunds), no tokens or
 * provider references.
 */
export async function buyerOrdersDsarTx(tx: TenantTx, userId: string | null, emailNorm: string) {
  return ordersWhereTx(
    tx,
    userId
      ? or(eq(orders.buyerUserId, userId), eq(orders.buyerEmail, emailNorm))
      : eq(orders.buyerEmail, emailNorm),
  );
}

/** Orgs where a person bought, linked or by email (SECURITY DEFINER; org ids only). */
export async function buyerOrgs(userId: string | null, emailNorm: string): Promise<string[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from orders.buyer_orgs(${userId}::uuid, ${emailNorm})`),
  );
  return rows.map((r) => r.org_id);
}

/**
 * The account is being deleted (M1.14e): its orders stay (the org needs them for accounting and
 * its own customer records; the buyer email on them is the org's data) but no longer point at the
 * account. Returns how many were unlinked.
 */
export async function unlinkBuyerUserTx(tx: TenantTx, userId: string, now: Date): Promise<number> {
  const rows = await tx
    .update(orders)
    .set({ buyerUserId: null, updatedAt: now })
    .where(eq(orders.buyerUserId, userId))
    .returning({ id: orders.id });
  return rows.length;
}

async function ordersWhereTx(tx: TenantTx, where: SQL | undefined) {
  const rows = await tx.select().from(orders).where(where).orderBy(asc(orders.createdAt));
  const ids = rows.map((o) => o.id);
  const items = ids.length ? await tx.select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [];
  const refundRows = ids.length ? await tx.select().from(refunds).where(inArray(refunds.orderId, ids)) : [];
  return rows.map((o) => ({
    id: o.id,
    eventId: o.eventId,
    status: o.status,
    buyerName: o.buyerName,
    buyerEmail: o.buyerEmail,
    currency: o.currency,
    totalMinor: o.totalMinor,
    promoCode: o.promoCode,
    paymentMethod: o.paymentMethod,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    items: items
      .filter((i) => i.orderId === o.id)
      .map((i) => ({ name: i.name, quantity: i.quantity, unitFaceMinor: i.unitFaceMinor })),
    refunds: refundRows
      .filter((r) => r.orderId === o.id)
      .map((r) => ({ amountMinor: r.amountMinor, status: r.status, createdAt: r.createdAt })),
  }));
}

/**
 * Erase the buyer: every order keeps its amounts, status and ledger links (paid ones are under
 * legal hold for 7 years) but loses name, email, account link, payment reference and the
 * manage-link ciphertext (the emailed link stops working). Refund notes are cleared.
 */
export async function eraseOrdersDsarTx(tx: TenantTx, emailNorm: string, now: Date) {
  const rows = await tx
    .update(orders)
    .set({
      buyerName: ERASED_NAME,
      buyerEmail: ERASED_EMAIL,
      buyerUserId: null,
      paymentReference: null,
      manageTokenCiphertext: null,
      updatedAt: now,
    })
    .where(eq(orders.buyerEmail, emailNorm))
    .returning({ id: orders.id, status: orders.status });
  const ids = rows.map((r) => r.id);
  if (ids.length)
    await tx
      .update(refunds)
      .set({ note: null, updatedAt: now })
      .where(and(inArray(refunds.orderId, ids), isNotNull(refunds.note)));
  return {
    orderIds: ids,
    erased: rows.length,
    legalHold: rows.filter((r) => (SOLD as readonly string[]).includes(r.status)).length,
  };
}

/**
 * Retention: checkouts that were never paid (expired or cancelled) keep no personal data after
 * `before`. Amounts and status stay for reporting (failed-payment counts).
 */
export async function redactAbandonedOrdersTx(tx: TenantTx, before: Date, now: Date): Promise<string[]> {
  const rows = await tx
    .update(orders)
    .set({
      buyerName: ERASED_NAME,
      buyerEmail: ERASED_EMAIL,
      buyerUserId: null,
      manageTokenCiphertext: null,
      paymentReference: null,
      updatedAt: now,
    })
    .where(
      and(
        inArray(orders.status, ['expired', 'cancelled']),
        lt(orders.createdAt, before),
        ne(orders.buyerEmail, ERASED_EMAIL),
      ),
    )
    .returning({ id: orders.id });
  return rows.map((r) => r.id);
}
