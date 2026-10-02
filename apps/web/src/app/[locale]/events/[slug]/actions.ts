'use server';

import {
  accessTarget,
  checkoutTarget,
  orgUnavailableForEvent,
  publicEventBySlug,
  redeemAccessCodeCommand,
} from '@yayatoh/events';
import { publicForm } from '@yayatoh/forms';
import { createCtx, executeCommand, isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import {
  attachPaymentCommand,
  type CheckoutResultDto,
  checkoutRiskSignals,
  checkoutVerificationRequired,
  GUEST_CODE_TTL_MS,
  recordCheckoutBlockCommand,
  requestGuestChallenge,
  startCheckoutCommand,
  verifyGuestChallenge,
} from '@yayatoh/orders';
import { signLinkToken, verifyLinkToken } from '@yayatoh/platform';
import { reportReviewCommand } from '@yayatoh/reviews';
import { requestHolderLinkCommand } from '@yayatoh/ticketing';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { recordCheckoutAttribution } from '@/server/attribution.ts';
import { failure, success } from '@/server/form.ts';
import { emailVerifiedHere, guestLimits, rememberVerifiedEmail, sendGuestEmail } from '@/server/guest.ts';
import { getCheckoutRisk, getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { ownSession } from '@/server/session.ts';
import { clientKey, currentAccess, rememberAccess } from '@/server/visitor.ts';

export interface CheckoutState {
  readonly code: string | null;
  readonly reason?: string;
  /** A seating rule that refused the seats (M1.7f). */
  readonly rule?: string;
  /** The question whose answer was rejected (checkout questions). */
  readonly field?: string;
  /** `rate_limited`: minutes until the buyer may try again. */
  readonly retryMinutes?: number;
  /** `verify_email` (M1.5f): the buyer must enter the code emailed to this address. */
  readonly verify?: {
    readonly email: string;
    /** What just happened: a code went out, or the last attempt's outcome. */
    readonly status: 'sent' | 'cooldown' | 'wrong' | 'locked' | 'expired' | 'used';
    readonly attemptsLeft?: number | null;
    /** When a new code may be asked for (epoch ms), when known. */
    readonly resendAt?: number | null;
    /** The pending code's challenge id, signed; posted back with the code. */
    readonly token?: string;
  };
}

/**
 * Buyer email verification (M1.5f), before anything is held or charged: the first submit emails
 * a code (the order is not placed); the next submit carries the code. Returns null once this
 * browser has proved the address (now, or in the last 30 minutes), otherwise the state to show.
 * Placed before the order so the 10-minute hold never runs while the buyer reads their email,
 * and a mistyped address never holds stock.
 */
const PENDING_PURPOSE = 'guest-checkout';

async function verifyBuyerEmail(
  orgId: string,
  email: string,
  locale: string,
  form: FormData,
): Promise<CheckoutState | null> {
  const limits = await guestLimits();
  const code = String(form.get('verifyCode') ?? '').replace(/\s/g, '');
  // The pending code travels in the form as a signed token (not a cookie: setting a cookie here
  // would re-render the page, and a seat map refreshed mid-step would drop the buyer's seats).
  const pending = verifyLinkToken(PENDING_PURPOSE, String(form.get('verifyToken') ?? ''));
  if (code && form.get('verifyIntent') !== 'resend' && pending) {
    const r = await verifyGuestChallenge(
      { challengeId: pending, code, purpose: 'checkout', scopeOrgId: orgId, email },
      limits,
    );
    if (r.status === 'ok') {
      await rememberVerifiedEmail(email);
      return null;
    }
    if (r.status === 'rate_limited')
      return {
        code: 'rate_limited',
        retryMinutes: Math.max(1, Math.ceil((r.retryAfterMs ?? 60_000) / 60_000)),
      };
    return {
      code: 'verify_email',
      verify: {
        email,
        status: r.status,
        attemptsLeft: r.attemptsLeft,
        token: signLinkToken(PENDING_PURPOSE, pending),
      },
    };
  }
  let sent: Awaited<ReturnType<typeof requestGuestChallenge>>;
  try {
    sent = await requestGuestChallenge({ purpose: 'checkout', scopeOrgId: orgId, email }, limits);
  } catch (err) {
    if (isDomainError(err)) return { code: err.code, reason: String(err.details?.reason ?? '') };
    throw err;
  }
  if (sent.status === 'rate_limited')
    return { code: 'rate_limited', retryMinutes: Math.max(1, Math.ceil(sent.retryAfterMs / 60_000)) };
  if (sent.status === 'cooldown')
    return {
      code: 'verify_email',
      verify: {
        email,
        status: 'cooldown',
        resendAt: sent.resendAt.getTime(),
        token: signLinkToken(PENDING_PURPOSE, sent.challengeId),
      },
    };
  await sendGuestEmail({
    kind: 'guest.checkout-code',
    to: email,
    locale,
    orgId,
    params: { code: sent.code, minutes: GUEST_CODE_TTL_MS / 60_000 },
  });
  return {
    code: 'verify_email',
    verify: {
      email,
      status: 'sent',
      resendAt: sent.resendAt.getTime(),
      token: signLinkToken(PENDING_PURPOSE, sent.challengeId),
    },
  };
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
  // Each checkout start holds inventory: limit per device (shared venue IPs stay usable).
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  // M1.4d: an access code the visitor redeemed may open hidden passes or a private event.
  const live = await accessTarget(slug);
  const grant = live ? await currentAccess(live.orgId, live.eventId) : null;
  const target = (await checkoutTarget(slug)) ?? (grant?.unlocksEvent && live ? live : null);
  if (!target) {
    // The page was opened before staff suspended or closed the org (M1.3f): say so plainly.
    if (await orgUnavailableForEvent(slug)) return { code: 'invalid_state', reason: 'org_suspended' };
    return { code: 'not_found' };
  }
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
  const email = String(form.get('email') ?? '');
  // M1.5f: the buyer proves the address their tickets go to (organizer setting, on by default).
  if (email.trim() && (await checkoutVerificationRequired(target.orgId, target.eventId))) {
    if (!(await emailVerifiedHere(email, target.orgId))) {
      const step = await verifyBuyerEmail(target.orgId, email.trim(), locale, form);
      if (step) return step;
    }
  }
  // Pre-checkout risk rules (M1.6e), through the risk port before any order exists. The request's
  // country comes from the host's geo header; the org and event from the server-side lookup.
  const geo = (await headers()).get('x-vercel-ip-country');
  const signals = await checkoutRiskSignals(target.orgId, target.eventId, email, new Date());
  const risk = await getCheckoutRisk().assess({
    orgId: target.orgId,
    eventId: target.eventId,
    emailOrders: signals.emailOrders,
    paymentFailures: signals.paymentFailures,
    ipCountry: geo && /^[A-Z]{2}$/.test(geo) ? geo : null,
    eventCountry: signals.eventCountry,
  });
  const session = await ownSession();
  const ctx = createCtx({
    orgId: target.orgId,
    actor: session ? { type: 'user', userId: session.userId } : { type: 'anonymous' },
    locale,
  });
  if (risk.action === 'block') {
    // M1.9e: the refused attempt becomes a fraud signal (card testing / order velocity) for the
    // organizer; recording it never changes the buyer's answer.
    try {
      await executeCommand(
        recordCheckoutBlockCommand,
        {
          eventId: target.eventId,
          email: email.slice(0, 320),
          rules: [...risk.rules],
          emailOrders: signals.emailOrders,
          paymentFailures: signals.paymentFailures,
        },
        ctx,
        ports,
      );
    } catch (err) {
      console.warn(`checkout block not recorded: ${(err as Error).message}`);
    }
    return { code: 'forbidden', reason: 'risk_blocked' };
  }
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
        buyer: { email, name: String(form.get('name') ?? '') },
        marketingOptIn: form.get('marketingOptIn') === '1',
        promoCode: String(form.get('promoCode') ?? '').trim() || undefined,
        ...(grant ? { accessCodeId: grant.codeId } : {}),
        answers,
        locale,
        riskReview: risk.action === 'review' ? [...risk.rules] : [],
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
  // M3.8a: where the order came from (tracked-link click or UTM landing); never blocks checkout.
  await recordCheckoutAttribution(target.orgId, order.id);
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
    { orderId: order.id, provider: payment.provider ?? getPaymentProvider().name, providerPaymentId: payment.providerPaymentId },
    ctx,
    ports,
  );
  nextRedirect(payment.redirectUrl);
}

export type HolderLinkState = {
  readonly sent: boolean;
  readonly code: string | null;
  readonly retryMinutes?: number;
};

/**
 * "Email me my tickets": the same answer whether or not the address has tickets here (no
 * enumeration); the worker sends the magic link.
 */
export async function requestHolderLinkAction(
  slug: string,
  _prev: HolderLinkState,
  form: FormData,
): Promise<HolderLinkState> {
  const email = String(form.get('email') ?? '').trim();
  // Each request emails a magic link: limit per device and per address.
  const limit = await limitAction('holderLink', { identity: email, scope: 'request' });
  if (!limit.allowed) return { sent: false, code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  const target = (await checkoutTarget(slug)) ?? (await accessTarget(slug));
  if (!target) return { sent: false, code: 'not_found' };
  try {
    await executeCommand(
      requestHolderLinkCommand,
      { eventId: target.eventId, email },
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

/** Report a public review (M1.4g). Rate-limited per device; one report per device and review. */
export async function reportReviewAction(
  slug: string,
  reviewId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const limit = await limitAction('reviewReport');
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  const target = await checkoutTarget(slug);
  if (!target) return { ok: false, code: 'not_found' };
  try {
    await executeCommand(
      reportReviewCommand,
      {
        reviewId,
        reason: String(form.get('reason') ?? '') as never,
        note: String(form.get('note') ?? ''),
        clientKey: await clientKey('review-report'),
      },
      createCtx({ orgId: target.orgId }),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return success();
}
