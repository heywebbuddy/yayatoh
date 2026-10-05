'use server';

import {
  DISPLAY_AS,
  giftPaymentInput,
  publicGiving,
  startGiftCommand,
  TRIBUTE_KINDS,
} from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError, moneyFromDecimal } from '@yayatoh/kernel';
import { attachPaymentCommand, checkoutRiskSignals } from '@yayatoh/orders';
import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getCheckoutRisk, getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { ownSession } from '@/server/session.ts';

export interface GiveState {
  readonly code: string | null;
  readonly reason?: string;
  /** The first field to fix (its input gets focus and its message). */
  readonly field?: string;
  readonly retryMinutes?: number;
}

const UUID = /^[0-9a-f-]{36}$/;
const text = (form: FormData, key: string, max: number) =>
  String(form.get(key) ?? '')
    .trim()
    .slice(0, max);

/**
 * Give (public, M4.8a). The org and event come from the slug and the campaign from the page; the
 * amount is a level's or the donor's own (checked against the campaign's limits by the command);
 * the fee cover is computed by the command (P4-10). Then the provider's hosted payment page: a
 * direct charge on the connected account with application fee 0 (P4-9). Rate-limited per device
 * and checked by the same risk rules as checkout; the page's Idempotency-Key makes a double submit
 * one gift.
 */
export async function giveAction(
  slug: string,
  campaignId: string,
  idempotencyKey: string,
  /** M4.8d: `qr` when the page was opened from a QR code (screen or table card). */
  source: string,
  _prev: GiveState,
  form: FormData,
): Promise<GiveState> {
  const locale = await getLocale();
  if (!UUID.test(campaignId) || !UUID.test(idempotencyKey)) return { code: 'not_found' };
  const target = await checkoutTarget(slug);
  const event = target ? await publicEventBySlug(slug) : null;
  if (!target || !event) return { code: 'not_found' };
  const giving = await publicGiving(target.orgId, target.eventId);
  const campaign = giving.campaigns.find((c) => c.id === campaignId);
  if (!giving.available) return { code: 'invalid_state', reason: 'not_connected' };
  if (!campaign) return { code: 'invalid_state', reason: 'campaign_closed' };

  // The form, field by field in page order (the first problem is the one shown).
  const choice = String(form.get('choice') ?? '');
  let levelId: string | null = null;
  let amountMinor: number | null = null;
  if (choice.startsWith('level:') && UUID.test(choice.slice(6))) levelId = choice.slice(6);
  else if (choice === 'other') {
    try {
      amountMinor = moneyFromDecimal(text(form, 'amount', 20), campaign.currency).amount;
    } catch {
      return { code: 'validation_failed', field: 'amount', reason: 'amount' };
    }
    if (amountMinor < campaign.minGiftMinor)
      return { code: 'validation_failed', field: 'amount', reason: 'amount_min' };
    if (amountMinor > campaign.maxGiftMinor)
      return { code: 'validation_failed', field: 'amount', reason: 'amount_max' };
  } else return { code: 'validation_failed', field: 'choice', reason: 'choice' };
  const name = text(form, 'name', 120);
  if (!name) return { code: 'validation_failed', field: 'name', reason: 'name' };
  const email = text(form, 'email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { code: 'validation_failed', field: 'email', reason: 'email' };
  const displayAs = String(form.get('displayAs') ?? '');
  if (!(DISPLAY_AS as readonly string[]).includes(displayAs))
    return { code: 'validation_failed', field: 'displayAs', reason: 'displayAs' };
  const tributeKind = String(form.get('tributeKind') ?? 'none');
  const tribute = (TRIBUTE_KINDS as readonly string[]).includes(tributeKind)
    ? {
        kind: tributeKind,
        name: text(form, 'tributeName', 120),
        recipient: text(form, 'tributeRecipient', 120) || null,
        note: text(form, 'tributeNote', 500) || null,
      }
    : null;
  if (tribute && !tribute.name)
    return { code: 'validation_failed', field: 'tributeName', reason: 'tributeName' };

  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
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
  if (risk.action === 'block') return { code: 'forbidden', reason: 'risk_blocked' };

  const session = await ownSession();
  const ctx = createCtx({
    orgId: target.orgId,
    actor: session ? { type: 'user', userId: session.userId } : { type: 'anonymous' },
    locale,
    idempotencyKey,
  });
  let result: Awaited<ReturnType<typeof startGift>>;
  try {
    result = await startGift(ctx, {
      eventId: target.eventId,
      campaignId,
      ...(levelId ? { levelId } : { amountMinor }),
      coverFee: form.get('coverFee') === 'on',
      donor: { name, email },
      displayAs,
      employer: text(form, 'employer', 120) || null,
      tribute,
      locale,
      // P4-13: named on the room's screen only when the donor ticked the box (never when anonymous).
      showOnScreen: form.get('showOnScreen') === 'on' && displayAs !== 'anonymous',
      source: source === 'qr' ? 'qr' : 'online',
    });
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const field = typeof err.details?.field === 'string' ? err.details.field : undefined;
    return {
      code: err.code,
      ...(err.details?.reason ? { reason: String(err.details.reason) } : {}),
      ...(field ? { field } : {}),
    };
  }
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const provider = getPaymentProvider();
  const payment = await provider.createPayment(
    giftPaymentInput(target.orgId, result, {
      description: `${result.campaignName} · ${event.name}`,
      returnUrl: `${origin}${prefix}/events/${slug}/give/thanks?g=${encodeURIComponent(result.giftToken)}`,
    }),
  );
  // A repeated submit (same key) gets the same gift and payment; its order already waits for it.
  await executeCommand(
    attachPaymentCommand,
    { orderId: result.orderId, provider: provider.name, providerPaymentId: payment.providerPaymentId },
    createCtx({ orgId: target.orgId, actor: { type: 'anonymous' }, locale }),
    ports,
  ).catch((err) => {
    if (!isDomainError(err) || err.code !== 'conflict') throw err;
  });
  nextRedirect(payment.redirectUrl);
}

const startGift = (ctx: ReturnType<typeof createCtx>, input: Record<string, unknown>) =>
  executeCommand(startGiftCommand, input, ctx, ports);
