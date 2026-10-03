'use server';

import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { checkoutRiskSignals } from '@yayatoh/orders';
import { MAX_GROUP, startGroupCommand } from '@yayatoh/registration';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { emailVerifiedHere } from '@/server/guest.ts';
import { type GuestVerifyStep, guestEmailStep } from '@/server/guest-verify.ts';
import { getCheckoutRisk } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { redirectToPayment } from '@/server/registration-pay.ts';
import { ownSession } from '@/server/session.ts';

export interface GroupState {
  readonly code: string | null;
  readonly reason?: string;
  /** Rejected inputs: `payerName`, `payerEmail`, `name-2`, `email-2`, `pass-2`, `people`. */
  readonly fields?: readonly string[];
  readonly retryMinutes?: number;
  readonly verify?: GuestVerifyStep;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Group registration (M5.1c, public): the payer (their address proved with an emailed code, M1.5f)
 * names up to 20 people, each with a pass; one order, one payment. Prices, eligibility and
 * capacity are decided by the command. After payment the payer lands on their group page, where
 * names can be replaced until the cut-off.
 */
export async function groupAction(slug: string, _prev: GroupState, form: FormData): Promise<GroupState> {
  const locale = await getLocale();
  const count = Math.min(MAX_GROUP, Math.max(1, Number(form.get('count') ?? 1) || 1));
  const payerName = String(form.get('payerName') ?? '')
    .trim()
    .slice(0, 120);
  const payerEmail = String(form.get('payerEmail') ?? '')
    .trim()
    .slice(0, 254);
  const people = Array.from({ length: count }, (_, i) => {
    const [registrationTypeId = '', admissionItemId = ''] = String(form.get(`pass-${i + 1}`) ?? '').split(
      ':',
    );
    return {
      name: String(form.get(`name-${i + 1}`) ?? '')
        .trim()
        .slice(0, 120),
      email: String(form.get(`email-${i + 1}`) ?? '')
        .trim()
        .slice(0, 254),
      registrationTypeId,
      admissionItemId,
    };
  });
  const fields = [
    ...(payerName ? [] : ['payerName']),
    ...(EMAIL.test(payerEmail) ? [] : ['payerEmail']),
    ...people.flatMap((p, i) => [
      ...(p.name ? [] : [`name-${i + 1}`]),
      ...(EMAIL.test(p.email) ? [] : [`email-${i + 1}`]),
      ...(p.registrationTypeId && p.admissionItemId ? [] : [`pass-${i + 1}`]),
    ]),
  ];
  if (fields.length) return { code: 'validation_failed', fields };
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  const target = await checkoutTarget(slug);
  const event = target ? await publicEventBySlug(slug) : null;
  if (!target || !event) return { code: 'not_found' };
  if (!(await emailVerifiedHere(payerEmail, target.orgId))) {
    const step = await guestEmailStep({
      purpose: 'checkout',
      orgId: target.orgId,
      email: payerEmail,
      locale,
      form,
      params: {},
    });
    if (step.kind === 'rate_limited') return { code: 'rate_limited', retryMinutes: step.retryMinutes };
    if (step.kind === 'error') return { code: step.code, reason: step.reason, fields: ['payerEmail'] };
    if (step.kind === 'step') return { code: 'verify_email', verify: step.verify };
  }
  const session = await ownSession();
  const ctx = createCtx({
    orgId: target.orgId,
    actor: session ? { type: 'user', userId: session.userId } : { type: 'anonymous' },
    locale,
  });
  const geo = (await headers()).get('x-vercel-ip-country');
  const signals = await checkoutRiskSignals(target.orgId, target.eventId, payerEmail, new Date());
  const risk = await getCheckoutRisk().assess({
    orgId: target.orgId,
    eventId: target.eventId,
    emailOrders: signals.emailOrders,
    paymentFailures: signals.paymentFailures,
    ipCountry: geo && /^[A-Z]{2}$/.test(geo) ? geo : null,
    eventCountry: signals.eventCountry,
  });
  if (risk.action === 'block') return { code: 'forbidden', reason: 'risk_blocked' };
  let r: Awaited<ReturnType<typeof start>>;
  try {
    r = await start(ctx, {
      eventId: target.eventId,
      buyer: { name: payerName, email: payerEmail },
      people,
      locale,
      riskReview: risk.action === 'review' ? [...risk.rules] : [],
    });
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const field = typeof err.details?.field === 'string' ? err.details.field : null;
    return {
      code: err.code,
      reason: String(err.details?.reason ?? ''),
      ...(field ? { fields: [field] } : {}),
    };
  }
  const back = `/events/${slug}/group/${r.groupToken}`;
  if (r.order.status === 'paid') return redirect({ href: back, locale });
  return redirectToPayment(
    target.orgId,
    event.name,
    locale,
    ctx,
    {
      orderId: r.order.id,
      status: r.order.status,
      totalMinor: r.order.totalMinor,
      currency: r.order.currency,
      buyerEmail: r.order.buyerEmail,
      fundsFlow: r.payment.fundsFlow,
      connectedAccountId: r.payment.connectedAccountId,
      applicationFeeMinor: r.payment.applicationFeeMinor,
    },
    back,
  );
}

const start = (ctx: ReturnType<typeof createCtx>, input: Record<string, unknown>) =>
  executeCommand(startGroupCommand, input, ctx, ports);
