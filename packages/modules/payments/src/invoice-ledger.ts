import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import { postJournalTx } from './ledger.ts';
import type { FundsFlow } from './port.ts';

/**
 * One payment against an invoice (M5.1d, roadmap §5.3), in the caller's tenant transaction.
 * Journal key `invoice_payment:<paymentId>`: a replayed webhook or recording never posts twice.
 *
 * - **Pay link (card)**, on the org's funds flow at the time of payment, like a sale of
 *   `amountMinor` whose fee is this payment's fee part: `platform_mor` takes the cash, owes the
 *   organizer their share in `payable_held` and defers the fee; `organizer_mor` receives only the
 *   application fee. Kind `sale` with the order as reference, so reconciliation matches the
 *   provider's charges for the order (`order:<id>`).
 * - **Offline** (check, wire, cash; organizer-collected): no cash reaches the platform, so the
 *   fee part becomes an org receivable, as for box-office sales.
 *
 * Every journal keeps the gross amount and the fee part as a memo, so the invoice's payments
 * reconcile to the cent against the order: the fee parts add up to the order's fee.
 */
export async function postInvoicePaymentTx(
  tx: TenantTx,
  ctx: Ctx,
  p: {
    paymentId: string;
    invoiceId: string;
    orderId: string;
    eventId: string;
    channel: 'pay_link' | 'offline';
    fundsFlow: FundsFlow | null;
    amountMinor: number;
    feePartMinor: number;
    currency: string;
  },
) {
  const c = p.currency;
  const memo = {
    invoiceId: p.invoiceId,
    paymentId: p.paymentId,
    channel: p.channel,
    grossMinor: p.amountMinor,
    feeMinor: p.feePartMinor,
    ...(p.fundsFlow ? { fundsFlow: p.fundsFlow } : { collectedBy: 'organizer' }),
  };
  const base = {
    key: `invoice_payment:${p.paymentId}`,
    refType: 'order',
    refId: p.orderId,
    eventId: p.eventId,
    memo,
  };
  if (p.channel === 'offline') {
    if (p.feePartMinor === 0) return null;
    return postJournalTx(tx, ctx, {
      ...base,
      kind: 'organizer_collected_sale',
      postings: [
        { account: 'org:receivable', amountMinor: p.feePartMinor, currency: c },
        { account: 'platform:platform_fee_deferred', amountMinor: -p.feePartMinor, currency: c },
      ],
    });
  }
  const postings =
    p.fundsFlow === 'platform_mor'
      ? [
          { account: 'platform:stripe_cash' as const, amountMinor: p.amountMinor, currency: c },
          {
            account: 'org:payable_held' as const,
            amountMinor: -(p.amountMinor - p.feePartMinor),
            currency: c,
          },
          { account: 'platform:platform_fee_deferred' as const, amountMinor: -p.feePartMinor, currency: c },
        ]
      : [
          { account: 'platform:stripe_cash' as const, amountMinor: p.feePartMinor, currency: c },
          { account: 'platform:platform_fee_revenue' as const, amountMinor: -p.feePartMinor, currency: c },
        ];
  if (postings.every((l) => l.amountMinor === 0)) return null;
  return postJournalTx(tx, ctx, { ...base, kind: 'sale', postings });
}
