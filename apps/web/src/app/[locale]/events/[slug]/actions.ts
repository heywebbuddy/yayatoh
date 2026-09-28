'use server';

import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { publicForm } from '@yayatoh/forms';
import { createCtx, executeCommand, isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import { attachPaymentCommand, type CheckoutResultDto, startCheckoutCommand } from '@yayatoh/orders';
import { requestHolderLinkCommand } from '@yayatoh/ticketing';
import { refresh } from 'next/cache';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { getSession } from '@/server/session.ts';

export interface CheckoutState {
  readonly code: string | null;
  readonly reason?: string;
  /** A seating rule that refused the seats (M1.7f). */
  readonly rule?: string;
  /** The question whose answer was rejected (checkout questions). */
  readonly field?: string;
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
  const event = await publicEventBySlug(slug);
  if (!event) return { code: 'not_found' };
  let items: { ticketTypeId: string; quantity: number; amountMinor?: number }[];
  try {
    items = [...form.entries()]
      .filter(([k, v]) => k.startsWith('qty:') && Number(v) > 0)
      .map(([k, v]) => {
        const ticketTypeId = k.slice(4);
        const amount = String(form.get(`amount:${ticketTypeId}`) ?? '').trim();
        // Donation amounts are decimals in the event's currency (never the client's say-so).
        return {
          ticketTypeId,
          quantity: Number(v),
          ...(amount
            ? { amountMinor: moneyFromDecimal(amount.replace(',', '.'), event.currency).amount }
            : {}),
        };
      });
  } catch {
    return { code: 'validation_failed', reason: 'donation_amount' };
  }
  // Seated events: the chosen seats (their prices come from the seat map on the server).
  const seats = form.getAll('seat').map(String).slice(0, 50);
  if (items.length === 0 && seats.length === 0) return { code: 'validation_failed', reason: 'empty' };
  // Answers are read by the published questions' keys and types; the server validates them again.
  const questions = await publicForm(target.orgId, {
    kind: 'checkout_questions',
    subjectType: 'event',
    subjectId: target.eventId,
  });
  const answers: Record<string, unknown> = {};
  for (const q of questions?.fields ?? []) {
    const name = `q:${q.key}`;
    if (q.type === 'multi_select') {
      const all = form.getAll(name).map(String);
      if (all.length) answers[q.key] = all;
    } else {
      const v = String(form.get(name) ?? '').trim();
      if (v) answers[q.key] = q.type === 'checkbox' ? true : v;
    }
  }
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
        seats,
        buyer: { email: String(form.get('email') ?? ''), name: String(form.get('name') ?? '') },
        marketingOptIn: form.get('marketingOptIn') === '1',
        promoCode: String(form.get('promoCode') ?? '').trim() || undefined,
        answers,
        locale,
      },
      ctx,
      ports,
    );
  } catch (err) {
    if (isDomainError(err)) {
      // Someone else got a seat first: send the buyer a fresh seat map with the answer.
      if (err.details?.reason === 'seats_taken') refresh();
      return {
        code: err.code,
        reason: String(err.details?.reason ?? ''),
        ...(typeof err.details?.field === 'string' ? { field: err.details.field } : {}),
        ...(typeof err.details?.rule === 'string' ? { rule: err.details.rule } : {}),
      };
    }
    throw err;
  }
  const { order, manageToken, payment: flow } = result;
  const orderPath = `/orders/${manageToken}`;
  if (order.status === 'paid') return redirect({ href: orderPath, locale });

  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const payment = await getPaymentProvider().createPayment({
    orgId: target.orgId,
    orderId: order.id,
    amount: { amount: order.totalMinor, currency: order.currency },
    fundsFlow: flow.fundsFlow,
    connectedAccountId: flow.connectedAccountId,
    applicationFee: { amount: flow.applicationFeeMinor, currency: order.currency },
    buyerEmail: order.buyerEmail,
    // The line the buyer sees on the hosted payment page and their card statement.
    description: event.name,
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

export type HolderLinkState = { readonly sent: boolean; readonly code: string | null };

/**
 * "Email me my tickets": the same answer whether or not the address has tickets here (no
 * enumeration); the worker sends the magic link.
 */
export async function requestHolderLinkAction(
  slug: string,
  _prev: HolderLinkState,
  form: FormData,
): Promise<HolderLinkState> {
  const target = await checkoutTarget(slug);
  if (!target) return { sent: false, code: 'not_found' };
  try {
    await executeCommand(
      requestHolderLinkCommand,
      { eventId: target.eventId, email: String(form.get('email') ?? '').trim() },
      createCtx({ orgId: target.orgId }),
      ports,
    );
    return { sent: true, code: null };
  } catch (err) {
    return { sent: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}
