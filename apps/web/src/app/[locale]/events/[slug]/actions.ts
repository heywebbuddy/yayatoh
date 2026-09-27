'use server';

import { accessTarget, checkoutTarget, publicEventBySlug, redeemAccessCodeCommand } from '@yayatoh/events';
import { publicForm } from '@yayatoh/forms';
import { createCtx, executeCommand, isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import { attachPaymentCommand, type CheckoutResultDto, startCheckoutCommand } from '@yayatoh/orders';
import { requestHolderLinkCommand } from '@yayatoh/ticketing';
import { refresh } from 'next/cache';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { failure } from '@/server/form.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { getSession } from '@/server/session.ts';
import { clientKey, currentAccess, rememberAccess } from '@/server/visitor.ts';

export interface CheckoutState {
  readonly code: string | null;
  readonly reason?: string;
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
  // M1.4d: an access code the visitor redeemed may open hidden passes or a private event.
  const live = await accessTarget(slug);
  const grant = live ? await currentAccess(live.orgId, live.eventId) : null;
  const target = (await checkoutTarget(slug)) ?? (grant?.unlocksEvent && live ? live : null);
  if (!target) return { code: 'not_found' };
  const event = await publicEventBySlug(slug, { includePrivate: grant?.unlocksEvent === true });
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
        // Multi-date events: the date the buyer chose (validated against the event server-side).
        ...(/^[0-9a-f-]{36}$/.test(String(form.get('occurrenceId') ?? ''))
          ? { occurrenceId: String(form.get('occurrenceId')) }
          : {}),
        buyer: { email: String(form.get('email') ?? ''), name: String(form.get('name') ?? '') },
        marketingOptIn: form.get('marketingOptIn') === '1',
        promoCode: String(form.get('promoCode') ?? '').trim() || undefined,
        ...(grant ? { accessCodeId: grant.codeId } : {}),
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
  const target = (await checkoutTarget(slug)) ?? (await accessTarget(slug));
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

/**
 * Public: try an access code (M1.4d). A success is remembered in a signed, httpOnly cookie for this
 * event and the page re-renders with what it unlocked. Wrong, expired and used-up codes, and slugs
 * with no live event, all get one answer (a private event's existence is never revealed); repeated
 * failures from one device are rate-limited by the command.
 */
export async function redeemAccessCodeAction(
  slug: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await redeem(slug, form);
  if (result.ok) refresh();
  return result;
}

/** The unlock page (`/events/{slug}/unlock`): on success, go to the event page. */
export async function unlockEventAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const result = await redeem(slug, form);
  if (result.ok) redirect({ href: `/events/${slug}`, locale: await getLocale() });
  return result;
}

const invalidCode: FormState = {
  ok: false,
  code: 'validation_failed',
  fields: ['accessCode'],
  reason: 'invalid_code',
};

async function redeem(slug: string, form: FormData): Promise<FormState> {
  const code = String(form.get('accessCode') ?? '').trim();
  if (!code) return { ok: false, code: 'validation_failed', fields: ['accessCode'], reason: 'empty' };
  const target = await accessTarget(slug);
  if (!target) return invalidCode;
  try {
    const result = await executeCommand(
      redeemAccessCodeCommand,
      { eventId: target.eventId, code: code.slice(0, 64), clientKey: await clientKey('access-code') },
      createCtx({ orgId: target.orgId, locale: await getLocale() }),
      ports,
    );
    if (!result.ok) return invalidCode;
    await rememberAccess(target.eventId, result.grant);
  } catch (err) {
    if (isDomainError(err)) return failure(err);
    throw err;
  }
  return { ok: true, code: null, stamp: Date.now() };
}
