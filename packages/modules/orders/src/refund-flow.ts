import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, createCtx, executeCommand, requireOrg } from '@yayatoh/kernel';
import { type PaymentProvider, recordTransferReversalCommand } from '@yayatoh/payments';
import type { z } from 'zod';
import { nextMassRefundStepCommand, settleMassRefundItemCommand } from './commands/mass-refunds.ts';
import {
  completeRefundCommand,
  type startPolicyOverrideRefundCommand,
  startRefundCommand,
} from './commands/refunds.ts';

export interface RefundOutcome {
  readonly refundId: string;
  readonly status: 'succeeded' | 'failed' | 'pending';
  readonly amountMinor: number;
  readonly feeRefundedMinor: number;
  readonly currency: string;
}

/**
 * Refund tickets or an amount (the console and /v1 share this): the command records it with the
 * policy's amounts, the provider refunds on the right account (outside the transaction), and the
 * answer is recorded. Refunded after the event was paid out, the organizer's share is taken back
 * from the transfer (explicit reversal); if that fails it stays a receivable, netted from the next
 * release. Replaying with the same refund is safe: the provider call is keyed by the refund id and
 * completing an already-completed refund changes nothing.
 */
export async function refundOrder(
  input: z.input<typeof startRefundCommand.input>,
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  provider: PaymentProvider,
  start: typeof startRefundCommand | typeof startPolicyOverrideRefundCommand = startRefundCommand,
): Promise<RefundOutcome> {
  const started = await executeCommand(start, input, ctx, ports);
  return refundAtProvider(started, ctx, ports, provider);
}

/** A recorded (pending) refund and how to ask the provider for it. */
export interface StartedRefund {
  readonly refundId: string;
  readonly amountMinor: number;
  readonly feeRefundedMinor: number;
  readonly currency: string;
  readonly provider: {
    readonly providerPaymentId: string;
    readonly fundsFlow: 'organizer_mor' | 'platform_mor';
    readonly connectedAccountId: string | null;
  };
}

/**
 * Ask the provider for a recorded refund (keyed by the refund id, so a retry never refunds
 * twice), record its answer, and after a payout take the organizer's share back from the
 * transfer (explicit reversal; a failed one stays a receivable). Shared by single refunds and the
 * mass refund batch.
 */
export async function refundAtProvider(
  started: StartedRefund,
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  provider: PaymentProvider,
): Promise<RefundOutcome> {
  const res = await provider.refund({
    providerPaymentId: started.provider.providerPaymentId,
    amount: { amount: started.amountMinor, currency: started.currency },
    connectedAccountId: started.provider.connectedAccountId,
    refundApplicationFee: {
      amount: started.provider.fundsFlow === 'organizer_mor' ? started.feeRefundedMinor : 0,
      currency: started.currency,
    },
    idempotencyKey: `refund:${started.refundId}`,
    orgId: requireOrg(ctx),
  });
  const done = await executeCommand(
    completeRefundCommand,
    { refundId: started.refundId, outcome: res.status, providerRefundId: res.refundId },
    ctx,
    ports,
  );
  if (done.reversal) {
    const rev = await provider.reverseTransfer({
      transferId: done.reversal.transferId,
      amount: { amount: done.reversal.amountMinor, currency: done.reversal.currency },
      idempotencyKey: `reversal:${started.refundId}`,
      orgId: requireOrg(ctx),
    });
    await executeCommand(
      recordTransferReversalCommand,
      {
        refundId: started.refundId,
        orderId: done.reversal.orderId,
        eventId: done.reversal.eventId,
        outcome: rev.status,
        reversalId: rev.reversalId,
        amountMinor: done.reversal.amountMinor,
        currency: done.reversal.currency,
      },
      ctx,
      ports,
    );
  }
  return {
    refundId: started.refundId,
    status: done.status === 'succeeded' || done.status === 'failed' ? done.status : 'pending',
    amountMinor: started.amountMinor,
    feeRefundedMinor: started.feeRefundedMinor,
    currency: started.currency,
  };
}

export interface MassRefundSlice {
  /** Items settled in this slice (refunded, skipped or failed). */
  readonly settled: number;
  /** Why the slice stopped: out of budget, paused, finished, or waiting on the provider. */
  readonly stoppedBy: 'budget' | 'paused' | 'done' | 'waiting';
}

/**
 * Work a mass refund for a while (M3.10b; the `orders.mass-refund` job, or the dev runner): step
 * by step, each order in its own transactions, the provider asked outside them. Stops when the
 * run is paused or finished, after `maxItems` orders, or when `budgetMs` has passed. Safe to run
 * again at any point: a crash between the provider and the database leaves the item's refund
 * pending, and the next slice asks the provider again with the same key.
 */
export async function runMassRefund(
  provider: PaymentProvider,
  ports: CommandPorts<TenantTx>,
  orgId: string,
  runId: string,
  opts: { budgetMs?: number; maxItems?: number; now?: () => Date } = {},
): Promise<MassRefundSlice> {
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const max = opts.maxItems ?? Number.POSITIVE_INFINITY;
  const ctx = () =>
    createCtx({
      orgId,
      actor: { type: 'system', name: 'orders.mass-refund' },
      ...(opts.now ? { now: opts.now() } : {}),
    });
  let settled = 0;
  while (settled < max && Date.now() < deadline) {
    const step = await executeCommand(nextMassRefundStepCommand, { runId }, ctx(), ports);
    if (step.state === 'paused' || step.state === 'done' || step.state === 'waiting')
      return { settled, stoppedBy: step.state };
    if (step.state === 'refund') {
      const c = ctx();
      await refundAtProvider(step.refund, c, ports, provider);
      const r = await executeCommand(settleMassRefundItemCommand, { itemId: step.itemId }, c, ports);
      // Still pending at the provider: its webhook completes it; move on to the next order.
      if (r.status === 'pending') continue;
    }
    settled += 1;
  }
  return { settled, stoppedBy: 'budget' };
}
