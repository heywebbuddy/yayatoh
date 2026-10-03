'use server';

import { pledgePaymentInput, startPledgePaymentCommand } from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { attachPaymentCommand } from '@yayatoh/orders';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Pay a pledge by its link (public, M4.8e, P4-12): the provider's hosted page for exactly the
 * pledged amount, a direct charge on the charity's connected account with fee 0. A pledge still
 * waiting for its card charge moves to this payment instead ("pay another way"), so the card is
 * never charged as well. The page's Idempotency-Key makes a double submit one payment.
 */
export async function payPledgeAction(
  slug: string,
  token: string,
  idempotencyKey: string,
  form: FormData,
): Promise<void> {
  const locale = await getLocale();
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const here = `${prefix}/events/${slug}/pledge/${encodeURIComponent(token)}`;
  if (!UUID.test(idempotencyKey)) nextRedirect(here);
  const target = await checkoutTarget(slug);
  const event = target ? await publicEventBySlug(slug) : null;
  if (!target || !event) nextRedirect(here);
  const typed = String(form.get('email') ?? '').trim();
  if (form.has('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) nextRedirect(`${here}?error=email`);
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) nextRedirect(`${here}?error=rate_limited`);
  let r: Awaited<ReturnType<typeof start>>;
  try {
    r = await start(
      createCtx({ orgId: target.orgId, actor: { type: 'anonymous' }, locale, idempotencyKey }),
      {
        token,
        locale,
        email: typed || null,
      },
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    nextRedirect(`${here}?error=${encodeURIComponent(String(err.details?.reason ?? err.code))}`);
  }
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const provider = getPaymentProvider();
  const payment = await provider.createPayment(
    pledgePaymentInput(target.orgId, r, {
      description: `${r.campaignName} · ${event.name}`,
      returnUrl: `${origin}${here}`,
    }),
  );
  await executeCommand(
    attachPaymentCommand,
    { orderId: r.orderId, provider: provider.name, providerPaymentId: payment.providerPaymentId },
    createCtx({ orgId: target.orgId, actor: { type: 'anonymous' }, locale }),
    ports,
  ).catch((err) => {
    if (!isDomainError(err) || err.code !== 'conflict') throw err;
  });
  nextRedirect(payment.redirectUrl);
}

const start = (ctx: ReturnType<typeof createCtx>, input: Record<string, unknown>) =>
  executeCommand(startPledgePaymentCommand, input, ctx, ports);
