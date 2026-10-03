import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { onlineGivingTx, startDonationOrderTx } from '@yayatoh/orders';
import {
  catchUpSubscriber,
  defineSubscriber,
  signLinkToken,
  tenantCommand,
  verifyLinkToken,
} from '@yayatoh/platform';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { campaignOfEventTx, campaignTotalsTx, levelsByCampaignTx } from './campaigns.ts';
import { DEFAULT_PROCESSING_FEE, giftAmountProblem, processingFeeCover } from './domain/giving.ts';
import {
  GiftReceiptDto,
  PublicGivingDto,
  StartGiftInput,
  StartGiftResultDto as StartGiftResult,
  type StartGiftResultDto,
} from './dto.ts';
import { activeMatchesTx } from './match-progress.ts';
import { campaigns, gifts, levels } from './schema.ts';

const GIFT_PURPOSE = 'donations.gift';

/** The thank-you page's link for a gift (HMAC-signed id; shows the gift's status only). */
export const giftToken = (giftId: string) => signLinkToken(GIFT_PURPOSE, giftId);

/**
 * Start a gift (public, the giving page). The campaign must be open and belong to the event; the
 * amount is a level's or an own amount within the campaign's limits; the fee cover is computed
 * here, never taken from the form (P4-10). Creates the gift's order (a donation item, a direct
 * charge on the connected account with application fee 0, P4-9): an unconnected org is refused
 * (`not_connected`). Idempotent: the page's Idempotency-Key makes a double submit one gift.
 */
export const startGiftCommand = tenantCommand({
  name: 'donations.startGift',
  input: StartGiftInput,
  output: StartGiftResult,
  entitlement: 'donations',
  permission: 'public:checkout',
  idempotent: true,
  handler: async ({ input, ctx, tx }): Promise<StartGiftResultDto> => {
    const orgId = requireOrg(ctx);
    const campaign = await campaignOfEventTx(tx, input.eventId, input.campaignId);
    if (campaign.status !== 'open')
      throw new DomainError('invalid_state', 'This campaign is closed', { reason: 'campaign_closed' });
    let amount: number;
    let levelId: string | null = null;
    if (input.levelId) {
      const [level] = await tx
        .select()
        .from(levels)
        .where(and(eq(levels.id, input.levelId), eq(levels.campaignId, campaign.id)));
      if (!level)
        throw new DomainError('validation_failed', 'Choose a level', { reason: 'level', field: 'amount' });
      amount = level.amountMinor;
      levelId = level.id;
    } else {
      amount = input.amountMinor ?? 0;
      const problem = giftAmountProblem(amount, campaign);
      if (problem)
        throw new DomainError('validation_failed', 'Choose an amount within the limits', {
          reason: problem,
          field: 'amount',
          min: campaign.minGiftMinor,
          max: campaign.maxGiftMinor,
        });
    }
    const cover = input.coverFee ? processingFeeCover(amount) : 0;
    const giftId = uuidv7(ctx.now.getTime());
    const started = await startDonationOrderTx(tx, ctx, {
      eventId: input.eventId,
      giftId,
      name: campaign.name,
      amountMinor: amount,
      feeCoverMinor: cover,
      donor: input.donor,
      locale: input.locale,
    });
    await tx.insert(gifts).values({
      id: giftId,
      orgId,
      eventId: input.eventId,
      campaignId: campaign.id,
      levelId,
      orderId: started.order.id,
      amountMinor: amount,
      feeCoverMinor: cover,
      currency: started.order.currency,
      donorName: input.donor.name,
      donorEmail: input.donor.email,
      displayAs: input.displayAs,
      employer: input.employer,
      tributeKind: input.tribute?.kind ?? null,
      tributeName: input.tribute?.name ?? null,
      tributeRecipient: input.tribute?.recipient ?? null,
      tributeNote: input.tribute?.note ?? null,
      locale: input.locale,
    });
    return {
      giftId,
      orderId: started.order.id,
      giftToken: giftToken(giftId),
      amountMinor: amount,
      feeCoverMinor: cover,
      totalMinor: started.order.totalMinor,
      currency: started.order.currency,
      buyerEmail: started.order.buyerEmail,
      campaignName: campaign.name,
      payment: started.payment,
    };
  },
  // No donor details in the audit log: the gift id and the amounts.
  audit: (input, r) => ({
    action: 'donations.gift.start',
    targetType: 'donation_gift',
    targetId: r.giftId,
    data: {
      eventId: input.eventId,
      campaignId: input.campaignId,
      amountMinor: r.amountMinor,
      feeCoverMinor: r.feeCoverMinor,
    },
  }),
});

/**
 * The provider payment for a started gift (the web creates it with the provider): exactly the
 * gift plus the fee cover, a direct charge on the connected account, application fee 0 (P4-9,
 * P4-10). The Idempotency-Key is the order's, so a retried request never charges twice.
 */
export function giftPaymentInput(
  orgId: string,
  r: StartGiftResultDto,
  opts: { description: string; returnUrl: string },
) {
  return {
    orgId,
    orderId: r.orderId,
    amount: { amount: r.amountMinor + r.feeCoverMinor, currency: r.currency },
    fundsFlow: r.payment.fundsFlow,
    connectedAccountId: r.payment.connectedAccountId,
    applicationFee: { amount: r.payment.applicationFeeMinor, currency: r.currency },
    buyerEmail: r.buyerEmail,
    description: opts.description,
    idempotencyKey: `order:${r.orderId}:1`,
    returnUrl: opts.returnUrl,
  } as const;
}

const OrderOutcome = z.object({ orgId: z.uuid(), orderId: z.uuid() });

/** A gift order's outcome → the gift's status (each change only from `pending`; paid also from a lapse). */
async function applyOutcomeTx(tx: TenantTx, orderId: string, to: 'paid' | 'failed' | 'expired', at: Date) {
  const from = to === 'paid' ? ['pending', 'failed', 'expired'] : ['pending'];
  await tx
    .update(gifts)
    .set({ status: to, paidAt: to === 'paid' ? at : null, updatedAt: at })
    .where(and(eq(gifts.orderId, orderId), inArray(gifts.status, from)));
}

/**
 * Gift outcomes from the orders module (outbox): paid, failed or lapsed. Idempotent: a replayed
 * or duplicated event finds the gift already moved and changes nothing, so totals (sums of paid
 * gifts) never count a payment twice.
 */
export const giftOutcomesSubscriber = defineSubscriber({
  name: 'donations.gift-outcomes',
  events: ['order.donation_paid@1', 'order.payment_failed@1', 'order.expired@1'],
  handle: async (tx, event) => {
    const p = OrderOutcome.parse(event.payload);
    const at = event.occurredAt ? new Date(event.occurredAt) : new Date();
    const to =
      event.type === 'order.donation_paid' ? 'paid' : event.type === 'order.expired' ? 'expired' : 'failed';
    await applyOutcomeTx(tx, p.orderId, to, at);
  },
});

/**
 * Apply this org's gift outcomes the subscriber has not handled yet (the pages that show gifts call
 * it, so dev and e2e, where no worker runs, see a payment at once; the worker's relay delivers the
 * same events in production, deduplicated per consumer).
 */
export function catchUpGifts(orgId: string) {
  return catchUpSubscriber(giftOutcomesSubscriber, orgId);
}

/**
 * The giving page's data (public): the event's open campaigns with their levels and totals, and
 * whether the org can take gifts (an enabled connected account, P4-9). Never a donor or a gift.
 */
export async function publicGiving(orgId: string, eventId: string): Promise<PublicGivingDto> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.public' } });
  return withTenant(ctx, async (tx) => {
    const { connected } = await onlineGivingTx(tx);
    const rows = connected
      ? await tx
          .select()
          .from(campaigns)
          .where(and(eq(campaigns.eventId, eventId), eq(campaigns.status, 'open')))
          .orderBy(asc(campaigns.position), asc(campaigns.createdAt))
      : [];
    const ids = rows.map((r) => r.id);
    const [lv, totals, live] = await Promise.all([
      levelsByCampaignTx(tx, ids),
      campaignTotalsTx(tx, ids),
      activeMatchesTx(tx, eventId, ctx.now, ids),
    ]);
    return PublicGivingDto.parse({
      available: connected,
      campaigns: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        goalMinor: r.goalMinor,
        currency: r.currency,
        minGiftMinor: r.minGiftMinor,
        maxGiftMinor: r.maxGiftMinor,
        raisedMinor: totals.get(r.id)?.raisedMinor ?? 0,
        giftCount: totals.get(r.id)?.giftCount ?? 0,
        levels: lv.get(r.id) ?? [],
        matches: live.filter((m) => m.campaignId === r.id),
      })),
      processingFee: DEFAULT_PROCESSING_FEE,
    });
  });
}

/**
 * The thank-you page (reached with the signed gift link from the provider's return URL): the
 * gift's status and amount for this event only, no donor data. null when the link is not valid.
 */
export async function giftReceipt(
  orgId: string,
  eventId: string,
  token: string,
): Promise<GiftReceiptDto | null> {
  const giftId = verifyLinkToken(GIFT_PURPOSE, token);
  if (!giftId) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.receipt' } });
  return withTenant(ctx, async (tx) => {
    const [g] = await tx
      .select({
        status: gifts.status,
        campaignName: campaigns.name,
        amountMinor: gifts.amountMinor,
        feeCoverMinor: gifts.feeCoverMinor,
        currency: gifts.currency,
      })
      .from(gifts)
      .innerJoin(campaigns, eq(campaigns.id, gifts.campaignId))
      .where(and(eq(gifts.id, giftId), eq(gifts.eventId, eventId)));
    return g ? GiftReceiptDto.parse(g) : null;
  });
}
