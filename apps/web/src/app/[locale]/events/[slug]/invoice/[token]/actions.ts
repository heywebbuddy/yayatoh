'use server';

import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand, moneyFromDecimal } from '@yayatoh/kernel';
import { attachInvoicePaymentCommand, startInvoicePaymentCommand } from '@yayatoh/orders';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import type { FormState } from '@/lib/form-state.ts';
import { failure } from '@/server/form.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

/**
 * Pay all or part of an invoice (M5.1d, public; the invoice's signed link): a payment on the org's
 * funds flow. The form carries an Idempotency-Key minted when the page was rendered, so a double
 * submit (or a retried request) reuses the same pending payment and the same provider payment
 * (`invoice_payment:<id>`): it never charges twice. The payment returns to this page.
 */
export async function payInvoiceAction(
  slug: string,
  token: string,
  currency: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const locale = await getLocale();
  const target = await checkoutTarget(slug);
  const event = target ? await publicEventBySlug(slug) : null;
  if (!target || !event) return { ok: false, code: 'not_found' };
  const raw = String(form.get('amount') ?? '')
    .trim()
    .replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(raw) || Number(raw) <= 0)
    return { ok: false, code: 'validation_failed', fields: ['amount'], reason: 'amount_required' };
  const key = String(form.get('key') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(key)) return { ok: false, code: 'validation_failed' };
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { ok: false, code: 'rate_limited', reason: String(retryAfterMinutes(limit)) };
  const ctx = createCtx({ orgId: target.orgId, actor: { type: 'anonymous' }, locale });
  const provider = getPaymentProvider();
  let redirectUrl: string;
  try {
    const p = await executeCommand(
      startInvoicePaymentCommand,
      { token, amountMinor: moneyFromDecimal(raw, currency).amount },
      { ...ctx, idempotencyKey: `invoice-pay:${key}` },
      ports,
    );
    const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
    const back = `${locale === 'en' ? '' : `/${locale}`}/events/${slug}/invoice/${token}?paid=1`;
    const payment = await provider.createPayment({
      orgId: target.orgId,
      orderId: p.orderId,
      amount: { amount: p.amountMinor, currency: p.currency },
      fundsFlow: p.fundsFlow,
      connectedAccountId: p.connectedAccountId,
      applicationFee: { amount: p.applicationFeeMinor, currency: p.currency },
      buyerEmail: p.buyerEmail,
      description: `${p.label} · ${p.eventName}`,
      idempotencyKey: `invoice_payment:${p.paymentId}`,
      returnUrl: `${origin}${back}`,
    });
    await executeCommand(
      attachInvoicePaymentCommand,
      { paymentId: p.paymentId, provider: provider.name, providerPaymentId: payment.providerPaymentId },
      ctx,
      ports,
    );
    redirectUrl = payment.redirectUrl;
  } catch (err) {
    return failure(err);
  }
  nextRedirect(redirectUrl);
}
