'use server';

import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { attachPaymentCommand, type CheckoutResultDto, startCheckoutCommand } from '@yayatoh/orders';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { getSession } from '@/server/session.ts';

export interface CheckoutState {
  readonly code: string | null;
  readonly reason?: string;
}

/**
 * Public checkout. The org comes from the event slug (server-side lookup), never from the
 * request; prices come from the database, never from the form.
 */
export async function checkoutAction(
  slug: string,
  _prev: CheckoutState,
  form: FormData,
): Promise<CheckoutState> {
  const locale = await getLocale();
  const target = await checkoutTarget(slug);
  if (!target) return { code: 'not_found' };
  const items = [...form.entries()]
    .filter(([k, v]) => k.startsWith('qty:') && Number(v) > 0)
    .map(([k, v]) => ({ ticketTypeId: k.slice(4), quantity: Number(v) }));
  if (items.length === 0) return { code: 'validation_failed', reason: 'empty' };
  const session = await getSession();
  const ctx = createCtx({
    orgId: target.orgId,
    actor: session ? { type: 'user', userId: session.userId } : { type: 'anonymous' },
    locale,
  });
  let result: CheckoutResultDto;
  try {
    result = await executeCommand(
      startCheckoutCommand,
      {
        eventId: target.eventId,
        items,
        buyer: { email: String(form.get('email') ?? ''), name: String(form.get('name') ?? '') },
        marketingOptIn: form.get('marketingOptIn') === '1',
        locale,
      },
      ctx,
      ports,
    );
  } catch (err) {
    if (isDomainError(err)) return { code: err.code, reason: String(err.details?.reason ?? '') };
    throw err;
  }
  const { order, manageToken } = result;
  const orderPath = `/orders/${manageToken}`;
  if (order.status === 'paid') return redirect({ href: orderPath, locale });

  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const payment = await getPaymentProvider().createPayment({
    orgId: target.orgId,
    orderId: order.id,
    amount: { amount: order.totalMinor, currency: order.currency },
    fundsFlow: 'platform_mor',
    applicationFee: { amount: 0, currency: order.currency },
    buyerEmail: order.buyerEmail,
    description: slug,
    idempotencyKey: `order:${order.id}:1`,
    returnUrl: `${origin}${locale === 'en' ? '' : `/${locale}`}${orderPath}`,
  });
  await executeCommand(
    attachPaymentCommand,
    { orderId: order.id, provider: getPaymentProvider().name, providerPaymentId: payment.providerPaymentId },
    ctx,
    ports,
  );
  nextRedirect(payment.redirectUrl);
}
