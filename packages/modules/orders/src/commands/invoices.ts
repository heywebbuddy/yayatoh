import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, type Ctx, createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { type FundsFlow, fundsFlowTx, type ProviderEvent, postInvoicePaymentTx } from '@yayatoh/payments';
import { signLinkToken, tenantCommand, tenantQuery, verifyLinkToken } from '@yayatoh/platform';
import {
  releasePromoTx,
  sellHeldTx,
  setOrderPaymentDueTx,
  ticketsForOrderTx,
  voidTicketsTx,
} from '@yayatoh/ticketing';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  balanceMinor,
  DEFAULT_TERMS,
  feePartMinor,
  formatInvoiceNumber,
  invoiceTerms,
  isOverdue,
  localDay,
  normalizePoNumber,
  payAmountProblem,
} from '../domain/invoices.ts';
import { orderLifecycle } from '../domain/lifecycle.ts';
import {
  INVOICE_PAYMENT_CHANNELS,
  INVOICE_PAYMENT_METHODS,
  INVOICE_PAYMENT_STATUSES,
  INVOICE_STATUSES,
  invoicePayments,
  invoiceSequences,
  invoices,
  orderItems,
  orders,
} from '../schema.ts';
import { issueFor, loadOrderTx } from './checkout.ts';
import { releaseCreditTx } from './credit-notes.ts';

/**
 * Invoices, PO and pay later (M5.1d, P5-5). A pay-later order is registered at once (tickets
 * issued, the place sold) and waits in `awaiting_invoice` with its invoice; payments come by the
 * buyer's pay link (a checkout on the org's funds flow at the time, by verified webhook) or are
 * recorded by staff (check, wire: organizer-collected, the fee part becomes a receivable). When the
 * balance reaches zero the order is `paid` (`order.paid@1`, via `invoice`). Nothing here ever
 * cancels an unpaid registration: only the organizer voids an invoice, and only before anything
 * was paid.
 */

type Emit = (e: DomainEvent) => void;
type InvoiceRow = typeof invoices.$inferSelect;
type PaymentRow = typeof invoicePayments.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

/** Signed links to an invoice (M1.5f link rules; nothing secret stored). */
export const INVOICE_PURPOSE = 'orders.invoice';
export const invoiceToken = (invoiceId: string) => signLinkToken(INVOICE_PURPOSE, invoiceId);
export function invoiceIdFromToken(token: string): string {
  const id = verifyLinkToken(INVOICE_PURPOSE, token);
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found', 'This link is not valid');
  return id;
}

/** The buyer's page for an invoice (view, pay, PDF), on the event's public site. */
export const invoicePath = (eventSlug: string, invoiceId: string) =>
  `/events/${eventSlug}/invoice/${invoiceToken(invoiceId)}`;

/** Take the org's next invoice number (the counter row is locked until the transaction ends). */
async function nextInvoiceNumberTx(tx: TenantTx, ctx: Ctx): Promise<number> {
  const [row] = await tx
    .insert(invoiceSequences)
    .values({ orgId: requireOrg(ctx), lastNumber: 1 })
    .onConflictDoUpdate({
      target: invoiceSequences.orgId,
      set: { lastNumber: sql`${invoiceSequences.lastNumber} + 1`, updatedAt: ctx.now },
    })
    .returning({ n: invoiceSequences.lastNumber });
  if (!row) throw new DomainError('internal');
  return row.n;
}

async function moveOrderTx(
  tx: TenantTx,
  order: OrderRow,
  event: 'invoice' | 'payInvoice' | 'voidInvoice',
  now: Date,
  extra: Partial<typeof orders.$inferInsert> = {},
) {
  const to = orderLifecycle.next(order.status as (typeof orderLifecycle.states)[number], event);
  const [row] = await tx
    .update(orders)
    .set({ status: to, updatedAt: now, ...extra })
    .where(and(eq(orders.id, order.id), inArray(orders.status, [...orderLifecycle.from(event)])))
    .returning();
  if (!row) throw new DomainError('conflict', 'The order changed meanwhile');
  return row;
}

export async function invoiceOfOrderTx(tx: TenantTx, orderId: string, forUpdate = false) {
  const q = tx.select().from(invoices).where(eq(invoices.orderId, orderId));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}

async function lockInvoiceTx(tx: TenantTx, invoiceId: string): Promise<InvoiceRow> {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
  if (!row) throw new DomainError('not_found', 'Invoice not found');
  return row;
}

export const IssueInvoiceInput = z.object({
  poNumber: z
    .string()
    .max(60)
    .nullish()
    .transform((v) => normalizePoNumber(v)),
  billingCompany: z
    .string()
    .max(120)
    .nullish()
    .transform((v) => (v ?? '').trim().replace(/\s+/g, ' ') || null),
});

/**
 * Turn a just-reserved order into a pay-later order with its invoice, inside the caller's checkout
 * transaction (registration, M5.1d): the held stock is sold, the tickets are issued and marked
 * `payment_due`, and the invoice takes the org's next number with the default terms (Net 30, due
 * no later than 7 days before the event). No money moves, so the ledger is untouched until a
 * payment arrives. Emits `order.invoiced@1`.
 */
export async function issueInvoiceTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  input: { orderId: string; poNumber: string | null; billingCompany: string | null },
): Promise<InvoiceRow> {
  const order = await loadOrderTx(tx, input.orderId, true);
  if (order.status !== 'reserved')
    throw new DomainError('invalid_state', 'Only a new order can be invoiced', { reason: 'order_not_new' });
  if (order.totalMinor <= 0)
    throw new DomainError('invalid_state', 'There is nothing to invoice', { reason: 'nothing_to_invoice' });
  if (order.seatUuids.length > 0)
    throw new DomainError('validation_failed', 'Seated orders are paid at checkout', { reason: 'seated' });
  const event = await findEventTx(tx, order.eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const terms = invoiceTerms({ issuedAt: ctx.now, eventStart: event.startsAt, timeZone: event.timezone });
  await sellHeldTx(
    tx,
    order.items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
  );
  const row = await moveOrderTx(tx, order, 'invoice', ctx.now, { expiresAt: null });
  await issueFor(tx, ctx, row, order.items);
  await setOrderPaymentDueTx(tx, order.id, true, ctx.now);
  const number = await nextInvoiceNumberTx(tx, ctx);
  const [invoice] = await tx
    .insert(invoices)
    .values({
      orgId: requireOrg(ctx),
      orderId: order.id,
      eventId: order.eventId,
      number,
      poNumber: normalizePoNumber(input.poNumber),
      billingCompany: input.billingCompany,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      currency: order.currency,
      totalMinor: order.totalMinor,
      feeMinor: order.feeMinor,
      terms: DEFAULT_TERMS,
      issuedOn: terms.issuedOn,
      dueOn: terms.dueOn,
      dueAt: terms.dueAt,
      issuedBy: actorId(ctx.actor),
    })
    .returning();
  if (!invoice) throw new DomainError('internal');
  emit({
    type: 'order.invoiced',
    version: 1,
    aggregateType: 'order',
    aggregateId: order.id,
    payload: {
      orgId: invoice.orgId,
      orderId: order.id,
      eventId: order.eventId,
      invoiceId: invoice.id,
      totalMinor: invoice.totalMinor,
      currency: invoice.currency,
      dueAt: invoice.dueAt.toISOString(),
    },
  });
  return invoice;
}

/**
 * A payment succeeded (webhook or staff): it counts towards the invoice, posts to the ledger and,
 * when nothing is left to pay, the invoice is paid, its tickets lose the balance flag and the order
 * becomes `paid` (`order.paid@1`, via `invoice`). A payment that arrives after the invoice was
 * voided (a pay link opened before the void) is still recorded: the money was taken, and the
 * organizer sees it on the order to refund.
 */
async function completePaymentTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  invoice: InvoiceRow,
  payment: PaymentRow,
  feePart: number,
) {
  const left = Math.max(0, invoice.feeMinor - invoice.feeAllocatedMinor);
  await tx
    .update(invoicePayments)
    .set({ status: 'succeeded', feePartMinor: feePart, completedAt: ctx.now, updatedAt: ctx.now })
    .where(eq(invoicePayments.id, payment.id));
  const paid = invoice.paidMinor + payment.amountMinor;
  const settles = invoice.status === 'open' && paid >= invoice.totalMinor;
  const [updated] = await tx
    .update(invoices)
    .set({
      paidMinor: paid,
      feeAllocatedMinor: invoice.feeAllocatedMinor + Math.min(feePart, left),
      ...(settles ? { status: 'paid', paidAt: ctx.now } : {}),
      updatedAt: ctx.now,
    })
    .where(eq(invoices.id, invoice.id))
    .returning();
  if (!updated) throw new DomainError('internal');
  await postInvoicePaymentTx(tx, ctx, {
    paymentId: payment.id,
    invoiceId: invoice.id,
    orderId: invoice.orderId,
    eventId: invoice.eventId,
    channel: payment.channel as 'pay_link' | 'offline',
    fundsFlow: (payment.fundsFlow as FundsFlow | null) ?? null,
    amountMinor: payment.amountMinor,
    feePartMinor: feePart,
    currency: payment.currency,
  });
  emit({
    type: 'order.invoice_payment_recorded',
    version: 1,
    aggregateType: 'order',
    aggregateId: invoice.orderId,
    payload: {
      orgId: invoice.orgId,
      orderId: invoice.orderId,
      eventId: invoice.eventId,
      invoiceId: invoice.id,
      paymentId: payment.id,
      channel: payment.channel,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      balanceMinor: balanceMinor(updated),
    },
  });
  if (settles) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, invoice.orderId)).for('update');
    if (!order) throw new DomainError('internal');
    await moveOrderTx(tx, order, 'payInvoice', ctx.now, { paidAt: ctx.now });
    await setOrderPaymentDueTx(tx, order.id, false, ctx.now);
    emit({
      type: 'order.paid',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: {
        orgId: order.orgId,
        orderId: order.id,
        eventId: order.eventId,
        totalMinor: order.totalMinor,
        currency: order.currency,
        via: 'invoice',
      },
    });
  }
  return updated;
}

/* ------------------------------------------------------------------------- pay link ---- */

export const StartInvoicePaymentResultDto = z.object({
  paymentId: z.uuid(),
  orderId: z.uuid(),
  amountMinor: z.int(),
  currency: z.string(),
  fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
  connectedAccountId: z.string().nullable(),
  applicationFeeMinor: z.int().nonnegative(),
  buyerEmail: z.string(),
  eventName: z.string(),
  label: z.string(),
});

/**
 * The buyer's pay link (public; the invoice's signed link): a card payment of 1 … the balance on
 * the org's funds flow as it is now. Idempotent (Idempotency-Key required): replaying the same
 * pay request returns the same pending payment, whose provider payment is created with the key
 * `invoice_payment:<paymentId>`, so a double submit or a retried request never charges twice.
 */
export const startInvoicePaymentCommand = tenantCommand({
  name: 'orders.startInvoicePayment',
  idempotent: true,
  input: z.object({ token: z.string().min(10).max(200), amountMinor: z.int().min(1).max(100_000_000) }),
  output: StartInvoicePaymentResultDto,
  entitlement: 'ticketing',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx }) => {
    const invoice = await lockInvoiceTx(tx, invoiceIdFromToken(input.token));
    if (invoice.status !== 'open')
      throw new DomainError('invalid_state', 'This invoice is not open', {
        reason: `invoice_${invoice.status}`,
      });
    const problem = payAmountProblem(input.amountMinor, balanceMinor(invoice));
    if (problem)
      throw new DomainError('validation_failed', 'The amount is not valid', {
        reason: problem,
        field: 'amount',
        balanceMinor: balanceMinor(invoice),
      });
    const flow = await fundsFlowTx(tx);
    const fee = feePartMinor({ ...invoice, amountMinor: input.amountMinor });
    const [payment] = await tx
      .insert(invoicePayments)
      .values({
        orgId: requireOrg(ctx),
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        channel: 'pay_link',
        method: 'card',
        status: 'pending',
        amountMinor: input.amountMinor,
        // organizer_mor: the application fee charged with this payment (kept as its fee part).
        feePartMinor: fee,
        currency: invoice.currency,
        idempotencyKey: `pay_link:${ctx.idempotencyKey}`,
        fundsFlow: flow.fundsFlow,
        connectedAccountId: flow.accountId,
        recordedBy: actorId(ctx.actor),
      })
      .returning();
    if (!payment) throw new DomainError('internal');
    const event = await findEventTx(tx, invoice.eventId);
    return {
      paymentId: payment.id,
      orderId: invoice.orderId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      fundsFlow: flow.fundsFlow,
      connectedAccountId: flow.accountId,
      applicationFeeMinor: flow.fundsFlow === 'organizer_mor' ? fee : 0,
      buyerEmail: invoice.buyerEmail,
      eventName: event?.name ?? '',
      label: formatInvoiceNumber(invoice.number),
    };
  },
  audit: (input, r) => ({
    action: 'order.invoice.pay_link',
    targetType: 'order',
    targetId: r.orderId,
    data: { paymentId: r.paymentId, amountMinor: input.amountMinor },
  }),
});

/** Record the provider payment of a pay-link attempt (once; the same id again changes nothing). */
export const attachInvoicePaymentCommand = tenantCommand({
  name: 'orders.attachInvoicePayment',
  input: z.object({
    paymentId: z.uuid(),
    provider: z.enum(['fake', 'stripe']),
    providerPaymentId: z.string().min(1).max(255),
  }),
  output: z.object({ attached: z.boolean() }),
  entitlement: 'ticketing',
  permission: 'public:checkout',
  handler: async ({ input, tx, ctx }) => {
    const [p] = await tx
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.id, input.paymentId))
      .for('update');
    if (p?.channel !== 'pay_link') throw new DomainError('not_found', 'Payment not found');
    if (p.providerPaymentId === input.providerPaymentId && p.provider === input.provider)
      return { attached: false };
    if (p.providerPaymentId || p.status !== 'pending')
      throw new DomainError('conflict', 'This payment already started', { reason: 'payment_started' });
    await tx
      .update(invoicePayments)
      .set({ provider: input.provider, providerPaymentId: input.providerPaymentId, updatedAt: ctx.now })
      .where(eq(invoicePayments.id, p.id));
    return { attached: true };
  },
  audit: (input) => ({
    action: 'order.invoice.payment_attached',
    targetType: 'invoice_payment',
    targetId: input.paymentId,
    data: { provider: input.provider },
  }),
});

/**
 * A verified provider event for an invoice's pay link (called by `orders.applyProviderEvent`,
 * after the event id was claimed): matched to its pending payment by provider payment id, amount
 * and currency. A failure marks the attempt failed; a success completes it.
 */
export async function applyInvoiceProviderEventTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  order: OrderRow,
  e: ProviderEvent,
): Promise<{ outcome: 'applied' | 'ignored'; status: string }> {
  const [payment] = await tx
    .select()
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.provider, e.provider),
        eq(invoicePayments.providerPaymentId, e.providerPaymentId),
      ),
    )
    .for('update');
  if (
    !payment ||
    payment.orderId !== order.id ||
    payment.amountMinor !== e.amountMinor ||
    payment.currency !== e.currency
  )
    throw new DomainError('conflict', 'Provider event does not match the invoice payment');
  if (payment.status !== 'pending') return { outcome: 'ignored', status: order.status };
  if (e.type === 'payment.failed') {
    await tx
      .update(invoicePayments)
      .set({ status: 'failed', completedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(invoicePayments.id, payment.id));
    return { outcome: 'applied', status: order.status };
  }
  const invoice = await lockInvoiceTx(tx, payment.invoiceId);
  // platform_mor: the fee part follows what has been paid so far; organizer_mor: it is the
  // application fee the provider actually collected with this charge.
  const fee =
    payment.fundsFlow === 'organizer_mor'
      ? payment.feePartMinor
      : feePartMinor({ ...invoice, amountMinor: payment.amountMinor });
  await completePaymentTx(tx, ctx, emit, invoice, payment, fee);
  const [now] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id));
  return { outcome: 'applied', status: now?.status ?? order.status };
}

/* ------------------------------------------------------------------- staff actions ---- */

export const OFFLINE_METHODS = ['check', 'wire', 'cash', 'other'] as const;

/**
 * Record a payment staff received (check, wire, cash): organizer-collected, so the fee part
 * becomes an org receivable (as box-office sales). Finance roles only (`orders:refund`), money
 * category (refused while staff act as a member), idempotent (Idempotency-Key), audited with the
 * reference.
 */
export const recordInvoicePaymentCommand = tenantCommand({
  name: 'orders.recordInvoicePayment',
  category: 'money',
  idempotent: true,
  input: z.object({
    orderId: z.uuid(),
    amountMinor: z.int().min(1).max(100_000_000),
    method: z.enum(OFFLINE_METHODS),
    reference: z
      .string()
      .max(80)
      .nullish()
      .transform((v) => (v ?? '').trim() || null),
    receivedOn: z.iso.date(),
    note: z
      .string()
      .max(500)
      .nullish()
      .transform((v) => (v ?? '').trim() || null),
  }),
  output: z.object({
    paymentId: z.uuid(),
    invoiceId: z.uuid(),
    status: z.enum(INVOICE_STATUSES),
    paidMinor: z.int(),
    balanceMinor: z.int(),
  }),
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx, emit }) => {
    const found = await invoiceOfOrderTx(tx, input.orderId);
    if (!found) throw new DomainError('not_found', 'Invoice not found');
    const invoice = await lockInvoiceTx(tx, found.id);
    if (invoice.status !== 'open')
      throw new DomainError('invalid_state', 'This invoice is not open', {
        reason: `invoice_${invoice.status}`,
      });
    const event = await findEventTx(tx, invoice.eventId);
    if (input.receivedOn > localDay(ctx.now, event?.timezone ?? 'UTC'))
      throw new DomainError('validation_failed', 'The date is in the future', {
        reason: 'date_in_future',
        field: 'receivedOn',
      });
    const problem = payAmountProblem(input.amountMinor, balanceMinor(invoice));
    if (problem)
      throw new DomainError('validation_failed', 'The amount is not valid', {
        reason: problem,
        field: 'amount',
        balanceMinor: balanceMinor(invoice),
      });
    const fee = feePartMinor({ ...invoice, amountMinor: input.amountMinor });
    const [payment] = await tx
      .insert(invoicePayments)
      .values({
        orgId: requireOrg(ctx),
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        channel: 'offline',
        method: input.method,
        status: 'succeeded',
        amountMinor: input.amountMinor,
        feePartMinor: fee,
        completedAt: ctx.now,
        currency: invoice.currency,
        idempotencyKey: `offline:${ctx.idempotencyKey}`,
        reference: input.reference,
        note: input.note,
        receivedOn: input.receivedOn,
        recordedBy: actorId(ctx.actor),
      })
      .returning();
    if (!payment) throw new DomainError('internal');
    const updated = await completePaymentTx(tx, ctx, emit, invoice, payment, fee);
    return {
      paymentId: payment.id,
      invoiceId: invoice.id,
      status: updated.status as (typeof INVOICE_STATUSES)[number],
      paidMinor: updated.paidMinor,
      balanceMinor: balanceMinor(updated),
    };
  },
  audit: (input, r) => ({
    action: 'order.invoice.payment_recorded',
    targetType: 'order',
    targetId: input.orderId,
    data: {
      paymentId: r.paymentId,
      method: input.method,
      amountMinor: input.amountMinor,
      reference: input.reference,
      receivedOn: input.receivedOn,
      balanceMinor: r.balanceMinor,
    },
  }),
});

/**
 * Void an unpaid invoice (the organizer's decision; never automatic): the order becomes `void`, its
 * tickets are voided (stock and the registration place go back) and the store credit or promo use
 * it took is returned. Refused once anything was paid. Finance roles, money category, audited
 * with the reason. Emits `tickets.cancelled@1` and `order.voided@1`.
 */
export const voidInvoiceCommand = tenantCommand({
  name: 'orders.voidInvoice',
  category: 'money',
  input: z.object({ orderId: z.uuid(), reason: z.string().trim().min(3).max(500) }),
  output: z.object({ invoiceId: z.uuid(), status: z.enum(INVOICE_STATUSES) }),
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx, emit }) => {
    const found = await invoiceOfOrderTx(tx, input.orderId);
    if (!found) throw new DomainError('not_found', 'Invoice not found');
    const invoice = await lockInvoiceTx(tx, found.id);
    if (invoice.status !== 'open')
      throw new DomainError('invalid_state', 'This invoice is not open', {
        reason: `invoice_${invoice.status}`,
      });
    if (invoice.paidMinor > 0)
      throw new DomainError('invalid_state', 'Payments were recorded on this invoice', {
        reason: 'has_payments',
      });
    const order = await loadOrderTx(tx, invoice.orderId, true);
    await tx
      .update(invoices)
      .set({ status: 'void', voidedAt: ctx.now, voidReason: input.reason, updatedAt: ctx.now })
      .where(eq(invoices.id, invoice.id));
    await moveOrderTx(tx, order, 'voidInvoice', ctx.now, { cancelledAt: ctx.now });
    const live = (await ticketsForOrderTx(tx, order.id)).filter((t) => t.status === 'active');
    const voided = await voidTicketsTx(tx, ctx, {
      orderId: order.id,
      ticketIds: live.map((t) => t.id),
      reason: 'cancelled',
    });
    await setOrderPaymentDueTx(tx, order.id, false, ctx.now);
    if (order.promoCodeId) await releasePromoTx(tx, order.promoCodeId);
    await releaseCreditTx(tx, ctx, order.id);
    if (voided.length)
      emit({
        type: 'tickets.cancelled',
        version: 1,
        aggregateType: 'order',
        aggregateId: order.id,
        payload: {
          orgId: order.orgId,
          eventId: order.eventId,
          orderId: order.id,
          ticketIds: voided.map((t) => t.id),
        },
      });
    emit({
      type: 'order.voided',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: { orgId: order.orgId, orderId: order.id, eventId: order.eventId, invoiceId: invoice.id },
    });
    return { invoiceId: invoice.id, status: 'void' as const };
  },
  audit: (input, r) => ({
    action: 'order.invoice.void',
    targetType: 'order',
    targetId: input.orderId,
    data: { invoiceId: r.invoiceId, reason: input.reason },
  }),
});

/* ------------------------------------------------------------------------- reads ---- */

export const InvoicePaymentDto = z.object({
  id: z.uuid(),
  channel: z.enum(INVOICE_PAYMENT_CHANNELS),
  method: z.enum(INVOICE_PAYMENT_METHODS),
  status: z.enum(INVOICE_PAYMENT_STATUSES),
  amountMinor: z.int(),
  feePartMinor: z.int(),
  currency: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  receivedOn: z.string().nullable(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});
export type InvoicePaymentDto = z.infer<typeof InvoicePaymentDto>;

export const InvoiceDto = z.object({
  id: z.uuid(),
  number: z.int(),
  /** INV-00001 */
  label: z.string(),
  orderId: z.uuid(),
  eventId: z.uuid(),
  status: z.enum(INVOICE_STATUSES),
  overdue: z.boolean(),
  poNumber: z.string().nullable(),
  billingCompany: z.string().nullable(),
  buyerName: z.string(),
  buyerEmail: z.string(),
  currency: z.string(),
  totalMinor: z.int(),
  paidMinor: z.int(),
  balanceMinor: z.int(),
  feeMinor: z.int(),
  feeAllocatedMinor: z.int(),
  issuedOn: z.string(),
  dueOn: z.string(),
  paidAt: z.date().nullable(),
  voidedAt: z.date().nullable(),
  voidReason: z.string().nullable(),
  /** Payments that came after the invoice was voided (to refund). */
  paidAfterVoidMinor: z.int(),
  createdAt: z.date(),
});
export type InvoiceDto = z.infer<typeof InvoiceDto>;

const present = (r: InvoiceRow, timeZone: string, now: Date): InvoiceDto => ({
  id: r.id,
  number: r.number,
  label: formatInvoiceNumber(r.number),
  orderId: r.orderId,
  eventId: r.eventId,
  status: r.status as InvoiceDto['status'],
  overdue: isOverdue(r, now, timeZone),
  poNumber: r.poNumber,
  billingCompany: r.billingCompany,
  buyerName: r.buyerName,
  buyerEmail: r.buyerEmail,
  currency: r.currency,
  totalMinor: r.totalMinor,
  paidMinor: r.paidMinor,
  balanceMinor: r.status === 'void' ? 0 : balanceMinor(r),
  feeMinor: r.feeMinor,
  feeAllocatedMinor: r.feeAllocatedMinor,
  issuedOn: r.issuedOn,
  dueOn: r.dueOn,
  paidAt: r.paidAt,
  voidedAt: r.voidedAt,
  voidReason: r.voidReason,
  paidAfterVoidMinor: r.status === 'void' ? r.paidMinor : 0,
  createdAt: r.createdAt,
});

const presentPayment = (p: PaymentRow): InvoicePaymentDto => ({
  id: p.id,
  channel: p.channel as InvoicePaymentDto['channel'],
  method: p.method as InvoicePaymentDto['method'],
  status: p.status as InvoicePaymentDto['status'],
  amountMinor: p.amountMinor,
  feePartMinor: p.feePartMinor,
  currency: p.currency,
  reference: p.reference,
  note: p.note,
  receivedOn: p.receivedOn,
  createdAt: p.createdAt,
  completedAt: p.completedAt,
});

export const OrderInvoiceDto = InvoiceDto.extend({ payments: z.array(InvoicePaymentDto) });

/** The invoice of an order, with its payments (console; null when the order has none). */
export const orderInvoiceQuery = tenantQuery({
  name: 'orders.orderInvoice',
  input: z.object({ orderId: z.uuid() }),
  output: OrderInvoiceDto.nullable(),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const inv = await invoiceOfOrderTx(tx, input.orderId);
    if (!inv) return null;
    const event = await findEventTx(tx, inv.eventId);
    const payments = await tx
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, inv.id))
      .orderBy(asc(invoicePayments.createdAt));
    return {
      ...present(inv, event?.timezone ?? 'UTC', ctx.now),
      payments: payments.filter((p) => p.status !== 'pending' || p.channel === 'offline').map(presentPayment),
    };
  },
});

export const INVOICE_FILTERS = ['all', 'open', 'overdue', 'paid', 'void'] as const;

/** An event's invoices for the console list (newest first), filtered by status. */
export const eventInvoicesQuery = tenantQuery({
  name: 'orders.eventInvoices',
  input: z.object({
    eventId: z.uuid(),
    filter: z.enum(INVOICE_FILTERS).default('all'),
    limit: z.int().min(1).max(500).default(200),
  }),
  output: z.array(InvoiceDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const status =
      input.filter === 'all'
        ? undefined
        : eq(invoices.status, input.filter === 'overdue' ? 'open' : input.filter);
    const rows = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.eventId, event.id), status))
      .orderBy(desc(invoices.number))
      .limit(input.limit);
    const out = rows.map((r) => present(r, event.timezone, ctx.now));
    return input.filter === 'overdue' ? out.filter((r) => r.overdue) : out;
  },
});

export const InvoiceDocumentDto = InvoiceDto.extend({
  eventName: z.string(),
  eventSlug: z.string(),
  eventTimezone: z.string(),
  eventStartsAt: z.date(),
  lines: z.array(z.object({ name: z.string(), quantity: z.int(), unitMinor: z.int(), totalMinor: z.int() })),
  payments: z.array(InvoicePaymentDto),
});
export type InvoiceDocumentDto = z.infer<typeof InvoiceDocumentDto>;

/** Everything the invoice document (PDF and the buyer's page) shows. */
export async function invoiceDocumentTx(
  tx: TenantTx,
  invoiceId: string,
  now: Date,
): Promise<InvoiceDocumentDto> {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new DomainError('not_found', 'Invoice not found');
  const event = await findEventTx(tx, inv.eventId);
  if (!event) throw new DomainError('not_found', 'Invoice not found');
  const items = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, inv.orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
  const payments = await tx
    .select()
    .from(invoicePayments)
    .where(and(eq(invoicePayments.invoiceId, inv.id), eq(invoicePayments.status, 'succeeded')))
    .orderBy(asc(invoicePayments.completedAt));
  return InvoiceDocumentDto.parse({
    ...present(inv, event.timezone, now),
    eventName: event.name,
    eventSlug: event.slug,
    eventTimezone: event.timezone,
    eventStartsAt: event.startsAt,
    lines: items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitMinor: i.unitAllInMinor,
      totalMinor: i.unitAllInMinor * i.quantity,
    })),
    payments: payments.map(presentPayment),
  });
}

/** The invoice document for the console (PDF route). */
export const invoiceDocumentQuery = tenantQuery({
  name: 'orders.invoiceDocument',
  input: z.object({ orderId: z.uuid() }),
  output: InvoiceDocumentDto,
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const inv = await invoiceOfOrderTx(tx, input.orderId);
    if (!inv) throw new DomainError('not_found', 'Invoice not found');
    return invoiceDocumentTx(tx, inv.id, ctx.now);
  },
});

/** The buyer's view of an invoice (public, by its signed link; the org from the event's slug). */
export const PublicInvoiceDto = InvoiceDocumentDto.omit({
  feeMinor: true,
  feeAllocatedMinor: true,
  voidReason: true,
  paidAfterVoidMinor: true,
}).extend({
  payments: z.array(
    InvoicePaymentDto.pick({
      id: true,
      method: true,
      amountMinor: true,
      currency: true,
      receivedOn: true,
      completedAt: true,
    }),
  ),
});
export type PublicInvoiceDto = z.infer<typeof PublicInvoiceDto>;

export async function publicInvoice(
  orgId: string,
  eventId: string,
  token: string,
): Promise<PublicInvoiceDto> {
  const id = invoiceIdFromToken(token);
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'orders.public-invoice' } });
  const doc = await withTenant(ctx, (tx) => invoiceDocumentTx(tx, id, ctx.now));
  if (doc.eventId !== eventId) throw new DomainError('not_found', 'This link is not valid');
  return PublicInvoiceDto.parse(doc);
}

/**
 * What an invoice reminder says (M5.1d journeys): the label, what is still due, when, and whether
 * it is still open. Null when the order has no invoice.
 */
export async function invoiceFactsTx(tx: TenantTx, orderId: string) {
  const inv = await invoiceOfOrderTx(tx, orderId);
  if (!inv) return null;
  return {
    invoiceId: inv.id,
    label: formatInvoiceNumber(inv.number),
    status: inv.status as (typeof INVOICE_STATUSES)[number],
    balanceMinor: balanceMinor(inv),
    currency: inv.currency,
    dueOn: inv.dueOn,
  };
}
