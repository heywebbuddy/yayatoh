import 'server-only';
import { type Ctx, executeCommand } from '@yayatoh/kernel';
import { attachPaymentCommand } from '@yayatoh/orders';
import { redirect as nextRedirect } from 'next/navigation';
import { getPaymentProvider } from './payments.ts';
import { ports } from './ports.ts';

/** What a registration order needs to start (or restart) its payment. */
export interface RegistrationPayment {
  readonly orderId: string;
  readonly status: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly buyerEmail: string;
  readonly fundsFlow: string;
  readonly connectedAccountId: string | null;
  readonly applicationFeeMinor: number;
}

/**
 * M5.1c: send the payer to the payment page for a registration order (approved applicant, group,
 * +1), returning to `returnPath` afterwards. The provider call uses the order's idempotency key, so
 * a retried pay step reuses the same payment; an order already awaiting payment is not attached
 * twice.
 */
export async function redirectToPayment(
  orgId: string,
  eventName: string,
  locale: string,
  ctx: Ctx,
  p: RegistrationPayment,
  returnPath: string,
): Promise<never> {
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const provider = getPaymentProvider();
  const payment = await provider.createPayment({
    orgId,
    orderId: p.orderId,
    amount: { amount: p.totalMinor, currency: p.currency },
    fundsFlow: p.fundsFlow as 'organizer_mor',
    connectedAccountId: p.connectedAccountId,
    applicationFee: { amount: p.applicationFeeMinor, currency: p.currency },
    buyerEmail: p.buyerEmail,
    description: eventName,
    idempotencyKey: `order:${p.orderId}:1`,
    returnUrl: `${origin}${locale === 'en' ? '' : `/${locale}`}${returnPath}`,
  });
  if (p.status !== 'awaiting_payment')
    await executeCommand(
      attachPaymentCommand,
      { orderId: p.orderId, provider: provider.name, providerPaymentId: payment.providerPaymentId },
      ctx,
      ports,
    );
  nextRedirect(payment.redirectUrl);
}
