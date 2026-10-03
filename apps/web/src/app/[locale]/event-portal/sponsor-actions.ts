'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  attachPaymentCommand,
  type CheckoutResultDto,
  startLeadLicenseCheckoutCommand,
  startSponsorPackageCheckoutCommand,
} from '@yayatoh/orders';
import { portalSetDeliverableDoneCommand } from '@yayatoh/program';
import { refresh } from 'next/cache';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { failure, numberOrNull } from '@/server/form.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { portalRequestCtx, requirePortalPrincipal } from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

/**
 * Sponsor portal and exhibitor add-on purchases (M5.4b). Buying is a `portal:*` command that
 * reserves the package or licenses and opens an add-on order; then the provider's hosted payment
 * page (the fake provider in dev and CI), whose verified webhook activates what was bought. The
 * page's Idempotency-Key makes a double submit one order. The org comes from the portal session.
 */
async function asPortal(idempotencyKey?: string) {
  const p = await requirePortalPrincipal();
  const ctx = await portalRequestCtx(p);
  return { principal: p, ctx: idempotencyKey ? { ...ctx, idempotencyKey } : ctx };
}

async function toPayment(orgId: string, r: CheckoutResultDto, description: string): Promise<never> {
  const locale = await getLocale();
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const provider = getPaymentProvider();
  const payment = await provider.createPayment({
    orgId,
    orderId: r.order.id,
    amount: { amount: r.order.totalMinor, currency: r.order.currency },
    fundsFlow: r.payment.fundsFlow,
    connectedAccountId: r.payment.connectedAccountId,
    applicationFee: { amount: r.payment.applicationFeeMinor, currency: r.order.currency },
    buyerEmail: r.order.buyerEmail,
    description,
    idempotencyKey: `order:${r.order.id}:1`,
    returnUrl: `${origin}${locale === 'en' ? '' : `/${locale}`}/event-portal?paid=1`,
  });
  // A repeated submit (same key) gets the same order and payment; its order already waits for it.
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.order.id, provider: provider.name, providerPaymentId: payment.providerPaymentId },
    createCtx({ orgId, actor: { type: 'anonymous' }, locale }),
    ports,
  ).catch((err) => {
    if (!isDomainError(err) || err.code !== 'conflict') throw err;
  });
  nextRedirect(payment.redirectUrl);
}

export async function buyPackageAction(
  tierId: string,
  description: string,
  idempotencyKey: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  let r: CheckoutResultDto;
  let orgId: string;
  try {
    const { principal, ctx } = await asPortal(idempotencyKey);
    orgId = principal.orgId;
    r = await executeCommand(
      startSponsorPackageCheckoutCommand,
      { tierId, locale: await getLocale() },
      ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return toPayment(orgId, r, description);
}

export async function buyLicensesAction(
  description: string,
  idempotencyKey: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const quantity = numberOrNull(form, 'quantity');
  if (quantity === null || !Number.isInteger(quantity) || quantity < 1)
    return { ok: false, code: 'validation_failed', fields: ['quantity'] };
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  let r: CheckoutResultDto;
  let orgId: string;
  try {
    const { principal, ctx } = await asPortal(idempotencyKey);
    orgId = principal.orgId;
    r = await executeCommand(
      startLeadLicenseCheckoutCommand,
      { quantity, locale: await getLocale() },
      ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return toPayment(orgId, r, description);
}

export async function setDeliverableDoneAction(deliverableId: string, done: boolean): Promise<void> {
  const { ctx } = await asPortal();
  await executeCommand(portalSetDeliverableDoneCommand, { deliverableId, done }, ctx, ports);
  refresh();
}
