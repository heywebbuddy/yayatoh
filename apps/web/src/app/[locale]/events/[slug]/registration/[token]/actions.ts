'use server';

import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { addGuestCommand, payApprovedCommand } from '@yayatoh/registration';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { redirectToPayment } from '@/server/registration-pay.ts';

async function target(slug: string) {
  const t = await checkoutTarget(slug);
  const event = t ? await publicEventBySlug(slug) : null;
  return t && event ? { ...t, eventName: event.name } : null;
}

const anon = (orgId: string, locale: string) => createCtx({ orgId, actor: { type: 'anonymous' }, locale });

/**
 * Pay for an approved application (M5.1c). The command returns the open order of an earlier
 * attempt instead of a second one; the payment returns to this page.
 */
export async function payApprovedAction(slug: string, token: string, _prev: FormState): Promise<FormState> {
  const locale = await getLocale();
  const t = await target(slug);
  if (!t) return { ok: false, code: 'not_found' };
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { ok: false, code: 'rate_limited', reason: String(retryAfterMinutes(limit)) };
  const ctx = anon(t.orgId, locale);
  let p: Awaited<ReturnType<typeof pay>>;
  try {
    p = await pay(ctx, token, locale);
  } catch (err) {
    return failure(err);
  }
  if (p.status === 'paid') {
    revalidatePath(`/events/${slug}/registration/${token}`);
    return success();
  }
  return redirectToPayment(t.orgId, t.eventName, locale, ctx, p, `/events/${slug}/registration/${token}`);
}

const pay = (ctx: ReturnType<typeof anon>, token: string, locale: string) =>
  executeCommand(payApprovedCommand, { token, locale }, ctx, ports);

/** Bring a +1 (M5.1c): a guest of a guest type, paid by the host (free guests confirm at once). */
export async function addGuestAction(
  slug: string,
  token: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const locale = await getLocale();
  const t = await target(slug);
  if (!t) return { ok: false, code: 'not_found' };
  const [typeId = '', itemId = ''] = String(form.get('pass') ?? '').split(':');
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const fields = [...(name ? [] : ['name']), ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [] : ['email'])];
  if (fields.length) return { ok: false, code: 'validation_failed', fields };
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { ok: false, code: 'rate_limited' };
  const ctx = anon(t.orgId, locale);
  let r: Awaited<ReturnType<typeof add>>;
  try {
    r = await add(ctx, { token, registrationTypeId: typeId, admissionItemId: itemId, name, email, locale });
  } catch (err) {
    return failure(err);
  }
  const back = `/events/${slug}/registration/${token}`;
  if (r.order.status === 'paid') {
    revalidatePath(back);
    return success();
  }
  return redirectToPayment(
    t.orgId,
    t.eventName,
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

const add = (ctx: ReturnType<typeof anon>, input: Record<string, unknown>) =>
  executeCommand(addGuestCommand, input, ctx, ports);
