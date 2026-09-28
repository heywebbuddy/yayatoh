import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, type Ctx, DomainError, type DomainEvent, isDomainError, requireOrg } from '@yayatoh/kernel';
import { openDisputeOrderIdsTx, refundJournalTotalsTx } from '@yayatoh/payments';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { liveTicketsByOrderItemTx, ticketsForOrderTx } from '@yayatoh/ticketing';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { type CancellationPreview, cancellationPreview, type PreviewOrder } from '../domain/mass-refund.ts';
import {
  MASS_REFUND_ITEM_STATUSES,
  MASS_REFUND_STATUSES,
  massRefundItems,
  massRefunds,
  orderItems,
  orders,
  refunds,
} from '../schema.ts';
import { computeTx, insertRefundTx } from './refunds.ts';

const SOLD = ['paid', 'partially_refunded'] as const;
const MASS_REASONS = ['event_cancelled', 'event_postponed'] as const;
type MassReason = (typeof MASS_REASONS)[number];

/** The event's sold orders with what each would get back (the preview's input). */
async function previewOrdersTx(tx: TenantTx, eventId: string): Promise<PreviewOrder[]> {
  const rows = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.eventId, eventId), inArray(orders.status, [...SOLD])));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const refunded = new Map(
    (
      await tx
        .select({ orderId: refunds.orderId, sum: sql<string>`sum(${refunds.amountMinor})::text` })
        .from(refunds)
        .where(and(inArray(refunds.orderId, ids), inArray(refunds.status, ['pending', 'succeeded'])))
        .groupBy(refunds.orderId)
    ).map((r) => [r.orderId, Number(r.sum)]),
  );
  const items = new Map(
    (await tx.select().from(orderItems).where(inArray(orderItems.orderId, ids))).map((i) => [i.id, i]),
  );
  const live = new Map<string, PreviewOrder['live'][number][]>();
  for (const l of await liveTicketsByOrderItemTx(tx, eventId)) {
    const item = items.get(l.orderItemId);
    if (!item) continue;
    const list = live.get(l.orderId) ?? [];
    list.push({ count: l.count, unitAllInMinor: item.unitAllInMinor, unitFeeMinor: item.unitFeeMinor });
    live.set(l.orderId, list);
  }
  const disputed = await openDisputeOrderIdsTx(tx, { eventId });
  return rows.map((o) => ({
    id: o.id,
    fundsFlow: o.fundsFlow as PreviewOrder['fundsFlow'],
    collectedBy: o.collectedBy as PreviewOrder['collectedBy'],
    status: o.status,
    totalMinor: o.totalMinor,
    feeMinor: o.feeMinor,
    refundedMinor: refunded.get(o.id) ?? 0,
    disputed: disputed.has(o.id),
    live: live.get(o.id) ?? [],
  }));
}

const Totals = z.object({
  orders: z.int(),
  amountMinor: z.int(),
  feeBackMinor: z.int(),
  organizerMinor: z.int(),
});

export const CancellationPreviewDto = z.object({
  currency: z.string(),
  eventStatus: z.string(),
  orders: z.int(),
  grossMinor: z.int(),
  feesMinor: z.int(),
  alreadyRefundedMinor: z.int(),
  refund: Totals,
  byFlow: z.object({ organizer_mor: Totals, platform_mor: Totals }),
  disputed: z.object({ orders: z.int(), grossMinor: z.int() }),
  organizerCollected: z.object({ orders: z.int(), grossMinor: z.int() }),
  nothingLeft: z.int(),
});
export type CancellationPreviewDto = z.infer<typeof CancellationPreviewDto>;

/**
 * The cancel/postpone wizard's financial preview (M3.10b): orders, gross, fees, what refunding
 * everyone would give back per funds flow, and what is left out (open chargebacks, money the
 * organizer collected). Nothing moves.
 */
export const cancellationPreviewQuery = tenantQuery({
  name: 'orders.cancellationPreview',
  input: z.object({ eventId: z.uuid() }),
  output: CancellationPreviewDto,
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const p: CancellationPreview = cancellationPreview(await previewOrdersTx(tx, event.id));
    return { ...p, currency: event.currency, eventStatus: event.status };
  },
});

export const MassRefundDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  reason: z.enum(MASS_REASONS),
  status: z.enum(MASS_REFUND_STATUSES),
  currency: z.string(),
  total: z.int(),
  processed: z.int(),
  refunded: z.int(),
  skippedDisputed: z.int(),
  skipped: z.int(),
  failed: z.int(),
  refundedMinor: z.int(),
  createdAt: z.date(),
  pausedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  /** Set once finished: the ledger moved exactly what the refunds gave back. */
  reconciliation: z
    .object({
      reconciled: z.boolean(),
      ledgerCashMinor: z.int(),
      expectedCashMinor: z.int(),
      receivableMinor: z.int(),
      at: z.date(),
    })
    .nullable(),
  /** Orders skipped or failed, with why (first 100), for the organizer to follow up. */
  exceptions: z.array(
    z.object({
      orderId: z.uuid(),
      buyerName: z.string(),
      status: z.enum(MASS_REFUND_ITEM_STATUSES),
      code: z.string().nullable(),
    }),
  ),
});
export type MassRefundDto = z.infer<typeof MassRefundDto>;

type Run = typeof massRefunds.$inferSelect;

async function presentRunTx(tx: TenantTx, run: Run): Promise<MassRefundDto> {
  const exceptions = await tx
    .select({
      orderId: massRefundItems.orderId,
      buyerName: orders.buyerName,
      status: massRefundItems.status,
      code: massRefundItems.code,
    })
    .from(massRefundItems)
    .innerJoin(orders, eq(orders.id, massRefundItems.orderId))
    .where(
      and(
        eq(massRefundItems.runId, run.id),
        inArray(massRefundItems.status, ['skipped_disputed', 'skipped', 'failed']),
      ),
    )
    .orderBy(asc(massRefundItems.position))
    .limit(100);
  return {
    id: run.id,
    eventId: run.eventId,
    reason: run.reason as MassReason,
    status: run.status as MassRefundDto['status'],
    currency: run.currency,
    total: run.total,
    processed: run.processed,
    refunded: run.refunded,
    skippedDisputed: run.skippedDisputed,
    skipped: run.skipped,
    failed: run.failed,
    refundedMinor: run.refundedMinor,
    createdAt: run.createdAt,
    pausedAt: run.pausedAt,
    finishedAt: run.finishedAt,
    reconciliation:
      run.reconciledAt && run.reconciled !== null
        ? {
            reconciled: run.reconciled,
            ledgerCashMinor: run.ledgerCashMinor ?? 0,
            expectedCashMinor: run.expectedCashMinor ?? 0,
            receivableMinor: run.receivableMinor ?? 0,
            at: run.reconciledAt,
          }
        : null,
    exceptions: exceptions.map((e) => ({
      ...e,
      status: e.status as MassRefundDto['exceptions'][number]['status'],
    })),
  };
}

async function loadRunTx(tx: TenantTx, runId: string, lock = false) {
  const q = tx.select().from(massRefunds).where(eq(massRefunds.id, runId));
  const [run] = await (lock ? q.for('update') : q);
  if (!run) throw new DomainError('not_found', 'Mass refund not found');
  return run;
}

/**
 * Refund every paid order of a cancelled event (M3.10b), in a resumable batch: the orders are
 * snapshotted as items now, oldest first, and the `orders.mass-refund` job refunds them one by one
 * (the platform minimum: face and fee back). One run at a time per event. Moving this much money
 * needs a fresh step-up.
 */
export const startMassRefundCommand = tenantCommand({
  name: 'orders.startMassRefund',
  category: 'money',
  input: z.object({ eventId: z.uuid(), reason: z.enum(MASS_REASONS).default('event_cancelled') }),
  output: z.object({ runId: z.uuid(), total: z.int() }),
  entitlement: 'ticketing',
  permission: 'orders:refund',
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const needed = input.reason === 'event_cancelled' ? 'cancelled' : 'postponed';
    if (event.status !== needed)
      throw new DomainError('invalid_state', `The event must be ${needed} first`, {
        reason: `not_${needed}`,
      });
    const [live] = await tx
      .select({ id: massRefunds.id })
      .from(massRefunds)
      .where(and(eq(massRefunds.eventId, event.id), inArray(massRefunds.status, ['running', 'paused'])));
    if (live)
      throw new DomainError('conflict', 'A mass refund is already under way for this event', {
        reason: 'already_running',
        runId: live.id,
      });
    const sold = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(eq(orders.eventId, event.id), inArray(orders.status, [...SOLD]), sql`${orders.totalMinor} > 0`),
      )
      .orderBy(asc(orders.createdAt), asc(orders.id));
    const [run] = await tx
      .insert(massRefunds)
      .values({
        orgId,
        eventId: event.id,
        reason: input.reason,
        currency: event.currency,
        total: sold.length,
        requestedBy: actorId(ctx.actor),
        createdAt: ctx.now,
        updatedAt: ctx.now,
        ...(sold.length === 0 ? { status: 'done', finishedAt: ctx.now } : {}),
      })
      .returning({ id: massRefunds.id });
    if (!run) throw new DomainError('internal');
    for (let i = 0; i < sold.length; i += 1_000)
      await tx
        .insert(massRefundItems)
        .values(
          sold.slice(i, i + 1_000).map((o, k) => ({ orgId, runId: run.id, orderId: o.id, position: i + k })),
        );
    emit({
      type: 'order.mass_refund_started',
      version: 1,
      aggregateType: 'event',
      aggregateId: event.id,
      payload: { orgId, eventId: event.id, runId: run.id, total: sold.length, reason: input.reason },
    });
    return { runId: run.id, total: sold.length };
  },
  audit: (input, r) => ({
    action: 'event.mass_refund_start',
    targetType: 'event',
    targetId: input.eventId,
    data: { runId: r?.runId, total: r?.total, reason: input.reason },
  }),
});

function pauseOrResume(to: 'paused' | 'running') {
  const from = to === 'paused' ? 'running' : 'paused';
  return tenantCommand({
    name: to === 'paused' ? 'orders.pauseMassRefund' : 'orders.resumeMassRefund',
    category: 'money',
    input: z.object({ runId: z.uuid() }),
    output: z.object({ status: z.enum(MASS_REFUND_STATUSES) }),
    entitlement: 'ticketing',
    permission: 'orders:refund',
    handler: async ({ input, ctx, tx }) => {
      const run = await loadRunTx(tx, input.runId, true);
      if (run.status === to) return { status: to };
      if (run.status !== from)
        throw new DomainError('invalid_state', 'This mass refund has finished', { reason: 'finished' });
      await tx
        .update(massRefunds)
        .set({ status: to, pausedAt: to === 'paused' ? ctx.now : null, updatedAt: ctx.now })
        .where(eq(massRefunds.id, run.id));
      return { status: to };
    },
    audit: (input) => ({
      action: to === 'paused' ? 'event.mass_refund_pause' : 'event.mass_refund_resume',
      targetType: 'mass_refund',
      targetId: input.runId,
    }),
  });
}

/** Pause a running mass refund: the job stops before the next order (the one in flight completes). */
export const pauseMassRefundCommand = pauseOrResume('paused');
/** Resume a paused mass refund where it stopped. */
export const resumeMassRefundCommand = pauseOrResume('running');

export const massRefundStatusQuery = tenantQuery({
  name: 'orders.massRefundStatus',
  input: z.object({ runId: z.uuid() }),
  output: MassRefundDto,
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, tx }) => presentRunTx(tx, await loadRunTx(tx, input.runId)),
});

/** An event's mass refunds, newest first. */
export const massRefundsQuery = tenantQuery({
  name: 'orders.massRefunds',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(MassRefundDto),
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, tx }) => {
    const runs = await tx
      .select()
      .from(massRefunds)
      .where(eq(massRefunds.eventId, input.eventId))
      .orderBy(sql`${massRefunds.createdAt} desc`)
      .limit(20);
    const out: MassRefundDto[] = [];
    for (const r of runs) out.push(await presentRunTx(tx, r));
    return out;
  },
});

// ——— The batch (system actor: the `orders.mass-refund` job and the dev runner) ———

const ProviderInstructions = z.object({
  refundId: z.uuid(),
  amountMinor: z.int(),
  feeRefundedMinor: z.int(),
  currency: z.string(),
  provider: z.object({
    providerPaymentId: z.string(),
    fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
    connectedAccountId: z.string().nullable(),
  }),
});

const StepOutput = z.discriminatedUnion('state', [
  /** Ask the provider for this refund (a new one, or one a crash left pending: same key). */
  z.object({ state: z.literal('refund'), itemId: z.uuid(), refund: ProviderInstructions }),
  /** An item was settled without the provider (skipped, or its refund had already completed). */
  z.object({ state: z.literal('settled'), itemId: z.uuid() }),
  /**
   * Paused; finished (and reconciled); or waiting: only refunds the provider is still completing
   * asynchronously are left (their webhook completes them).
   */
  z.object({ state: z.enum(['paused', 'done', 'waiting']) }),
]);
export type MassRefundStep = z.infer<typeof StepOutput>;

type ItemOutcome = {
  status: 'refunded' | 'skipped_disputed' | 'skipped' | 'failed';
  code?: string;
  amountMinor?: number;
};

/** Settle an item and count it on its run (once: a settled item never changes again). */
async function settleItemTx(tx: TenantTx, ctx: Ctx, runId: string, itemId: string, o: ItemOutcome) {
  const [item] = await tx
    .update(massRefundItems)
    .set({
      status: o.status,
      code: o.code ?? null,
      amountMinor: o.amountMinor ?? 0,
      updatedAt: ctx.now,
    })
    .where(and(eq(massRefundItems.id, itemId), eq(massRefundItems.status, 'pending')))
    .returning({ id: massRefundItems.id });
  if (!item) return;
  const n = (c: AnyPgColumn) => sql`${c} + 1`;
  await tx
    .update(massRefunds)
    .set({
      processed: n(massRefunds.processed),
      ...(o.status === 'refunded' ? { refunded: n(massRefunds.refunded) } : {}),
      ...(o.status === 'skipped_disputed' ? { skippedDisputed: n(massRefunds.skippedDisputed) } : {}),
      ...(o.status === 'skipped' ? { skipped: n(massRefunds.skipped) } : {}),
      ...(o.status === 'failed' ? { failed: n(massRefunds.failed) } : {}),
      refundedMinor: sql`${massRefunds.refundedMinor} + ${o.amountMinor ?? 0}`,
      updatedAt: ctx.now,
    })
    .where(eq(massRefunds.id, runId));
}

/**
 * Close a finished run and reconcile it (M3.10b acceptance): the cash the ledger moved for its
 * refunds must be exactly what they gave back (platform charges: the whole amount; direct
 * charges: only the platform's fee part), with one refund journal per refund, and the item
 * amounts must add up to the run's total. The organizer's debt from it (receivables, less
 * transfer reversals) is recorded with it.
 */
async function finishRunTx(tx: TenantTx, ctx: Ctx, run: Run, emit: (e: DomainEvent) => void) {
  const done = await tx
    .select({
      refundId: refunds.id,
      amountMinor: refunds.amountMinor,
      feeRefundedMinor: refunds.feeRefundedMinor,
      fundsFlow: orders.fundsFlow,
      itemAmountMinor: massRefundItems.amountMinor,
    })
    .from(massRefundItems)
    .innerJoin(refunds, eq(refunds.id, massRefundItems.refundId))
    .innerJoin(orders, eq(orders.id, massRefundItems.orderId))
    .where(
      and(
        eq(massRefundItems.runId, run.id),
        eq(massRefundItems.status, 'refunded'),
        eq(refunds.status, 'succeeded'),
      ),
    );
  const expectedCash = -done.reduce(
    (n, r) => n + (r.fundsFlow === 'platform_mor' ? r.amountMinor : r.feeRefundedMinor),
    0,
  );
  const journalsExpected = done.filter((r) =>
    r.fundsFlow === 'platform_mor' ? r.amountMinor > 0 : r.feeRefundedMinor > 0,
  ).length;
  const ledger = await refundJournalTotalsTx(
    tx,
    done.map((r) => r.refundId),
  );
  const [fresh] = await tx.select().from(massRefunds).where(eq(massRefunds.id, run.id));
  const itemsSum = done.reduce((n, r) => n + r.itemAmountMinor, 0);
  const reconciled =
    ledger.cashMinor === expectedCash &&
    ledger.journals === journalsExpected &&
    itemsSum === (fresh?.refundedMinor ?? -1) &&
    done.every((r) => r.itemAmountMinor === r.amountMinor) &&
    (fresh?.processed ?? -1) === run.total;
  await tx
    .update(massRefunds)
    .set({
      status: 'done',
      finishedAt: ctx.now,
      pausedAt: null,
      reconciledAt: ctx.now,
      reconciled,
      ledgerCashMinor: ledger.cashMinor,
      expectedCashMinor: expectedCash,
      receivableMinor: ledger.receivableMinor,
      updatedAt: ctx.now,
    })
    .where(eq(massRefunds.id, run.id));
  emit({
    type: 'order.mass_refund_finished',
    version: 1,
    aggregateType: 'event',
    aggregateId: run.eventId,
    payload: {
      orgId: run.orgId,
      eventId: run.eventId,
      runId: run.id,
      refunded: fresh?.refunded ?? 0,
      skippedDisputed: fresh?.skippedDisputed ?? 0,
      failed: fresh?.failed ?? 0,
      reconciled,
    },
  });
}

/**
 * One step of a mass refund (system only), in one tenant transaction: take the next pending
 * order (row locks keep two runners apart) and either settle it here (disputed → skipped;
 * organizer-collected or nothing left → skipped; its refund already completed → counted) or
 * record its refund and hand the provider instructions back. A refund recorded before a crash is
 * handed back again with the same id, so the provider (keyed `refund:<id>`) never refunds twice.
 * With nothing pending left, the run finishes and reconciles.
 */
export const nextMassRefundStepCommand = tenantCommand({
  name: 'orders.nextMassRefundStep',
  input: z.object({ runId: z.uuid() }),
  output: StepOutput,
  entitlement: 'ticketing',
  permission: 'platform:orders.mass_refund',
  handler: async ({ input, ctx, tx, emit }) => {
    const run = await loadRunTx(tx, input.runId, true);
    if (run.status !== 'running') return { state: run.status === 'done' ? 'done' : 'paused' } as const;
    // The next pending order, passing over refunds the provider is completing asynchronously.
    const [next] = await tx
      .select({ item: massRefundItems })
      .from(massRefundItems)
      .leftJoin(refunds, eq(refunds.id, massRefundItems.refundId))
      .where(
        and(
          eq(massRefundItems.runId, run.id),
          eq(massRefundItems.status, 'pending'),
          or(isNull(refunds.id), ne(refunds.status, 'pending'), isNull(refunds.providerRefundId)),
        ),
      )
      .orderBy(asc(massRefundItems.position))
      .limit(1)
      .for('update', { of: massRefundItems, skipLocked: true });
    const item = next?.item;
    if (!item) {
      const [waiting] = await tx
        .select({ id: massRefundItems.id })
        .from(massRefundItems)
        .where(and(eq(massRefundItems.runId, run.id), eq(massRefundItems.status, 'pending')))
        .limit(1);
      if (waiting) return { state: 'waiting' } as const;
      await finishRunTx(tx, ctx, run, emit);
      return { state: 'done' } as const;
    }
    const settle = async (o: ItemOutcome) => {
      await settleItemTx(tx, ctx, run.id, item.id, o);
      return { state: 'settled', itemId: item.id } as const;
    };
    if (item.refundId) {
      const [r] = await tx.select().from(refunds).where(eq(refunds.id, item.refundId));
      if (!r) throw new DomainError('internal', 'Mass refund item without its refund');
      if (r.status === 'succeeded') return settle({ status: 'refunded', amountMinor: r.amountMinor });
      if (r.status === 'failed') return settle({ status: 'failed', code: codeOf(r.failureCode) });
      const [o] = await tx.select().from(orders).where(eq(orders.id, r.orderId));
      if (!o?.providerPaymentId) throw new DomainError('internal');
      return {
        state: 'refund',
        itemId: item.id,
        refund: {
          refundId: r.id,
          amountMinor: r.amountMinor,
          feeRefundedMinor: r.feeRefundedMinor,
          currency: r.currency,
          provider: {
            providerPaymentId: o.providerPaymentId,
            fundsFlow: o.fundsFlow as 'organizer_mor' | 'platform_mor',
            connectedAccountId: o.connectedAccountId,
          },
        },
      } as const;
    }
    const [order] = await tx.select().from(orders).where(eq(orders.id, item.orderId)).for('update');
    if (!order) throw new DomainError('internal');
    // An open chargeback: refunding would pay the buyer twice (roadmap acceptance).
    if ((await openDisputeOrderIdsTx(tx, { orderIds: [order.id] })).has(order.id))
      return settle({ status: 'skipped_disputed', code: 'disputed' });
    if (order.collectedBy !== 'platform') return settle({ status: 'skipped', code: 'organizer_collected' });
    if (!(SOLD as readonly string[]).includes(order.status))
      return settle({ status: 'skipped', code: 'nothing_left' });
    const reason = run.reason as MassReason;
    const liveIds = (await ticketsForOrderTx(tx, order.id))
      .filter((t) => t.status === 'active')
      .map((t) => t.id);
    let computed: Awaited<ReturnType<typeof computeTx>>;
    try {
      computed = await tryCompute(tx, ctx, order.id, reason, liveIds);
    } catch (err) {
      if (!isDomainError(err)) throw err;
      const code = (err.details as { reason?: unknown } | undefined)?.reason;
      if (code === 'exceeds_refundable' || err.message === 'Nothing to refund')
        return settle({ status: 'skipped', code: 'nothing_left' });
      return settle({ status: 'failed', code: codeOf(typeof code === 'string' ? code : err.code) });
    }
    const started = await insertRefundTx(tx, ctx, computed.order, computed.c, {
      reason,
      note: undefined,
      requestedBy: run.requestedBy,
    });
    await tx
      .update(massRefundItems)
      .set({ refundId: started.refundId, updatedAt: ctx.now })
      .where(eq(massRefundItems.id, item.id));
    return {
      state: 'refund',
      itemId: item.id,
      refund: {
        refundId: started.refundId,
        amountMinor: started.amountMinor,
        feeRefundedMinor: started.feeRefundedMinor,
        currency: started.currency,
        provider: started.provider,
      },
    } as const;
  },
  audit: (input, r) => ({
    action: 'event.mass_refund_step',
    targetType: 'mass_refund',
    targetId: input.runId,
    data: { state: r.state, ...('itemId' in r ? { itemId: r.itemId } : {}) },
  }),
});

/** Whole live tickets back; when earlier refunds leave less than that, whatever is left as an amount. */
async function tryCompute(tx: TenantTx, ctx: Ctx, orderId: string, reason: MassReason, liveIds: string[]) {
  if (liveIds.length > 0) {
    try {
      return await computeTx(tx, ctx, { orderId, reason, ticketIds: liveIds }, false);
    } catch (err) {
      const why = isDomainError(err) ? (err.details as { reason?: unknown } | undefined)?.reason : undefined;
      if (why !== 'exceeds_refundable') throw err;
    }
  }
  const { c } = await computeTx(tx, ctx, { orderId, reason, amountMinor: 1 }, false);
  return computeTx(tx, ctx, { orderId, reason, amountMinor: c.refundableMinor }, false);
}

const codeOf = (c: string | null | undefined) => {
  const s = (c ?? 'failed')
    .toLowerCase()
    .replace(/[^a-z_]/g, '_')
    .slice(0, 60);
  return /^[a-z_]{1,60}$/.test(s) ? s : 'failed';
};

/**
 * After the provider answered and the refund was completed (`orders.completeRefund`): settle the
 * item from its refund's final status. A refund still pending at the provider (Stripe's
 * asynchronous refunds) leaves the item pending; the next step picks it up again.
 */
export const settleMassRefundItemCommand = tenantCommand({
  name: 'orders.settleMassRefundItem',
  input: z.object({ itemId: z.uuid() }),
  output: z.object({ status: z.enum(MASS_REFUND_ITEM_STATUSES) }),
  entitlement: 'ticketing',
  permission: 'platform:orders.mass_refund',
  handler: async ({ input, ctx, tx }) => {
    const [item] = await tx
      .select()
      .from(massRefundItems)
      .where(eq(massRefundItems.id, input.itemId))
      .for('update');
    if (!item) throw new DomainError('not_found');
    if (item.status !== 'pending' || !item.refundId)
      return { status: item.status as (typeof MASS_REFUND_ITEM_STATUSES)[number] };
    await loadRunTx(tx, item.runId, true);
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, item.refundId));
    if (!r || r.status === 'pending') return { status: 'pending' as const };
    const o: ItemOutcome =
      r.status === 'succeeded'
        ? { status: 'refunded', amountMinor: r.amountMinor }
        : { status: 'failed', code: codeOf(r.failureCode) };
    await settleItemTx(tx, ctx, item.runId, item.id, o);
    return { status: o.status };
  },
  audit: (input, r) => ({
    action: 'event.mass_refund_item',
    targetType: 'mass_refund_item',
    targetId: input.itemId,
    data: { status: r.status },
  }),
});
