'use server';

import { publicForm } from '@yayatoh/forms';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  attachPaymentCommand,
  type CheckoutResultDto,
  checkoutRiskSignals,
  declineWaitlistOfferCommand,
  leaveWaitlistCommand,
  publicWaitlistEntry,
  rejoinWaitlistCommand,
  startCheckoutCommand,
  waitlistRef,
} from '@yayatoh/orders';
import { registrationCellOf, startRegistrationCommand } from '@yayatoh/registration';
import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getCheckoutRisk, getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { ownSession } from '@/server/session.ts';

export interface WaitlistActionState {
  readonly code: string | null;
  readonly reason?: string;
  readonly field?: string;
  readonly retryMinutes?: number;
}

const back = async (token: string) => redirect({ href: `/waitlist/${token}`, locale: await getLocale() });

/**
 * The person's own link is the credential (it was emailed to the address they proved). Its org
 * comes from the signed entry id, never from input. Each change reloads the page, which then
 * shows the new state.
 */
async function run(
  token: string,
  command: typeof leaveWaitlistCommand | typeof declineWaitlistOfferCommand | typeof rejoinWaitlistCommand,
): Promise<WaitlistActionState> {
  const ref = await waitlistRef(token);
  if (!ref) return { code: 'not_found' };
  try {
    await executeCommand(command as never, { token } as never, createCtx({ orgId: ref.orgId }), ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { code: err.code, reason: String(err.details?.reason ?? '') };
  }
  return back(token);
}

export async function leaveWaitlistAction(token: string, _prev: WaitlistActionState, _form: FormData) {
  return run(token, leaveWaitlistCommand);
}

export async function declineOfferAction(token: string, _prev: WaitlistActionState, _form: FormData) {
  return run(token, declineWaitlistOfferCommand);
}

export async function rejoinWaitlistAction(token: string, _prev: WaitlistActionState, _form: FormData) {
  return run(token, rejoinWaitlistCommand);
}

/**
 * Buy an open offer through the normal checkout: the same command, prices from the database, the
 * checkout questions and risk rules, then the payment page (or the order page when free). The
 * offer's held stock becomes the order's; the address is the one the offer was made to.
 */
export async function offerCheckoutAction(
  token: string,
  _prev: WaitlistActionState,
  form: FormData,
): Promise<WaitlistActionState> {
  const locale = await getLocale();
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  const view = await publicWaitlistEntry(token);
  if (!view) return { code: 'not_found' };
  if (!view.offer) return { code: 'invalid_state', reason: 'offer_closed' };
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { code: 'validation_failed', field: 'name' };
  const quantity = Number(form.get('quantity') ?? view.offer.quantity);
  const questions = await publicForm(view.orgId, {
    kind: 'checkout_questions',
    subjectType: 'event',
    subjectId: view.eventId,
  });
  const answers: Record<string, unknown> = {};
  for (const q of questions?.fields ?? []) {
    const key = `q:${q.key}`;
    if (q.type === 'multi_select') {
      const all = form.getAll(key).map(String);
      if (all.length) answers[q.key] = all;
    } else {
      const v = String(form.get(key) ?? '').trim();
      if (v) answers[q.key] = q.type === 'checkbox' ? true : v;
    }
  }
  const geo = (await headers()).get('x-vercel-ip-country');
  const signals = await checkoutRiskSignals(view.orgId, view.eventId, view.email, new Date());
  const risk = await getCheckoutRisk().assess({
    orgId: view.orgId,
    eventId: view.eventId,
    emailOrders: signals.emailOrders,
    paymentFailures: signals.paymentFailures,
    ipCountry: geo && /^[A-Z]{2}$/.test(geo) ? geo : null,
    eventCountry: signals.eventCountry,
  });
  if (risk.action === 'block') return { code: 'forbidden', reason: 'risk_blocked' };
  const session = await ownSession();
  const ctx = createCtx({
    orgId: view.orgId,
    actor: session ? { type: 'user', userId: session.userId } : { type: 'anonymous' },
    locale,
  });
  let result: CheckoutResultDto;
  // M5.1a: an offer on a registration type's line is bought through registration checkout (the
  // pass is managed by registration; its capacity counter takes the offered place).
  const cell = await registrationCellOf(view.orgId, view.offer.ticketTypeId);
  try {
    result = cell
      ? await executeCommand(
          startRegistrationCommand,
          {
            eventId: view.eventId,
            registrationTypeId: cell.registrationTypeId,
            itemIds: [cell.admissionItemId],
            buyer: { email: view.email, name },
            waitlistToken: token,
            answers,
            locale,
            riskReview: risk.action === 'review' ? [...risk.rules] : [],
          },
          ctx,
          ports,
        )
      : await executeCommand(
          startCheckoutCommand,
          {
            eventId: view.eventId,
            items: [
              { ticketTypeId: view.offer.ticketTypeId, quantity: Number.isInteger(quantity) ? quantity : 1 },
            ],
            ...(view.date ? { occurrenceId: view.date.id } : {}),
            buyer: { email: view.email, name },
            waitlistToken: token,
            answers,
            locale,
            riskReview: risk.action === 'review' ? [...risk.rules] : [],
          },
          ctx,
          ports,
        );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return {
      code: err.code,
      reason: String(err.details?.reason ?? ''),
      ...(typeof err.details?.field === 'string' ? { field: err.details.field } : {}),
    };
  }
  const { order, manageToken, payment: flow } = result;
  const orderPath = `/orders/${manageToken}`;
  if (order.status === 'paid') return redirect({ href: orderPath, locale });
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const payment = await getPaymentProvider().createPayment({
    orgId: view.orgId,
    orderId: order.id,
    amount: { amount: order.totalMinor, currency: order.currency },
    fundsFlow: flow.fundsFlow,
    connectedAccountId: flow.connectedAccountId,
    applicationFee: { amount: flow.applicationFeeMinor, currency: order.currency },
    buyerEmail: order.buyerEmail,
    description: view.event.name,
    idempotencyKey: `order:${order.id}:1`,
    returnUrl: `${origin}${locale === 'en' ? '' : `/${locale}`}${orderPath}`,
  });
  await executeCommand(
    attachPaymentCommand,
    { orderId: order.id, provider: payment.provider ?? getPaymentProvider().name, providerPaymentId: payment.providerPaymentId },
    ctx,
    ports,
  );
  nextRedirect(payment.redirectUrl);
}
