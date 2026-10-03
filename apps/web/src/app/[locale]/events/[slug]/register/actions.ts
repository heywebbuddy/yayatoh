'use server';

import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { attachPaymentCommand, checkoutRiskSignals, waitlistToken } from '@yayatoh/orders';
import {
  applyCommand,
  joinRegistrationWaitlistCommand,
  publicRegistration,
  startRegistrationCommand,
} from '@yayatoh/registration';
import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { emailVerifiedHere } from '@/server/guest.ts';
import { type GuestVerifyStep, guestEmailStep } from '@/server/guest-verify.ts';
import { getCheckoutRisk, getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { ownSession } from '@/server/session.ts';

/** A type as the buyer sees it: name, description, price range (formatted), full or not. */
export interface RegistrationOptionView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceLabel: string;
  readonly full: boolean;
  /** M5.1c: applied for (approval before payment). */
  readonly apply: boolean;
  /** M5.1d: may pay later by invoice; whether a PO number is asked for or required. */
  readonly payLater: boolean;
  readonly poNumber: 'off' | 'optional' | 'required';
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly kind: 'admission' | 'add_on';
    readonly priceLabel: string;
  }[];
}

export interface RegistrationState {
  readonly code: string | null;
  readonly reason?: string;
  readonly field?: string;
  readonly retryMinutes?: number;
  /** After "Show my options": the address and code they apply to, and the types to pick from. */
  readonly options?: {
    readonly email: string;
    readonly accessCode: string;
    readonly types: readonly RegistrationOptionView[];
  };
  /** The email-code step (M1.5f): registration always proves the address first. */
  readonly verify?: GuestVerifyStep;
  /** Joined a full type's waitlist: the place in line and the person's own link. */
  readonly joined?: {
    readonly position: number | null;
    readonly alreadyJoined: boolean;
    readonly href: string;
  };
}

const UUID = /^[0-9a-f-]{36}$/;

const fail = (err: unknown): RegistrationState => {
  if (!isDomainError(err)) throw err;
  return {
    code: err.code,
    reason: String(err.details?.reason ?? ''),
    ...(typeof err.details?.field === 'string' ? { field: err.details.field } : {}),
  };
};

async function lookup(slug: string, email: string, accessCode: string, locale: string) {
  const target = await checkoutTarget(slug);
  const event = target ? await publicEventBySlug(slug) : null;
  if (!target || !event) return null;
  const pub = await publicRegistration(target.orgId, target.eventId, { email, accessCode });
  const fmt = (minor: number, currency: string) =>
    formatMoney(money(minor, currency), locale).replace(/\.00$/, '');
  const types: RegistrationOptionView[] = pub.types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    priceLabel:
      t.minAllInMinor === t.maxAllInMinor
        ? fmt(t.minAllInMinor, t.currency)
        : `${fmt(t.minAllInMinor, t.currency)} – ${fmt(t.maxAllInMinor, t.currency)}`,
    full: t.full,
    apply: t.apply,
    payLater: t.payLater,
    poNumber: t.poNumber,
    items: (pub.items[t.id] ?? []).map((i) => ({ ...i, priceLabel: fmt(i.allInMinor, t.currency) })),
  }));
  return { target, event, types };
}

/**
 * Step 1 (public): who is registering. The types shown are only those this address (and code)
 * may pick; codes and domain rules never reach the page. Rate-limited per device (code guessing).
 */
export async function findOptionsAction(
  slug: string,
  _prev: RegistrationState,
  form: FormData,
): Promise<RegistrationState> {
  const locale = await getLocale();
  const email = String(form.get('email') ?? '')
    .trim()
    .slice(0, 254);
  const accessCode = String(form.get('accessCode') ?? '')
    .trim()
    .slice(0, 64);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { code: 'validation_failed', field: 'email' };
  const limit = await limitAction('registrationLookup');
  if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  const found = await lookup(slug, email, accessCode, locale);
  if (!found) return { code: 'not_found' };
  return { code: null, options: { email, accessCode, types: found.types } };
}

/**
 * Step 2 (public): register for a type (or join its waitlist when it is full). The org and event
 * come from the slug; prices, eligibility and capacity are decided by the command, never the
 * form. The address is proved with an emailed code first.
 */
export async function registerAction(
  slug: string,
  prev: RegistrationState,
  form: FormData,
): Promise<RegistrationState> {
  const locale = await getLocale();
  const email = String(form.get('email') ?? '').trim();
  const accessCode = String(form.get('accessCode') ?? '').trim();
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 120);
  const typeId = String(form.get('type') ?? '');
  const admission = String(form.get('admission') ?? '');
  const addOns = form
    .getAll('addOn')
    .map(String)
    .filter((id) => UUID.test(id));
  const raw = form.get('intent');
  const intent = raw === 'waitlist' ? 'waitlist' : raw === 'apply' ? 'apply' : 'register';
  const keep = { options: prev.options };
  if (!UUID.test(typeId)) return { ...keep, code: 'validation_failed', field: 'type' };
  if (!UUID.test(admission)) return { ...keep, code: 'validation_failed', field: 'admission' };
  if (!name) return { ...keep, code: 'validation_failed', field: 'name' };
  const limit =
    intent === 'waitlist'
      ? await limitAction('waitlistJoin', { identity: email.toLowerCase(), scope: 'join' })
      : await limitAction('checkoutStart');
  if (!limit.allowed) return { ...keep, code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  const target = await checkoutTarget(slug);
  const event = target ? await publicEventBySlug(slug) : null;
  if (!target || !event) return { code: 'not_found' };
  if (!(await emailVerifiedHere(email, target.orgId))) {
    const step = await guestEmailStep({
      purpose: intent === 'waitlist' ? 'waitlist' : 'checkout',
      orgId: target.orgId,
      email,
      locale,
      form,
      params: intent === 'waitlist' ? { eventName: event.name } : {},
    });
    if (step.kind === 'rate_limited')
      return { ...keep, code: 'rate_limited', retryMinutes: step.retryMinutes };
    if (step.kind === 'error') return { ...keep, code: step.code, reason: step.reason, field: 'email' };
    if (step.kind === 'step') return { ...keep, code: 'verify_email', verify: step.verify };
  }
  const session = await ownSession();
  const ctx = createCtx({
    orgId: target.orgId,
    actor: session ? { type: 'user', userId: session.userId } : { type: 'anonymous' },
    locale,
  });
  if (intent === 'apply') {
    // M5.1c: an application (nobody is charged); the applicant's own page shows what happens next.
    let token: string;
    try {
      const r = await executeCommand(
        applyCommand,
        {
          eventId: target.eventId,
          registrationTypeId: typeId,
          admissionItemId: admission,
          addOnItemIds: addOns,
          name,
          email,
          company:
            String(form.get('company') ?? '')
              .trim()
              .slice(0, 120) || null,
          jobTitle:
            String(form.get('jobTitle') ?? '')
              .trim()
              .slice(0, 120) || null,
          message:
            String(form.get('message') ?? '')
              .trim()
              .slice(0, 2000) || null,
          ...(accessCode ? { accessCode } : {}),
          locale,
        },
        ctx,
        ports,
      );
      token = r.token;
    } catch (err) {
      return { ...keep, ...fail(err) };
    }
    return redirect({ href: `/events/${slug}/registration/${token}`, locale });
  }
  if (intent === 'waitlist') {
    try {
      const r = await executeCommand(
        joinRegistrationWaitlistCommand,
        {
          eventId: target.eventId,
          registrationTypeId: typeId,
          admissionItemId: admission,
          name,
          email,
          ...(accessCode ? { accessCode } : {}),
          locale,
        },
        ctx,
        ports,
      );
      return {
        ...keep,
        code: null,
        joined: {
          position: r.position,
          alreadyJoined: r.alreadyJoined,
          href: `/waitlist/${waitlistToken(r.entryId)}`,
        },
      };
    } catch (err) {
      return { ...keep, ...fail(err) };
    }
  }
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
  if (risk.action === 'block') return { ...keep, code: 'forbidden', reason: 'risk_blocked' };
  let result: Awaited<ReturnType<typeof startRegistration>>;
  // M5.1d: pay later by invoice (types that offer it), with the PO number and company.
  const payLater =
    form.get('payment') === 'invoice'
      ? {
          poNumber:
            String(form.get('poNumber') ?? '')
              .trim()
              .slice(0, 60) || null,
          billingCompany:
            String(form.get('billingCompany') ?? '')
              .trim()
              .slice(0, 120) || null,
        }
      : null;
  try {
    result = await startRegistration(ctx, {
      eventId: target.eventId,
      registrationTypeId: typeId,
      itemIds: [admission, ...addOns],
      buyer: { email, name },
      ...(accessCode ? { accessCode } : {}),
      locale,
      riskReview: risk.action === 'review' ? [...risk.rules] : [],
      ...(payLater ? { payLater } : {}),
    });
  } catch (err) {
    const state = fail(err);
    // Full meanwhile: show the fresh options (the type now offers its waitlist).
    if (state.reason === 'type_full') {
      const found = await lookup(slug, email, accessCode, locale);
      return { ...state, options: found ? { email, accessCode, types: found.types } : prev.options };
    }
    return { ...keep, ...state };
  }
  return pay(target.orgId, event.name, locale, ctx, result, slug);
}

const startRegistration = (ctx: ReturnType<typeof createCtx>, input: Record<string, unknown>) =>
  executeCommand(startRegistrationCommand, input, ctx, ports);

/** Free: the order page. Paid: the payment page, as the event checkout does. */
async function pay(
  orgId: string,
  eventName: string,
  locale: string,
  ctx: ReturnType<typeof createCtx>,
  result: Awaited<ReturnType<typeof startRegistration>>,
  slug: string,
): Promise<RegistrationState> {
  const { order, manageToken, payment: flow } = result;
  const orderPath = `/orders/${manageToken}`;
  if (order.status === 'paid') return redirect({ href: orderPath, locale });
  // M5.1d: registered on an invoice: the buyer's invoice page (view, PDF, pay now or later).
  if (result.invoiceToken)
    return redirect({ href: `/events/${slug}/invoice/${result.invoiceToken}`, locale });
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const payment = await getPaymentProvider().createPayment({
    orgId,
    orderId: order.id,
    amount: { amount: order.totalMinor, currency: order.currency },
    fundsFlow: flow.fundsFlow,
    connectedAccountId: flow.connectedAccountId,
    applicationFee: { amount: flow.applicationFeeMinor, currency: order.currency },
    buyerEmail: order.buyerEmail,
    description: eventName,
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
