import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { guestsPartyCredentials } from '@yayatoh/guests';
import { type Ctx, createCtx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { startDonationOrderTx } from '@yayatoh/orders';
import { claimProviderEventTx, fundsFlowTx } from '@yayatoh/payments';
import { signLinkToken, tenantCommand, verifyLinkToken } from '@yayatoh/platform';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { campaignOfEventTx } from './campaigns.ts';
import { CARD_SOURCES, CARD_STATUSES, cardRemoveAfter } from './domain/collection.ts';
import { DISPLAY_AS, giftAmountProblem } from './domain/giving.ts';
import { giftToken } from './gifts.ts';
import { CARD_CONSENT_VERSION } from './legal/card-consent.ts';
import { gifts, levels } from './schema.ts';
import { savedCards } from './schema-collection.ts';

/**
 * M4.8e cards on file (P4-14): opt-in only, always on the guest's own device. A saved card is
 * created `pending` with the consent (text version and time) recorded, the provider's hosted step
 * saves it on the organizer's connected account (a SetupIntent for off-session use), and the
 * verified setup webhook makes it `active`. Yayatoh keeps only the provider's references and the
 * card's brand, last four and expiry. A card serves gifts and pledges at its own event only and
 * is removed 30 days after it.
 */

const CARD_PURPOSE = 'donations.saved_card';
/** The card's own page link (the guest's device keeps it to give with one tap). */
export const savedCardToken = (cardId: string) => signLinkToken(CARD_PURPOSE, cardId);
export const savedCardIdFromToken = (token: string) =>
  token.length > 200 ? null : verifyLinkToken(CARD_PURPOSE, token);

const Email = z.string().trim().toLowerCase().email().max(254);

export const StartCardSetupInput = z.object({
  eventId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  email: Email,
  /** The guest ticked the authorization (P4-14): never saved without it. */
  consent: z.literal(true),
  source: z.enum(CARD_SOURCES),
  /** The party's own link (its QR code on the table): the card pays that party's pledges. */
  rsvpToken: z.string().min(1).max(200).nullish(),
  locale: z.string().min(2).max(10).default('en'),
  provider: z.enum(['fake', 'stripe']).default('fake'),
});

export const CardSetupDto = z.object({
  cardId: z.uuid(),
  cardToken: z.string(),
  /** What the web passes to `PaymentProvider.createCardSetup` (server-side only). */
  setup: z.object({
    orgId: z.uuid(),
    reference: z.uuid(),
    connectedAccountId: z.string(),
    email: z.string(),
    name: z.string(),
    idempotencyKey: z.string(),
  }),
});
export type CardSetupDto = z.infer<typeof CardSetupDto>;

/**
 * Start saving a card (public: the card page). The event must be on sale and not over, and the
 * org connected (cards live on its connected account); the consent box must be ticked. A party
 * link ties the card to that party. Idempotent: the page's Idempotency-Key makes a double submit
 * one card.
 */
export const startCardSetupCommand = tenantCommand({
  name: 'donations.startCardSetup',
  input: StartCardSetupInput,
  output: CardSetupDto,
  entitlement: 'donations',
  permission: 'public:checkout',
  idempotent: true,
  handler: async ({ input, ctx, tx }): Promise<CardSetupDto> => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (event?.status !== 'published') throw new DomainError('not_found', 'Event not found');
    if (event.endsAt.getTime() <= ctx.now.getTime())
      throw new DomainError('invalid_state', 'This event is over', { reason: 'event_over' });
    const flow = await fundsFlowTx(tx);
    if (flow.fundsFlow !== 'organizer_mor' || !flow.accountId)
      throw new DomainError('invalid_state', 'Online giving needs a connected payout account', {
        reason: 'not_connected',
      });
    let partyId: string | null = null;
    if (input.rsvpToken) {
      const party = await guestsPartyCredentials.partyByLinkTx(tx, input.rsvpToken, ctx.now);
      if (!party || party.eventId !== event.id)
        throw new DomainError('validation_failed', 'This link is not valid', { reason: 'link' });
      partyId = party.partyId;
    }
    const cardId = uuidv7(ctx.now.getTime());
    await tx.insert(savedCards).values({
      id: cardId,
      orgId,
      eventId: event.id,
      partyId,
      name: input.name,
      email: input.email,
      source: input.rsvpToken ? 'party' : input.source,
      provider: input.provider,
      connectedAccountId: flow.accountId,
      consentVersion: CARD_CONSENT_VERSION,
      consentedAt: ctx.now,
      locale: input.locale,
    });
    return {
      cardId,
      cardToken: savedCardToken(cardId),
      setup: {
        orgId,
        reference: cardId,
        connectedAccountId: flow.accountId,
        email: input.email,
        name: input.name,
        idempotencyKey: `card:${cardId}`,
      },
    };
  },
  // No card holder details in the audit log.
  audit: (input, r) => ({
    action: 'donations.card.start',
    targetType: 'saved_card',
    targetId: r.cardId,
    data: { eventId: input.eventId, source: input.source, consentVersion: CARD_CONSENT_VERSION },
  }),
});

/** Record the provider's hosted setup on the pending card (once). */
export const attachCardSetupCommand = tenantCommand({
  name: 'donations.attachCardSetup',
  input: z.object({
    cardId: z.uuid(),
    provider: z.enum(['fake', 'stripe']),
    providerSetupId: z.string().min(1).max(255),
  }),
  output: z.object({ attached: z.boolean() }),
  entitlement: 'donations',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(savedCards)
      .set({ provider: input.provider, providerSetupId: input.providerSetupId, updatedAt: ctx.now })
      .where(and(eq(savedCards.id, input.cardId), eq(savedCards.status, 'pending')))
      .returning({ id: savedCards.id, setup: savedCards.providerSetupId });
    return { attached: rows.length === 1 };
  },
  audit: (input) => ({
    action: 'donations.card.setup',
    targetType: 'saved_card',
    targetId: input.cardId,
    data: { provider: input.provider },
  }),
});

const SetupEventInput = z.object({
  provider: z.enum(['fake', 'stripe']),
  id: z.string().min(1),
  type: z.enum(['setup.succeeded', 'setup.failed']),
  orgId: z.uuid(),
  reference: z.string(),
  providerSetupId: z.string(),
  customerId: z.string().optional(),
  paymentMethodId: z.string().optional(),
  brand: z.string().max(40).optional(),
  last4: z.string().max(4).optional(),
  expMonth: z.int().optional(),
  expYear: z.int().optional(),
});

/**
 * A verified card-setup webhook: deduplicated by the provider's event id; the card must be the
 * reference's, pending, with the same hosted setup (when recorded). Succeeded → `active` (usable
 * until 30 days after the event); failed → `failed`.
 */
export const applyCardSetupCommand = tenantCommand({
  name: 'donations.applyCardSetup',
  input: SetupEventInput,
  output: z.object({ outcome: z.enum(['applied', 'duplicate', 'ignored']), status: z.string() }),
  entitlement: null,
  permission: 'platform:payments.webhook',
  handler: async ({ input, ctx, tx }) => {
    if (!(await claimProviderEventTx(tx, input)))
      return { outcome: 'duplicate' as const, status: 'unchanged' };
    const cardId = z.uuid().safeParse(input.reference);
    if (!cardId.success) return { outcome: 'ignored' as const, status: 'unknown' };
    const [card] = await tx.select().from(savedCards).where(eq(savedCards.id, cardId.data)).for('update');
    if (card?.status !== 'pending') return { outcome: 'ignored' as const, status: card?.status ?? 'unknown' };
    if (card.providerSetupId && card.providerSetupId !== input.providerSetupId)
      throw new DomainError('conflict', 'Setup does not match the card');
    if (input.type === 'setup.failed' || !input.customerId || !input.paymentMethodId) {
      await tx
        .update(savedCards)
        .set({
          status: 'failed',
          provider: input.provider,
          providerSetupId: input.providerSetupId,
          updatedAt: ctx.now,
        })
        .where(eq(savedCards.id, card.id));
      return { outcome: 'applied' as const, status: 'failed' };
    }
    const event = await findEventTx(tx, card.eventId);
    await tx
      .update(savedCards)
      .set({
        status: 'active',
        provider: input.provider,
        providerSetupId: input.providerSetupId,
        customerId: input.customerId,
        paymentMethodId: input.paymentMethodId,
        brand: input.brand ?? null,
        last4: input.last4 ?? null,
        expMonth: input.expMonth ?? null,
        expYear: input.expYear ?? null,
        activatedAt: ctx.now,
        removeAfter: event ? cardRemoveAfter(event.endsAt) : ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(savedCards.id, card.id));
    return { outcome: 'applied' as const, status: 'active' };
  },
  audit: (input, r) => ({
    action: 'donations.card.provider_event',
    targetType: 'saved_card',
    targetId: z.uuid().safeParse(input.reference).success ? input.reference : null,
    data: { provider: input.provider, eventId: input.id, type: input.type, outcome: r.outcome },
  }),
});

/** What the web passes to `PaymentProvider.detachSavedCard` (server-side only). */
const DetachDto = z.object({
  cardId: z.uuid(),
  connectedAccountId: z.string(),
  paymentMethodId: z.string(),
  idempotencyKey: z.string(),
});

const detachOf = (c: typeof savedCards.$inferSelect) =>
  c.paymentMethodId
    ? {
        cardId: c.id,
        connectedAccountId: c.connectedAccountId,
        paymentMethodId: c.paymentMethodId,
        idempotencyKey: `card-remove:${c.id}`,
      }
    : null;

/**
 * The guest removes their saved card (public, with the card's own link). It is never used again:
 * its scheduled pledge charges become invoices at their next run. Returns the provider removal
 * for the web to make.
 */
export const removeSavedCardCommand = tenantCommand({
  name: 'donations.removeSavedCard',
  category: 'delete',
  input: z.object({ cardToken: z.string().min(1).max(200) }),
  output: z.object({ removed: z.boolean(), detach: DetachDto.nullable() }),
  entitlement: 'donations',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx }) => {
    const id = savedCardIdFromToken(input.cardToken);
    if (!id) throw new DomainError('not_found', 'Card not found');
    const [card] = await tx.select().from(savedCards).where(eq(savedCards.id, id)).for('update');
    if (!card) throw new DomainError('not_found', 'Card not found');
    if (card.status === 'removed') return { removed: false, detach: null };
    await tx
      .update(savedCards)
      .set({ status: 'removed', removedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(savedCards.id, card.id));
    return { removed: true, detach: card.status === 'active' ? detachOf(card) : null };
  },
  audit: (_input, r) => ({
    action: 'donations.card.remove',
    targetType: 'saved_card',
    targetId: r.detach?.cardId ?? null,
    data: { removed: r.removed, by: 'guest' },
  }),
});

/**
 * P4-14: saved cards are removed from the charity's customer 30 days after the event (system;
 * the worker's collection run and the dev route). Returns the provider removals to make.
 */
export const expireSavedCardsCommand = tenantCommand({
  name: 'donations.expireSavedCards',
  input: z.object({ limit: z.int().min(1).max(500).default(200) }),
  output: z.object({ detach: z.array(DetachDto) }),
  entitlement: null,
  permission: 'platform:donations.collect',
  handler: async ({ input, ctx, tx }) => {
    const due = await tx
      .select()
      .from(savedCards)
      .where(and(eq(savedCards.status, 'active'), lte(savedCards.removeAfter, ctx.now)))
      .limit(input.limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return { detach: [] };
    await tx
      .update(savedCards)
      .set({ status: 'removed', removedAt: ctx.now, updatedAt: ctx.now })
      .where(
        inArray(
          savedCards.id,
          due.map((c) => c.id),
        ),
      );
    return { detach: due.map(detachOf).filter((d): d is NonNullable<typeof d> => d !== null) };
  },
  audit: (_i, r) => ({
    action: 'donations.card.expire',
    targetType: 'saved_card',
    targetId: null,
    data: { removed: r.detach.length },
  }),
});

// ── the guest's card ──────────────────────────────────────────────────────────────────────

export const SavedCardViewDto = z.object({
  eventId: z.uuid(),
  status: z.enum(CARD_STATUSES),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
});
export type SavedCardViewDto = z.infer<typeof SavedCardViewDto>;

/** The card's own page (its signed link): the card's state and display details, for its owner only. */
export async function savedCardView(orgId: string, token: string): Promise<SavedCardViewDto | null> {
  const id = savedCardIdFromToken(token);
  if (!id) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.saved-card' } });
  return withTenant(ctx, async (tx) => {
    const [c] = await tx
      .select({
        eventId: savedCards.eventId,
        status: savedCards.status,
        brand: savedCards.brand,
        last4: savedCards.last4,
      })
      .from(savedCards)
      .where(eq(savedCards.id, id));
    return c ? SavedCardViewDto.parse(c) : null;
  });
}

// ── one-tap giving ────────────────────────────────────────────────────────────────────────

/** A saved card's off-session charge, as the web passes it to `PaymentProvider.chargeSavedCard`. */
export const CardChargeDto = z.object({
  orgId: z.uuid(),
  orderId: z.uuid(),
  amount: z.object({ amount: z.int().positive(), currency: z.string() }),
  connectedAccountId: z.string(),
  customerId: z.string(),
  paymentMethodId: z.string(),
  description: z.string(),
  idempotencyKey: z.string(),
});
export type CardChargeDto = z.infer<typeof CardChargeDto>;

/** An active card of this event, for charging; null when it is not (no consent, no charge). */
export async function usableCardTx(tx: TenantTx, cardId: string, eventId: string) {
  const [c] = await tx.select().from(savedCards).where(eq(savedCards.id, cardId));
  return c && c.status === 'active' && c.eventId === eventId && c.customerId && c.paymentMethodId
    ? (c as typeof c & { customerId: string; paymentMethodId: string })
    : null;
}

/**
 * Create the gift and its order for a saved card's charge: exactly `amountMinor` (no fee cover),
 * the donor as the card's holder. The order key `order:<id>:1` makes a replayed charge the same.
 */
export async function cardGiftTx(
  tx: TenantTx,
  ctx: Ctx,
  input: {
    eventId: string;
    campaign: { id: string; name: string };
    levelId: string | null;
    amountMinor: number;
    card: {
      name: string;
      email: string;
      locale: string;
      connectedAccountId: string;
      customerId: string;
      paymentMethodId: string;
    };
    displayAs: (typeof DISPLAY_AS)[number];
    description: string;
  },
): Promise<{ giftId: string; orderId: string; currency: string; charge: CardChargeDto }> {
  const orgId = requireOrg(ctx);
  const giftId = uuidv7(ctx.now.getTime());
  const started = await startDonationOrderTx(tx, ctx, {
    eventId: input.eventId,
    giftId,
    name: input.campaign.name,
    amountMinor: input.amountMinor,
    feeCoverMinor: 0,
    donor: { email: input.card.email, name: input.card.name },
    locale: input.card.locale,
  });
  // A card on another account than the org's current one cannot be charged there.
  if (started.payment.connectedAccountId !== input.card.connectedAccountId)
    throw new DomainError('invalid_state', 'The card was saved on another account', {
      reason: 'card_account',
    });
  await tx.insert(gifts).values({
    id: giftId,
    orgId,
    eventId: input.eventId,
    campaignId: input.campaign.id,
    levelId: input.levelId,
    orderId: started.order.id,
    amountMinor: input.amountMinor,
    feeCoverMinor: 0,
    currency: started.order.currency,
    donorName: input.card.name,
    donorEmail: input.card.email,
    displayAs: input.displayAs,
    locale: input.card.locale,
  });
  return {
    giftId,
    orderId: started.order.id,
    currency: started.order.currency,
    charge: {
      orgId,
      orderId: started.order.id,
      amount: { amount: input.amountMinor, currency: started.order.currency },
      connectedAccountId: input.card.connectedAccountId,
      customerId: input.card.customerId,
      paymentMethodId: input.card.paymentMethodId,
      description: input.description,
      idempotencyKey: `order:${started.order.id}:1`,
    },
  };
}

export const GiveWithCardInput = z
  .object({
    eventId: z.uuid(),
    campaignId: z.uuid(),
    levelId: z.uuid().nullish(),
    amountMinor: z.int().positive().max(100_000_000).nullish(),
    cardToken: z.string().min(1).max(200),
    displayAs: z.enum(DISPLAY_AS).default('full_name'),
    description: z.string().max(250).default(''),
  })
  .refine((v) => Boolean(v.levelId) !== Boolean(v.amountMinor), { message: 'Choose a level or an amount' });

export const GiveWithCardResult = z.object({
  giftId: z.uuid(),
  giftToken: z.string(),
  orderId: z.uuid(),
  amountMinor: z.int(),
  currency: z.string(),
  charge: CardChargeDto,
});
export type GiveWithCardResult = z.infer<typeof GiveWithCardResult>;

/**
 * One-tap giving (public, the giving page on the guest's phone): a gift charged to the card the
 * guest saved on this device, at this event only. Same campaign and amount rules as a gift; no
 * fee cover. Idempotent: the page's Idempotency-Key makes a double tap one gift and one charge.
 */
export const giveWithSavedCardCommand = tenantCommand({
  name: 'donations.giveWithSavedCard',
  input: GiveWithCardInput,
  output: GiveWithCardResult,
  entitlement: 'donations',
  permission: 'public:checkout',
  idempotent: true,
  handler: async ({ input, ctx, tx }): Promise<GiveWithCardResult> => {
    const cardId = savedCardIdFromToken(input.cardToken);
    const card = cardId ? await usableCardTx(tx, cardId, input.eventId) : null;
    if (!card) throw new DomainError('invalid_state', 'This card cannot be used', { reason: 'card' });
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
    const made = await cardGiftTx(tx, ctx, {
      eventId: input.eventId,
      campaign,
      levelId,
      amountMinor: amount,
      card,
      displayAs: input.displayAs,
      description: input.description || campaign.name,
    });
    return {
      giftId: made.giftId,
      giftToken: giftToken(made.giftId),
      orderId: made.orderId,
      amountMinor: amount,
      currency: made.currency,
      charge: made.charge,
    };
  },
  audit: (input, r) => ({
    action: 'donations.gift.one_tap',
    targetType: 'donation_gift',
    targetId: r.giftId,
    data: { eventId: input.eventId, campaignId: input.campaignId, amountMinor: r.amountMinor },
  }),
});

/** The party behind a link and its event (the party's card page, reached by its QR code). */
export async function partyCardTarget(
  orgId: string,
  token: string,
): Promise<{ eventId: string; eventName: string; slug: string; partyName: string } | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.saved-card' } });
  return withTenant(ctx, async (tx) => {
    const party = await guestsPartyCredentials.partyByLinkTx(tx, token, ctx.now);
    if (!party) return null;
    const event = await findEventTx(tx, party.eventId);
    return event
      ? { eventId: event.id, eventName: event.name, slug: event.slug, partyName: party.partyName }
      : null;
  });
}
