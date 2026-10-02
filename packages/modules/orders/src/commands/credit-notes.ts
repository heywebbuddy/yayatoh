import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  creditableMinor,
  creditNoteAmount,
  formatCreditNoteNumber,
  newCreditCode,
} from '../domain/credit-notes.ts';
import { BuyerCreditNoteDto } from '../dto.ts';
import {
  CREDIT_NOTE_DISPOSITIONS,
  CREDIT_NOTE_KINDS,
  creditNoteApplications,
  creditNoteSequences,
  creditNotes,
  orders,
  refunds,
} from '../schema.ts';

type NoteRow = typeof creditNotes.$inferSelect;

/** Order statuses a credit note can be issued against (the buyer paid something). */
const CREDITABLE_STATUSES = ['paid', 'partially_refunded'] as const;

export const CreditNoteDto = z.object({
  id: z.uuid(),
  number: z.int(),
  /** CN-00001 */
  label: z.string(),
  orderId: z.uuid(),
  eventId: z.uuid(),
  kind: z.enum(CREDIT_NOTE_KINDS),
  disposition: z.enum(CREDIT_NOTE_DISPOSITIONS),
  reason: z.string(),
  amountMinor: z.int(),
  balanceMinor: z.int(),
  currency: z.string(),
  /** The code's last four characters (the full code is shown once, and sent to the buyer). */
  codeLast4: z.string().nullable(),
  buyerName: z.string(),
  buyerEmail: z.string(),
  createdAt: z.date(),
  /** Store credit spent so far (orders placed with the code, still holding it). */
  appliedMinor: z.int(),
});
export type CreditNoteDto = z.infer<typeof CreditNoteDto>;

const present = (r: NoteRow, appliedMinor = 0): CreditNoteDto => ({
  id: r.id,
  number: r.number,
  label: formatCreditNoteNumber(r.number),
  orderId: r.orderId,
  eventId: r.eventId,
  kind: r.kind as CreditNoteDto['kind'],
  disposition: r.disposition as CreditNoteDto['disposition'],
  reason: r.reason,
  amountMinor: r.amountMinor,
  balanceMinor: r.balanceMinor,
  currency: r.currency,
  codeLast4: r.code ? r.code.slice(-4) : null,
  buyerName: r.buyerName,
  buyerEmail: r.buyerEmail,
  createdAt: r.createdAt,
  appliedMinor,
});

/** Take the org's next credit note number (the counter row is locked until the transaction ends). */
async function nextNumberTx(tx: TenantTx, ctx: Ctx): Promise<number> {
  const [row] = await tx
    .insert(creditNoteSequences)
    .values({ orgId: requireOrg(ctx), lastNumber: 1 })
    .onConflictDoUpdate({
      target: creditNoteSequences.orgId,
      set: { lastNumber: sql`${creditNoteSequences.lastNumber} + 1`, updatedAt: ctx.now },
    })
    .returning({ n: creditNoteSequences.lastNumber });
  if (!row) throw new DomainError('internal');
  return row.n;
}

/** What is left to credit on a locked order: paid, less refunds (pending or done), less notes. */
async function creditableTx(tx: TenantTx, order: typeof orders.$inferSelect): Promise<number> {
  const [r] = await tx
    .select({ n: sql<string>`coalesce(sum(${refunds.amountMinor}), 0)::text` })
    .from(refunds)
    .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ['pending', 'succeeded'])));
  const [c] = await tx
    .select({ n: sql<string>`coalesce(sum(${creditNotes.amountMinor}), 0)::text` })
    .from(creditNotes)
    .where(eq(creditNotes.orderId, order.id));
  return creditableMinor({
    totalMinor: order.totalMinor,
    refundedMinor: Number(r?.n ?? 0),
    creditedMinor: Number(c?.n ?? 0),
  });
}

export const IssuedCreditNoteDto = CreditNoteDto.extend({
  /** Store credit: the full code, shown once to whoever issued it. */
  code: z.string().nullable(),
});

/**
 * Issue a credit note against an order (M3.10c): full (what is left of it) or partial, with a
 * reason, numbered per org. `store_credit` gives the buyer a code for a later order of this org;
 * `refunded` records money paid back outside the provider (nothing moves). Finance roles only
 * (`orders:refund`), idempotent (Idempotency-Key), audited; the buyer is emailed.
 */
export const issueCreditNoteCommand = tenantCommand({
  name: 'orders.issueCreditNote',
  category: 'money',
  idempotent: true,
  input: z.object({
    orderId: z.uuid(),
    kind: z.enum(CREDIT_NOTE_KINDS),
    amountMinor: z.int().min(1).max(100_000_000).optional(),
    disposition: z.enum(CREDIT_NOTE_DISPOSITIONS),
    reason: z.string().trim().min(3).max(500),
  }),
  output: IssuedCreditNoteDto,
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx, emit }) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for('update');
    if (!order) throw new DomainError('not_found', 'Order not found');
    if (!(CREDITABLE_STATUSES as readonly string[]).includes(order.status))
      throw new DomainError('invalid_state', 'This order cannot be credited', { reason: 'order_not_paid' });
    const creditable = await creditableTx(tx, order);
    const amount = creditNoteAmount(input.kind, input.amountMinor, creditable);
    if (!amount.ok)
      throw new DomainError(
        amount.problem === 'nothing_to_credit' ? 'invalid_state' : 'validation_failed',
        'The credit note amount is not valid',
        { reason: amount.problem, field: 'amountMinor', creditableMinor: creditable },
      );
    const number = await nextNumberTx(tx, ctx);
    const store = input.disposition === 'store_credit';
    const [row] = await tx
      .insert(creditNotes)
      .values({
        orgId: requireOrg(ctx),
        orderId: order.id,
        eventId: order.eventId,
        number,
        kind: input.kind,
        disposition: input.disposition,
        reason: input.reason,
        amountMinor: amount.amountMinor,
        balanceMinor: store ? amount.amountMinor : 0,
        currency: order.currency,
        code: store ? newCreditCode() : null,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        issuedBy: actorId(ctx.actor),
      })
      .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'order.credit_note_issued',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: {
        orgId: row.orgId,
        orderId: order.id,
        creditNoteId: row.id,
        amountMinor: row.amountMinor,
        currency: row.currency,
        disposition: row.disposition,
      },
    });
    return { ...present(row), code: row.code };
  },
  audit: (input, r) => ({
    action: 'order.credit_note',
    targetType: 'order',
    targetId: input.orderId,
    data: {
      creditNoteId: r.id,
      number: r.number,
      kind: input.kind,
      disposition: input.disposition,
      amountMinor: r.amountMinor,
    },
  }),
});

async function appliedByNoteTx(tx: TenantTx, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await tx
    .select({
      id: creditNoteApplications.creditNoteId,
      n: sql<string>`sum(${creditNoteApplications.amountMinor})::text`,
    })
    .from(creditNoteApplications)
    .where(
      and(inArray(creditNoteApplications.creditNoteId, [...ids]), isNull(creditNoteApplications.releasedAt)),
    )
    .groupBy(creditNoteApplications.creditNoteId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

/** Credit notes of one order, or the org's latest (finance report), newest first. */
export const creditNotesQuery = tenantQuery({
  name: 'orders.creditNotes',
  input: z.object({ orderId: z.uuid().optional(), limit: z.int().min(1).max(500).default(200) }),
  output: z.array(CreditNoteDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(creditNotes)
      .where(input.orderId ? eq(creditNotes.orderId, input.orderId) : undefined)
      .orderBy(desc(creditNotes.number))
      .limit(input.limit);
    const applied = await appliedByNoteTx(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) => present(r, applied.get(r.id) ?? 0));
  },
});

export const CreditNoteTotalsDto = z.object({
  currency: z.string(),
  count: z.int(),
  issuedMinor: z.int(),
  storeCreditMinor: z.int(),
  refundedMinor: z.int(),
  appliedMinor: z.int(),
  outstandingMinor: z.int(),
});

/** Finance report (M3.10c): credit notes per currency: issued, as store credit, recorded refunded, spent, left. */
export const creditNoteTotalsQuery = tenantQuery({
  name: 'orders.creditNoteTotals',
  input: z.object({ eventId: z.uuid().optional() }),
  output: z.array(CreditNoteTotalsDto),
  entitlement: 'ticketing',
  permission: 'finance:read',
  handler: async ({ input, tx }) => {
    const rows = await tx.execute<{
      currency: string;
      count: number;
      issued: string;
      store: string;
      refunded: string;
      outstanding: string;
    }>(sql`
      select currency, count(*)::int as count, sum(amount_minor)::text as issued,
        sum(amount_minor) filter (where disposition = 'store_credit')::text as store,
        sum(amount_minor) filter (where disposition = 'refunded')::text as refunded,
        sum(balance_minor)::text as outstanding
      from orders.credit_notes
      ${input.eventId ? sql`where event_id = ${input.eventId}` : sql``}
      group by currency order by currency`);
    return rows.map((r) => {
      const store = Number(r.store ?? 0);
      const outstanding = Number(r.outstanding ?? 0);
      return {
        currency: r.currency,
        count: r.count,
        issuedMinor: Number(r.issued ?? 0),
        storeCreditMinor: store,
        refundedMinor: Number(r.refunded ?? 0),
        appliedMinor: store - outstanding,
        outstandingMinor: outstanding,
      };
    });
  },
});

export const CreditNoteDocumentDto = CreditNoteDto.extend({
  orderCreatedAt: z.date(),
  orderTotalMinor: z.int(),
  eventName: z.string(),
  eventTimezone: z.string(),
});

/** One credit note with what its document shows (the PDF). */
export const creditNoteDocumentQuery = tenantQuery({
  name: 'orders.creditNoteDocument',
  input: z.object({ creditNoteId: z.uuid() }),
  output: CreditNoteDocumentDto,
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) => {
    const [r] = await tx.select().from(creditNotes).where(eq(creditNotes.id, input.creditNoteId));
    if (!r) throw new DomainError('not_found', 'Credit note not found');
    const [o] = await tx.select().from(orders).where(eq(orders.id, r.orderId));
    const ev = await findEventTx(tx, r.eventId);
    if (!o || !ev) throw new DomainError('not_found', 'Credit note not found');
    const applied = await appliedByNoteTx(tx, [r.id]);
    return {
      ...present(r, applied.get(r.id) ?? 0),
      orderCreatedAt: o.createdAt,
      orderTotalMinor: o.totalMinor,
      eventName: ev.name,
      eventTimezone: ev.timezone,
    };
  },
});

/**
 * Checkout (M3.10c): the store credit behind a code, locked; null when the code is unknown, spent
 * or not store credit. The org comes from the checkout's context (RLS): a code works only at the
 * org that issued it.
 */
export async function lockCreditByCodeTx(tx: TenantTx, code: string) {
  const [r] = await tx
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.code, code), eq(creditNotes.disposition, 'store_credit')))
    .for('update');
  return r && r.balanceMinor > 0 ? r : null;
}

/** Spend store credit on a new order (same transaction as the order). */
export async function applyCreditTx(
  tx: TenantTx,
  ctx: Ctx,
  note: NoteRow,
  orderId: string,
  amountMinor: number,
): Promise<void> {
  if (amountMinor <= 0) return;
  const [u] = await tx
    .update(creditNotes)
    .set({ balanceMinor: sql`${creditNotes.balanceMinor} - ${amountMinor}`, updatedAt: ctx.now })
    .where(and(eq(creditNotes.id, note.id), sql`${creditNotes.balanceMinor} >= ${amountMinor}`))
    .returning({ id: creditNotes.id });
  if (!u)
    throw new DomainError('conflict', 'The store credit changed meanwhile', { reason: 'credit_changed' });
  await tx
    .insert(creditNoteApplications)
    .values({ orgId: requireOrg(ctx), creditNoteId: note.id, orderId, amountMinor });
}

/** An order that lapsed unpaid gives its store credit back to the note. */
export async function releaseCreditTx(tx: TenantTx, ctx: Ctx, orderId: string): Promise<void> {
  const [a] = await tx
    .update(creditNoteApplications)
    .set({ releasedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(creditNoteApplications.orderId, orderId), isNull(creditNoteApplications.releasedAt)))
    .returning();
  if (!a) return;
  await tx
    .update(creditNotes)
    .set({ balanceMinor: sql`${creditNotes.balanceMinor} + ${a.amountMinor}`, updatedAt: ctx.now })
    .where(eq(creditNotes.id, a.creditNoteId));
}

/**
 * Paid after the hold lapsed: the credit is taken again if the note still has it (otherwise the
 * organizer honours the price the buyer paid).
 */
export async function reclaimCreditTx(tx: TenantTx, ctx: Ctx, orderId: string): Promise<void> {
  const [a] = await tx
    .select()
    .from(creditNoteApplications)
    .where(eq(creditNoteApplications.orderId, orderId));
  if (!a?.releasedAt) return;
  const [u] = await tx
    .update(creditNotes)
    .set({ balanceMinor: sql`${creditNotes.balanceMinor} - ${a.amountMinor}`, updatedAt: ctx.now })
    .where(and(eq(creditNotes.id, a.creditNoteId), sql`${creditNotes.balanceMinor} >= ${a.amountMinor}`))
    .returning({ id: creditNotes.id });
  if (u)
    await tx
      .update(creditNoteApplications)
      .set({ releasedAt: null, updatedAt: ctx.now })
      .where(eq(creditNoteApplications.id, a.id));
}

/** The credit an order used and the notes issued against it, for the timeline. */
export async function creditTimelineTx(tx: TenantTx, orderId: string) {
  const issued = await tx
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.orderId, orderId))
    .orderBy(creditNotes.createdAt);
  const used = await tx
    .select({ a: creditNoteApplications, number: creditNotes.number })
    .from(creditNoteApplications)
    .innerJoin(creditNotes, eq(creditNotes.id, creditNoteApplications.creditNoteId))
    .where(eq(creditNoteApplications.orderId, orderId));
  return {
    issued: issued.map((r) => ({
      at: r.createdAt,
      label: formatCreditNoteNumber(r.number),
      amountMinor: r.amountMinor,
      disposition: r.disposition,
    })),
    applied: used.map(({ a, number }) => ({
      at: a.createdAt,
      label: formatCreditNoteNumber(number),
      amountMinor: a.amountMinor,
      releasedAt: a.releasedAt,
    })),
  };
}

/** The buyer's credit notes on their order page (manage link). */
export async function buyerCreditNotesTx(tx: TenantTx, orderId: string) {
  const rows = await tx
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.orderId, orderId))
    .orderBy(creditNotes.number);
  return rows.map((r) =>
    BuyerCreditNoteDto.parse({
      label: formatCreditNoteNumber(r.number),
      amountMinor: r.amountMinor,
      balanceMinor: r.balanceMinor,
      currency: r.currency,
      disposition: r.disposition,
      reason: r.reason,
      code: r.code,
      createdAt: r.createdAt,
    }),
  );
}
