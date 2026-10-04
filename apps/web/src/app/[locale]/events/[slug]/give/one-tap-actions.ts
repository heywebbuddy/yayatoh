'use server';

import { applyCardChargeToOrder, giveWithSavedCardCommand } from '@yayatoh/donations';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction } from '@/server/rate-limit.ts';
import { deviceCardToken } from '@/server/saved-card.ts';

const UUID = /^[0-9a-f-]{36}$/;

/**
 * One-tap giving (public, M4.8e): a level's gift charged to the card this device saved for this
 * event (P4-14), off-session on the charity's connected account, exactly the level's amount.
 * The page's Idempotency-Key makes a double tap one gift and one charge; the answer goes through
 * the order like a webhook's, then the thank-you page shows it. Any refusal returns to the page.
 */
export async function giveWithCardAction(
  slug: string,
  campaignId: string,
  idempotencyKey: string,
  levelId: string,
): Promise<void> {
  const locale = await getLocale();
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const back = `${prefix}/events/${slug}/give?c=${campaignId}&tap=failed`;
  if (!UUID.test(campaignId) || !UUID.test(idempotencyKey) || !UUID.test(levelId)) nextRedirect(back);
  const target = await checkoutTarget(slug);
  const event = target ? await publicEventBySlug(slug) : null;
  const token = target ? await deviceCardToken(target.eventId) : null;
  if (!target || !event || !token) nextRedirect(back);
  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) nextRedirect(back);
  let result: Awaited<ReturnType<typeof give>>;
  try {
    result = await give(
      createCtx({ orgId: target.orgId, actor: { type: 'anonymous' }, locale, idempotencyKey }),
      {
        eventId: target.eventId,
        campaignId,
        levelId,
        cardToken: token,
        description: event.name,
      },
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    nextRedirect(back);
  }
  const provider = getPaymentProvider();
  const answer = await provider.chargeSavedCard(result.charge);
  await applyCardChargeToOrder(target.orgId, provider.name, result.charge, answer, ports);
  nextRedirect(`${prefix}/events/${slug}/give/thanks?g=${encodeURIComponent(result.giftToken)}`);
}

const give = (ctx: ReturnType<typeof createCtx>, input: Record<string, unknown>) =>
  executeCommand(giveWithSavedCardCommand, input, ctx, ports);
