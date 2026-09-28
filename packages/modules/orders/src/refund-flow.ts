import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, executeCommand, requireOrg } from '@yayatoh/kernel';
import { type PaymentProvider, recordTransferReversalCommand } from '@yayatoh/payments';
import type { z } from 'zod';
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
