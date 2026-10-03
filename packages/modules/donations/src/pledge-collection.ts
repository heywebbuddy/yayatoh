import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { paddleHolderContactTx, paddleHolderNamesTx } from '@yayatoh/guests';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  isDomainError,
  requireOrg,
  uuidv7,
} from '@yayatoh/kernel';
import { cancelQueuedTx } from '@yayatoh/notifications';
import { applyProviderEventCommand, attachPaymentCommand, startDonationOrderTx } from '@yayatoh/orders';
import type { PaymentProvider } from '@yayatoh/payments';
import {
  defineSubscriber,
  type Notifier,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  afterDecline,
  COLLECTION_STATUSES,
  cardForHolder,
  chargeTimeFor,
  invoicePlan,
  localDay,
  OFFLINE_METHODS,
  OPEN_COLLECTION_STATUSES,
  REMINDER_DAYS,
  STALE_CHARGE_MINUTES,
  unpaidAlertFrom,
} from './domain/collection.ts';
import { giftToken } from './gifts.ts';
import { type CardChargeDto, cardGiftTx, expireSavedCardsCommand, usableCardTx } from './saved-cards.ts';
import { campaigns, gifts } from './schema.ts';
import { pledgeAttempts, pledgeCollections, savedCards } from './schema-collection.ts';
import { paddleCalls, pledges } from './schema-paddles.ts';

/**
 * M4.8e pledge collection (P4-12). A pledge is a promise, never a charge, until the host closes
 * the night: each confirmed pledge then gets one collection. A holder who saved a card with
 * consent (P4-14) is charged the next morning (09:00 in the event's zone), exactly the pledged
 * amount, once; a decline is retried once a day later, then becomes an invoice. A holder without
 * a card gets an invoice (a pay link, due in 30 days, reminders at +7, +21 and +28 days that are
 * cancelled the moment it is paid). The host can record an offline payment or write a pledge off,
 * with a note. Nothing is ever charged without the saved consent, nor more than pledged.
 */

type CollectionRow = typeof pledgeCollections.$inferSelect;

const PAY_PURPOSE = 'donations.pledge_pay';
export const pledgePayToken = (collectionId: string) => signLinkToken(PAY_PURPOSE, collectionId);
const collectionIdFromToken = (token: string) =>
  token.length > 200 ? null : verifyLinkToken(PAY_PURPOSE, token);
/** The donor's pay page (also "change the card or pay another way" in the summary). */
export const pledgePayUrl = (appOrigin: string, slug: string, collectionId: string) =>
  `${appOrigin.replace(/\/$/, '')}/events/${slug}/pledge/${encodeURIComponent(pledgePayToken(collectionId))}`;

const reminderKeys = (collectionId: string) =>
  REMINDER_DAYS.map((_, i) => `pledge-reminder:${collectionId}:${i + 1}`);

/** Settled: stop the reminders still queued for it. */
async function stopRemindersTx(tx: TenantTx, collectionId: string, reason: string, now: Date) {
  await cancelQueuedTx(tx, reminderKeys(collectionId), reason, now);
}

type Emit = (e: {
  type: string;
  version: number;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}) => void;

/** Move an open collection to an invoice (pay link, due date, reminders through the mailer). */
async function invoiceTx(
  tx: TenantTx,
  emit: Emit,
  c: CollectionRow,
  reason: 'declined' | 'card_removed' | 'pay_link',
  now: Date,
  timeZone: string,
) {
  const plan = invoicePlan(now, timeZone);
  await tx
    .update(pledgeCollections)
    .set({ status: 'invoiced', invoicedAt: now, dueOn: plan.dueOn, claimedAt: null, updatedAt: now })
    .where(eq(pledgeCollections.id, c.id));
  emit({
    type: 'donations.pledge_invoiced',
    version: 1,
    aggregateType: 'pledge_collection',
    aggregateId: c.id,
    payload: { orgId: c.orgId, eventId: c.eventId, collectionId: c.id, reason },
  });
}

async function eventOrThrowTx(tx: TenantTx, eventId: string) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  return event;
}

/** Who holds each pledge (the guest or party behind its paddle), with where their messages go. */
async function holdersTx(
  tx: TenantTx,
  orgId: string,
  rows: readonly { guestId: string | null; partyId: string | null; paddleNumber: number }[],
) {
  const names = await paddleHolderNamesTx(tx, {
    guestIds: rows.flatMap((r) => (r.guestId ? [r.guestId] : [])),
    partyIds: rows.flatMap((r) => (r.partyId ? [r.partyId] : [])),
  });
  const out = new Map<
    string,
    { name: string; partyId: string | null; email: string | null; locale: string }
  >();
  for (const r of rows) {
    const key = r.guestId ?? r.partyId ?? `paddle:${r.paddleNumber}`;
    if (out.has(key)) continue;
    const contact =
      r.guestId || r.partyId
        ? await paddleHolderContactTx(tx, orgId, { guestId: r.guestId, partyId: r.partyId })
        : { partyId: null, email: null, locale: 'en' };
    out.set(key, {
      name: names.get(r.guestId ?? r.partyId ?? '') || `#${r.paddleNumber}`,
      partyId: contact.partyId ?? r.partyId,
      email: contact.email,
      locale: contact.locale,
    });
  }
  return out;
}

const holderKey = (r: { guestId: string | null; partyId: string | null; paddleNumber: number }) =>
  r.guestId ?? r.partyId ?? `paddle:${r.paddleNumber}`;

/** The event's confirmed pledges that have no collection yet (locked). */
async function unclosedPledgesTx(tx: TenantTx, eventId: string, pledgeIds?: readonly string[]) {
  return tx
    .select({
      id: pledges.id,
      campaignId: pledges.campaignId,
      paddleNumber: pledges.paddleNumber,
      guestId: pledges.guestId,
      partyId: pledges.partyId,
      amountMinor: pledges.amountMinor,
      currency: pledges.currency,
    })
    .from(pledges)
    .where(
      and(
        eq(pledges.eventId, eventId),
        eq(pledges.status, 'confirmed'),
        sql`not exists (select 1 from ${pledgeCollections} where ${pledgeCollections.pledgeId} = ${pledges.id})`,
        pledgeIds ? inArray(pledges.id, [...pledgeIds]) : undefined,
      ),
    )
    .orderBy(asc(pledges.confirmedAt), asc(pledges.id))
    .for('update');
}

/**
 * Close the night (the host, after the raise): every confirmed pledge without a collection gets
 * one. A holder's active saved card at this event (their own, their party's, or one saved under
 * their email) is charged the next morning at 09:00 in the event's zone; otherwise the pledge is
 * invoiced (pay link, due in 30 days). Each donor then gets one summary (the mailer). Running it
 * again only picks up pledges confirmed since. Finance roles (`orders:refund`), money category.
 */
export const closePledgesCommand = tenantCommand({
  name: 'donations.closePledges',
  category: 'money',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ cards: z.int(), invoices: z.int(), chargeAt: z.date().nullable() }),
  entitlement: 'donations',
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const event = await eventOrThrowTx(tx, input.eventId);
    const open = await unclosedPledgesTx(tx, event.id);
    if (open.length === 0) return { cards: 0, invoices: 0, chargeAt: null };
    const holders = await holdersTx(tx, orgId, open);
    const cards = await tx
      .select({
        id: savedCards.id,
        partyId: savedCards.partyId,
        guestId: savedCards.guestId,
        email: savedCards.email,
        name: savedCards.name,
        locale: savedCards.locale,
        activatedAt: savedCards.activatedAt,
      })
      .from(savedCards)
      .where(and(eq(savedCards.eventId, event.id), eq(savedCards.status, 'active')));
    const chargeAt = chargeTimeFor(ctx.now, event.timezone);
    const plan = invoicePlan(ctx.now, event.timezone);
    const ids: string[] = [];
    let withCard = 0;
    for (const p of open) {
      const h = holders.get(holderKey(p));
      if (!h) continue;
      const card = cardForHolder(cards, { guestId: p.guestId, partyId: h.partyId, email: h.email });
      const id = uuidv7(ctx.now.getTime());
      const fromCard = card ? cards.find((c) => c.id === card.id) : undefined;
      await tx.insert(pledgeCollections).values({
        id,
        orgId,
        eventId: event.id,
        campaignId: p.campaignId,
        pledgeId: p.id,
        amountMinor: p.amountMinor,
        currency: p.currency,
        donorName: fromCard?.name ?? h.name,
        donorEmail: fromCard?.email ?? h.email,
        locale: fromCard?.locale ?? h.locale,
        closedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        ...(card
          ? { status: 'scheduled', savedCardId: card.id, chargeAt }
          : { status: 'invoiced', invoicedAt: ctx.now, dueOn: plan.dueOn }),
      });
      if (card) withCard++;
      ids.push(id);
    }
    emit({
      type: 'donations.pledges_closed',
      version: 1,
      aggregateType: 'event',
      aggregateId: event.id,
      payload: { orgId, eventId: event.id, collectionIds: ids },
    });
    return { cards: withCard, invoices: ids.length - withCard, chargeAt: withCard ? chargeAt : null };
  },
  audit: (input, r) => ({
    action: 'donations.pledges.close',
    targetType: 'event',
    targetId: input.eventId,
    data: { cards: r.cards, invoices: r.invoices },
  }),
});

export const ClaimedChargeDto = z.object({
  collectionId: z.uuid(),
  attemptId: z.uuid(),
  charge: z.custom<CardChargeDto>(),
});
export type ClaimedChargeDto = z.infer<typeof ClaimedChargeDto>;

/**
 * Claim the charges that are due (system: the worker's collection run, the dev route): a
 * `scheduled` collection whose time has come gets its next try (a gift and an order of exactly
 * the pledged amount) and becomes `charging`; a `charging` one whose run vanished is handed out
 * again with the same order, so the provider call replays under the same key and never charges
 * twice. A card that is no longer usable (removed, expired, another account) is never charged:
 * the pledge is invoiced instead.
 */
export const claimPledgeChargesCommand = tenantCommand({
  name: 'donations.claimPledgeCharges',
  input: z.object({ limit: z.int().min(1).max(200).default(50) }),
  output: z.object({ charges: z.array(ClaimedChargeDto), invoiced: z.int() }),
  entitlement: null,
  permission: 'platform:donations.collect',
  handler: async ({ input, ctx, tx, emit }) => {
    const stale = new Date(ctx.now.getTime() - STALE_CHARGE_MINUTES * 60_000);
    const due = await tx
      .select()
      .from(pledgeCollections)
      .where(
        or(
          and(eq(pledgeCollections.status, 'scheduled'), lte(pledgeCollections.chargeAt, ctx.now)),
          and(eq(pledgeCollections.status, 'charging'), lte(pledgeCollections.claimedAt, stale)),
        ),
      )
      .orderBy(asc(pledgeCollections.chargeAt), asc(pledgeCollections.id))
      .limit(input.limit)
      .for('update', { skipLocked: true });
    const charges: ClaimedChargeDto[] = [];
    let invoiced = 0;
    for (const c of due) {
      const event = await eventOrThrowTx(tx, c.eventId);
      const [card] = c.savedCardId
        ? await tx.select().from(savedCards).where(eq(savedCards.id, c.savedCardId))
        : [];
      if (c.status === 'charging') {
        // Replay the claimed try: the same order, the same key.
        const [a] = await tx
          .select()
          .from(pledgeAttempts)
          .where(
            and(
              eq(pledgeAttempts.collectionId, c.id),
              eq(pledgeAttempts.kind, 'card'),
              eq(pledgeAttempts.attempt, c.cardAttempts),
            ),
          );
        if (a && card?.customerId && card.paymentMethodId) {
          await tx
            .update(pledgeCollections)
            .set({ claimedAt: ctx.now })
            .where(eq(pledgeCollections.id, c.id));
          charges.push({
            collectionId: c.id,
            attemptId: a.id,
            charge: {
              orgId: c.orgId,
              orderId: a.orderId,
              amount: { amount: c.amountMinor, currency: c.currency },
              connectedAccountId: card.connectedAccountId,
              customerId: card.customerId,
              paymentMethodId: card.paymentMethodId,
              description: event.name,
              idempotencyKey: `order:${a.orderId}:1`,
            },
          });
        }
        continue;
      }
      const usable = c.savedCardId ? await usableCardTx(tx, c.savedCardId, c.eventId) : null;
      if (!usable) {
        await invoiceTx(tx, emit, c, 'card_removed', ctx.now, event.timezone);
        invoiced++;
        continue;
      }
      const [campaign] = await tx
        .select({ id: campaigns.id, name: campaigns.name })
        .from(campaigns)
        .where(eq(campaigns.id, c.campaignId));
      if (!campaign) throw new DomainError('internal');
      const attempt = c.cardAttempts + 1;
      let made: Awaited<ReturnType<typeof cardGiftTx>>;
      try {
        made = await tx.transaction((sp) =>
          cardGiftTx(sp, ctx, {
            eventId: c.eventId,
            campaign,
            levelId: null,
            amountMinor: c.amountMinor,
            card: {
              ...usable,
              name: c.donorName,
              email: usable.email,
              locale: c.locale,
            },
            displayAs: 'full_name',
            description: event.name,
          }),
        );
      } catch (err) {
        // The event can no longer take gifts (checkout paused, account changed): ask by invoice.
        if (!isDomainError(err)) throw err;
        await invoiceTx(tx, emit, c, 'card_removed', ctx.now, event.timezone);
        invoiced++;
        continue;
      }
      const attemptId = uuidv7(ctx.now.getTime());
      await tx.insert(pledgeAttempts).values({
        id: attemptId,
        orgId: c.orgId,
        collectionId: c.id,
        kind: 'card',
        attempt,
        giftId: made.giftId,
        orderId: made.orderId,
      });
      await tx
        .update(pledgeCollections)
        .set({ status: 'charging', cardAttempts: attempt, claimedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(pledgeCollections.id, c.id));
      charges.push({ collectionId: c.id, attemptId, charge: made.charge });
    }
    return { charges, invoiced };
  },
  audit: (_i, r) => ({
    action: 'donations.pledges.claim',
    targetType: 'organization',
    targetId: null,
    data: { charges: r.charges.length, invoiced: r.invoiced },
  }),
});

/** Mark a collection paid (from any open state) and stop its reminders. */
async function markPaidTx(tx: TenantTx, collectionId: string, now: Date) {
  const rows = await tx
    .update(pledgeCollections)
    .set({ status: 'paid', paidAt: now, claimedAt: null, updatedAt: now })
    .where(
      and(
        eq(pledgeCollections.id, collectionId),
        inArray(pledgeCollections.status, [...OPEN_COLLECTION_STATUSES]),
      ),
    )
    .returning({ id: pledgeCollections.id });
  await stopRemindersTx(tx, collectionId, 'pledge_paid', now);
  return rows.length === 1;
}

/**
 * The provider's answer to a claimed card charge (system). Succeeded → paid. Declined → the first
 * decline is retried a day later; the second becomes an invoice with a pay link. Idempotent: a
 * replayed answer finds the attempt settled and changes nothing.
 */
export const settleCardChargeCommand = tenantCommand({
  name: 'donations.settleCardCharge',
  input: z.object({
    attemptId: z.uuid(),
    status: z.enum(['succeeded', 'declined']),
    declineCode: z.string().max(80).nullish(),
  }),
  output: z.object({ outcome: z.enum(['paid', 'retry', 'invoiced', 'unchanged']) }),
  entitlement: null,
  permission: 'platform:donations.collect',
  handler: async ({ input, ctx, tx, emit }) => {
    const [a] = await tx
      .select()
      .from(pledgeAttempts)
      .where(eq(pledgeAttempts.id, input.attemptId))
      .for('update');
    if (a?.kind !== 'card') throw new DomainError('not_found', 'Attempt not found');
    const [c] = await tx
      .select()
      .from(pledgeCollections)
      .where(eq(pledgeCollections.id, a.collectionId))
      .for('update');
    if (!c) throw new DomainError('not_found', 'Collection not found');
    if (input.status === 'succeeded') {
      if (a.status === 'pending')
        await tx
          .update(pledgeAttempts)
          .set({ status: 'paid', settledAt: ctx.now, updatedAt: ctx.now })
          .where(eq(pledgeAttempts.id, a.id));
      return { outcome: (await markPaidTx(tx, c.id, ctx.now)) ? ('paid' as const) : ('unchanged' as const) };
    }
    if (a.status !== 'pending') return { outcome: 'unchanged' as const };
    await tx
      .update(pledgeAttempts)
      .set({
        status: 'failed',
        declineCode: input.declineCode ?? 'declined',
        settledAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(pledgeAttempts.id, a.id));
    if (c.status !== 'charging' || c.cardAttempts !== a.attempt) return { outcome: 'unchanged' as const };
    const next = afterDecline(c.cardAttempts, ctx.now);
    if (next.next === 'retry') {
      await tx
        .update(pledgeCollections)
        .set({ status: 'scheduled', chargeAt: next.chargeAt, claimedAt: null, updatedAt: ctx.now })
        .where(eq(pledgeCollections.id, c.id));
      return { outcome: 'retry' as const };
    }
    const event = await eventOrThrowTx(tx, c.eventId);
    await invoiceTx(tx, emit, c, 'declined', ctx.now, event.timezone);
    return { outcome: 'invoiced' as const };
  },
  audit: (input, r) => ({
    action: 'donations.pledges.charge',
    targetType: 'pledge_attempt',
    targetId: input.attemptId,
    data: { status: input.status, declineCode: input.declineCode ?? null, outcome: r.outcome },
  }),
});

const OrderOutcome = z.object({ orgId: z.uuid(), orderId: z.uuid() });

/**
 * Pledge payments from the orders module (outbox): a paid try (a pay link, or a card charge whose
 * answer the run had not recorded yet) settles its pledge and stops the reminders; a failed or
 * lapsed pay-link checkout leaves the invoice open. Idempotent.
 */
export const pledgeOutcomesSubscriber = defineSubscriber({
  name: 'donations.pledge-outcomes',
  events: ['order.donation_paid@1', 'order.payment_failed@1', 'order.expired@1'],
  handle: async (tx, event) => {
    const p = OrderOutcome.parse(event.payload);
    const [a] = await tx
      .select()
      .from(pledgeAttempts)
      .where(eq(pledgeAttempts.orderId, p.orderId))
      .for('update');
    if (!a) return;
    const at = event.occurredAt ? new Date(event.occurredAt) : new Date();
    if (event.type === 'order.donation_paid') {
      if (a.status !== 'paid')
        await tx
          .update(pledgeAttempts)
          .set({ status: 'paid', settledAt: at, updatedAt: at })
          .where(eq(pledgeAttempts.id, a.id));
      await markPaidTx(tx, a.collectionId, at);
      return;
    }
    // Card declines are settled by the run (it knows the decline and plans the retry).
    if (a.kind === 'link' && a.status === 'pending')
      await tx
        .update(pledgeAttempts)
        .set({ status: 'failed', settledAt: at, updatedAt: at })
        .where(eq(pledgeAttempts.id, a.id));
  },
});

// ── the donor's pay link ──────────────────────────────────────────────────────────────────

export const PledgePayResult = z.object({
  collectionId: z.uuid(),
  giftToken: z.string(),
  orderId: z.uuid(),
  amountMinor: z.int(),
  currency: z.string(),
  buyerEmail: z.string(),
  campaignName: z.string(),
  payment: z.object({
    fundsFlow: z.literal('organizer_mor'),
    connectedAccountId: z.string(),
    applicationFeeMinor: z.literal(0),
  }),
});
export type PledgePayResult = z.infer<typeof PledgePayResult>;

/**
 * Pay a pledge by its link (public): a checkout of exactly the pledged amount on the connected
 * account. A pledge still waiting for its card charge moves to the invoice (the donor chose
 * another way, P4-12), so the card is never charged as well. Refused while a charge is in flight
 * and once settled. Idempotent (the page's Idempotency-Key).
 */
export const startPledgePaymentCommand = tenantCommand({
  name: 'donations.startPledgePayment',
  input: z.object({
    token: z.string().min(1).max(200),
    locale: z.string().min(2).max(10).default('en'),
    /** When no email is on file: the donor's, for the receipt (kept on the pledge). */
    email: z.string().trim().toLowerCase().email().max(254).nullish(),
  }),
  output: PledgePayResult,
  entitlement: 'donations',
  permission: 'public:checkout',
  idempotent: true,
  handler: async ({ input, ctx, tx, emit }): Promise<PledgePayResult> => {
    const id = collectionIdFromToken(input.token);
    if (!id) throw new DomainError('not_found', 'Pledge not found');
    const [c] = await tx.select().from(pledgeCollections).where(eq(pledgeCollections.id, id)).for('update');
    if (!c) throw new DomainError('not_found', 'Pledge not found');
    if (c.status === 'charging')
      throw new DomainError('invalid_state', 'Your card is being charged', { reason: 'charging' });
    if (c.status !== 'scheduled' && c.status !== 'invoiced')
      throw new DomainError('invalid_state', 'This pledge is settled', { reason: 'settled' });
    const donorEmail = c.donorEmail ?? input.email ?? null;
    if (!donorEmail)
      throw new DomainError('validation_failed', 'Enter an email for the receipt', {
        reason: 'no_email',
        field: 'email',
      });
    if (!c.donorEmail)
      await tx
        .update(pledgeCollections)
        .set({ donorEmail, updatedAt: ctx.now })
        .where(eq(pledgeCollections.id, c.id));
    const event = await eventOrThrowTx(tx, c.eventId);
    if (c.status === 'scheduled') await invoiceTx(tx, emit, c, 'pay_link', ctx.now, event.timezone);
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    if (!campaign) throw new DomainError('internal');
    const giftId = uuidv7(ctx.now.getTime());
    const started = await startDonationOrderTx(tx, ctx, {
      eventId: c.eventId,
      giftId,
      name: campaign.name,
      amountMinor: c.amountMinor,
      feeCoverMinor: 0,
      donor: { email: donorEmail, name: c.donorName },
      locale: input.locale,
    });
    await tx.insert(gifts).values({
      id: giftId,
      orgId: c.orgId,
      eventId: c.eventId,
      campaignId: c.campaignId,
      orderId: started.order.id,
      amountMinor: c.amountMinor,
      feeCoverMinor: 0,
      currency: started.order.currency,
      donorName: c.donorName,
      donorEmail,
      displayAs: 'full_name',
      locale: input.locale,
    });
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pledgeAttempts)
      .where(and(eq(pledgeAttempts.collectionId, c.id), eq(pledgeAttempts.kind, 'link')));
    await tx.insert(pledgeAttempts).values({
      orgId: c.orgId,
      collectionId: c.id,
      kind: 'link',
      attempt: (n?.n ?? 0) + 1,
      giftId,
      orderId: started.order.id,
    });
    return {
      collectionId: c.id,
      giftToken: giftToken(giftId),
      orderId: started.order.id,
      amountMinor: c.amountMinor,
      currency: started.order.currency,
      buyerEmail: started.order.buyerEmail,
      campaignName: campaign.name,
      payment: started.payment,
    };
  },
  audit: (_input, r) => ({
    action: 'donations.pledges.pay_link',
    targetType: 'pledge_collection',
    targetId: r.collectionId,
    data: { orderId: r.orderId, amountMinor: r.amountMinor },
  }),
});

/** The provider payment for a pledge's pay link: exactly the pledge, a direct charge, fee 0. */
export function pledgePaymentInput(
  orgId: string,
  r: PledgePayResult,
  opts: { description: string; returnUrl: string },
) {
  return {
    orgId,
    orderId: r.orderId,
    amount: { amount: r.amountMinor, currency: r.currency },
    fundsFlow: r.payment.fundsFlow,
    connectedAccountId: r.payment.connectedAccountId,
    applicationFee: { amount: 0, currency: r.currency },
    buyerEmail: r.buyerEmail,
    description: opts.description,
    idempotencyKey: `order:${r.orderId}:1`,
    returnUrl: opts.returnUrl,
  } as const;
}

export const PublicPledgeDto = z.object({
  eventId: z.uuid(),
  status: z.enum(COLLECTION_STATUSES),
  amountMinor: z.int(),
  currency: z.string(),
  campaignName: z.string(),
  levelName: z.string(),
  dueOn: z.string().nullable(),
  chargeAt: z.date().nullable(),
  card: z.object({ brand: z.string().nullable(), last4: z.string().nullable() }).nullable(),
  timeZone: z.string(),
  /** No email on file: the pay page asks for one (for the receipt). */
  needsEmail: z.boolean(),
});
export type PublicPledgeDto = z.infer<typeof PublicPledgeDto>;

/**
 * The donor's pay page (its signed link): the pledge's amount, state, due date and the card it
 * will be charged to. Nothing about other donors. null when the link is not valid.
 */
export async function publicPledge(orgId: string, token: string): Promise<PublicPledgeDto | null> {
  const id = collectionIdFromToken(token);
  if (!id) return null;
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'donations.pledge-pay' } });
  return withTenant(ctx, async (tx) => {
    const [r] = await tx
      .select({
        eventId: pledgeCollections.eventId,
        status: pledgeCollections.status,
        amountMinor: pledgeCollections.amountMinor,
        currency: pledgeCollections.currency,
        campaignName: campaigns.name,
        levelName: paddleCalls.levelName,
        dueOn: pledgeCollections.dueOn,
        chargeAt: pledgeCollections.chargeAt,
        donorEmail: pledgeCollections.donorEmail,
        cardStatus: savedCards.status,
        brand: savedCards.brand,
        last4: savedCards.last4,
      })
      .from(pledgeCollections)
      .innerJoin(campaigns, eq(campaigns.id, pledgeCollections.campaignId))
      .innerJoin(pledges, eq(pledges.id, pledgeCollections.pledgeId))
      .innerJoin(paddleCalls, eq(paddleCalls.id, pledges.callId))
      .leftJoin(savedCards, eq(savedCards.id, pledgeCollections.savedCardId))
      .where(eq(pledgeCollections.id, id));
    if (!r) return null;
    const event = await findEventTx(tx, r.eventId);
    const charging = r.status === 'scheduled' || r.status === 'charging';
    const { donorEmail, ...rest } = r;
    return PublicPledgeDto.parse({
      ...rest,
      needsEmail: !donorEmail,
      chargeAt: charging ? r.chargeAt : null,
      card: charging && r.cardStatus === 'active' ? { brand: r.brand, last4: r.last4 } : null,
      timeZone: event?.timezone ?? 'UTC',
    });
  });
}

// ── the host's console ────────────────────────────────────────────────────────────────────

/** The pledge's collection for a host action: created on the spot when the night isn't closed. */
async function hostCollectionTx(tx: TenantTx, ctx: Ctx, eventId: string, pledgeId: string) {
  const [existing] = await tx
    .select()
    .from(pledgeCollections)
    .where(and(eq(pledgeCollections.pledgeId, pledgeId), eq(pledgeCollections.eventId, eventId)))
    .for('update');
  if (existing) return { collection: existing, created: false };
  const [p] = await unclosedPledgesTx(tx, eventId, [pledgeId]);
  if (!p) throw new DomainError('not_found', 'Pledge not found');
  const holders = await holdersTx(tx, requireOrg(ctx), [p]);
  const h = holders.get(holderKey(p));
  return {
    collection: {
      id: uuidv7(ctx.now.getTime()),
      orgId: requireOrg(ctx),
      eventId,
      campaignId: p.campaignId,
      pledgeId: p.id,
      amountMinor: p.amountMinor,
      currency: p.currency,
      donorName: h?.name ?? `#${p.paddleNumber}`,
      donorEmail: h?.email ?? null,
      locale: h?.locale ?? 'en',
    },
    created: true,
  } as const;
}

async function settleByHostTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { eventId: string; pledgeId: string },
  set: Partial<typeof pledgeCollections.$inferInsert> & { status: 'paid_offline' | 'written_off' },
) {
  const { collection: c, created } = await hostCollectionTx(tx, ctx, input.eventId, input.pledgeId);
  const by = ctx.actor.type === 'user' ? ctx.actor.userId : null;
  if (created) {
    await tx.insert(pledgeCollections).values({ ...c, ...set, settledBy: by });
    return c.id;
  }
  const row = c as CollectionRow;
  if (row.status === 'charging')
    throw new DomainError('invalid_state', 'The card is being charged right now', { reason: 'charging' });
  if (row.status !== 'scheduled' && row.status !== 'invoiced')
    throw new DomainError('invalid_state', 'This pledge is settled', { reason: 'settled' });
  await tx
    .update(pledgeCollections)
    .set({ ...set, claimedAt: null, settledBy: by, updatedAt: ctx.now })
    .where(eq(pledgeCollections.id, row.id));
  await stopRemindersTx(
    tx,
    row.id,
    set.status === 'paid_offline' ? 'pledge_paid' : 'pledge_written_off',
    ctx.now,
  );
  return row.id;
}

const PledgeRef = z.object({ eventId: z.uuid(), pledgeId: z.uuid() });

/**
 * Record a payment the host received for a pledge (check, wire, stock, donor-advised fund, cash):
 * the pledge is paid and its charge and reminders stop. Finance roles (`orders:refund`), money
 * category, idempotent, audited with the method (the reference and note stay in the console).
 */
export const recordPledgePaymentCommand = tenantCommand({
  name: 'donations.recordPledgePayment',
  category: 'money',
  input: PledgeRef.extend({
    method: z.enum(OFFLINE_METHODS),
    reference: z.string().trim().max(120).nullish(),
    receivedOn: z.iso.date(),
    note: z.string().trim().max(500).nullish(),
  }),
  output: z.object({ collectionId: z.uuid() }),
  entitlement: 'donations',
  permission: 'orders:refund',
  idempotent: true,
  handler: async ({ input, ctx, tx }) => {
    const event = await eventOrThrowTx(tx, input.eventId);
    if (input.receivedOn > localDay(ctx.now, event.timezone))
      throw new DomainError('validation_failed', 'The date is in the future', {
        reason: 'future',
        field: 'receivedOn',
      });
    const collectionId = await settleByHostTx(tx, ctx, input, {
      status: 'paid_offline',
      paidAt: ctx.now,
      offlineMethod: input.method,
      offlineReference: input.reference || null,
      receivedOn: input.receivedOn,
      note: input.note || null,
    });
    return { collectionId };
  },
  audit: (input, r) => ({
    action: 'donations.pledges.offline',
    targetType: 'pledge_collection',
    targetId: r.collectionId,
    data: { pledgeId: input.pledgeId, method: input.method, receivedOn: input.receivedOn },
  }),
});

/** Write a pledge off with a note (the host's decision; never automatic). Finance roles, money. */
export const writeOffPledgeCommand = tenantCommand({
  name: 'donations.writeOffPledge',
  category: 'money',
  input: PledgeRef.extend({ note: z.string().trim().min(1).max(500) }),
  output: z.object({ collectionId: z.uuid() }),
  entitlement: 'donations',
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx }) => {
    const collectionId = await settleByHostTx(tx, ctx, input, { status: 'written_off', note: input.note });
    return { collectionId };
  },
  audit: (input, r) => ({
    action: 'donations.pledges.write_off',
    targetType: 'pledge_collection',
    targetId: r.collectionId,
    data: { pledgeId: input.pledgeId },
  }),
});

export const PledgeRowDto = z.object({
  pledgeId: z.uuid(),
  paddleNumber: z.int(),
  holderName: z.string(),
  levelName: z.string(),
  amountMinor: z.int(),
  currency: z.string(),
  /** `open`: the night isn't closed for it yet. */
  status: z.enum(['open', ...COLLECTION_STATUSES]),
  card: z.object({ brand: z.string().nullable(), last4: z.string().nullable() }).nullable(),
  chargeAt: z.date().nullable(),
  dueOn: z.string().nullable(),
  cardAttempts: z.int(),
  declineCode: z.string().nullable(),
  emailed: z.boolean(),
  paidAt: z.date().nullable(),
  offlineMethod: z.enum(OFFLINE_METHODS).nullable(),
  note: z.string().nullable(),
  /** The donor's pay link token (the host shares it when there is no email on file). */
  payToken: z.string().nullable(),
});
export type PledgeRowDto = z.infer<typeof PledgeRowDto>;

export const PledgeCollectionDto = z.object({
  eventName: z.string(),
  eventSlug: z.string(),
  timeZone: z.string(),
  currency: z.string(),
  rows: z.array(PledgeRowDto),
  totals: z.object({
    pledgedMinor: z.int(),
    paidMinor: z.int(),
    openMinor: z.int(),
    writtenOffMinor: z.int(),
  }),
  savedCards: z.int(),
  unclosed: z.int(),
});
export type PledgeCollectionDto = z.infer<typeof PledgeCollectionDto>;

/** The host's pledge collection page: every confirmed pledge with how it is being collected. */
export const pledgeCollectionQuery = tenantQuery({
  name: 'donations.pledgeCollection',
  input: z.object({ eventId: z.uuid() }),
  output: PledgeCollectionDto,
  entitlement: 'donations',
  permission: 'orders:read',
  handler: async ({ input, tx }): Promise<PledgeCollectionDto> => {
    const event = await eventOrThrowTx(tx, input.eventId);
    const rows = await tx
      .select({
        pledgeId: pledges.id,
        paddleNumber: pledges.paddleNumber,
        guestId: pledges.guestId,
        partyId: pledges.partyId,
        levelName: paddleCalls.levelName,
        amountMinor: pledges.amountMinor,
        currency: pledges.currency,
        c: pledgeCollections,
        brand: savedCards.brand,
        last4: savedCards.last4,
      })
      .from(pledges)
      .innerJoin(paddleCalls, eq(paddleCalls.id, pledges.callId))
      .leftJoin(pledgeCollections, eq(pledgeCollections.pledgeId, pledges.id))
      .leftJoin(savedCards, eq(savedCards.id, pledgeCollections.savedCardId))
      .where(and(eq(pledges.eventId, event.id), eq(pledges.status, 'confirmed')))
      .orderBy(asc(pledges.paddleNumber), asc(pledges.confirmedAt));
    const names = await paddleHolderNamesTx(tx, {
      guestIds: rows.flatMap((r) => (r.guestId ? [r.guestId] : [])),
      partyIds: rows.flatMap((r) => (r.partyId ? [r.partyId] : [])),
    });
    const collectionIds = rows.flatMap((r) => (r.c ? [r.c.id] : []));
    const declines = new Map<string, string | null>();
    if (collectionIds.length)
      for (const a of await tx
        .select({ collectionId: pledgeAttempts.collectionId, code: pledgeAttempts.declineCode })
        .from(pledgeAttempts)
        .where(and(inArray(pledgeAttempts.collectionId, collectionIds), eq(pledgeAttempts.status, 'failed')))
        .orderBy(desc(pledgeAttempts.createdAt)))
        if (!declines.has(a.collectionId)) declines.set(a.collectionId, a.code);
    const [cards] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(savedCards)
      .where(and(eq(savedCards.eventId, event.id), eq(savedCards.status, 'active')));
    const totals = { pledgedMinor: 0, paidMinor: 0, openMinor: 0, writtenOffMinor: 0 };
    const out = rows.map((r) => {
      const c = r.c;
      const status = (c?.status ?? 'open') as PledgeRowDto['status'];
      totals.pledgedMinor += r.amountMinor;
      if (status === 'paid' || status === 'paid_offline') totals.paidMinor += r.amountMinor;
      else if (status === 'written_off') totals.writtenOffMinor += r.amountMinor;
      else totals.openMinor += r.amountMinor;
      return {
        pledgeId: r.pledgeId,
        paddleNumber: r.paddleNumber,
        holderName: names.get(r.guestId ?? r.partyId ?? '') || `#${r.paddleNumber}`,
        levelName: r.levelName,
        amountMinor: r.amountMinor,
        currency: r.currency,
        status,
        card: c?.savedCardId ? { brand: r.brand, last4: r.last4 } : null,
        chargeAt: status === 'scheduled' || status === 'charging' ? (c?.chargeAt ?? null) : null,
        dueOn: c?.dueOn ?? null,
        cardAttempts: c?.cardAttempts ?? 0,
        declineCode: c ? (declines.get(c.id) ?? null) : null,
        emailed: Boolean(c?.donorEmail),
        paidAt: c?.paidAt ?? null,
        offlineMethod: (c?.offlineMethod ?? null) as PledgeRowDto['offlineMethod'],
        note: c?.note ?? null,
        payToken: c && (status === 'scheduled' || status === 'invoiced') ? pledgePayToken(c.id) : null,
      };
    });
    return {
      eventName: event.name,
      eventSlug: event.slug,
      timeZone: event.timezone,
      currency: event.currency,
      rows: out,
      totals,
      savedCards: cards?.n ?? 0,
      unclosed: out.filter((r) => r.status === 'open').length,
    };
  },
});

/**
 * The alerts engine's facts (counts only): pledges still unpaid 14 days after the event (P4-12:
 * "12 pledges ($18,500) unpaid 14 days after the event"), including those whose night was never
 * closed. Zero before then.
 */
export async function unpaidPledgeFactsTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
): Promise<{ count: number; amountMinor: number; currency: string | null }> {
  const event = await findEventTx(tx, eventId);
  if (!event || now.getTime() < unpaidAlertFrom(event.endsAt).getTime())
    return { count: 0, amountMinor: 0, currency: null };
  const [r] = await tx
    .select({
      n: sql<number>`count(*)::int`,
      sum: sql<string>`coalesce(sum(${pledges.amountMinor}), 0)::text`,
      currency: sql<string | null>`min(${pledges.currency})`,
    })
    .from(pledges)
    .leftJoin(pledgeCollections, eq(pledgeCollections.pledgeId, pledges.id))
    .where(
      and(
        eq(pledges.eventId, eventId),
        eq(pledges.status, 'confirmed'),
        or(isNull(pledgeCollections.id), inArray(pledgeCollections.status, [...OPEN_COLLECTION_STATUSES])),
      ),
    );
  return { count: r?.n ?? 0, amountMinor: Number(r?.sum ?? 0), currency: r?.currency ?? null };
}

/**
 * Events with pledges still unpaid 14 days after they ended (the alerts sweep evaluates them
 * although they are over). At most 200, newest pledges first.
 */
export async function unpaidPledgeEventIdsTx(tx: TenantTx, now: Date): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ eventId: pledges.eventId })
    .from(pledges)
    .leftJoin(pledgeCollections, eq(pledgeCollections.pledgeId, pledges.id))
    .where(
      and(
        eq(pledges.status, 'confirmed'),
        or(isNull(pledgeCollections.id), inArray(pledgeCollections.status, [...OPEN_COLLECTION_STATUSES])),
      ),
    )
    .limit(200);
  const out: string[] = [];
  for (const r of rows) {
    const event = await findEventTx(tx, r.eventId);
    if (event && now.getTime() >= unpaidAlertFrom(event.endsAt).getTime()) out.push(r.eventId);
  }
  return out;
}

// ── messages ──────────────────────────────────────────────────────────────────────────────

const ClosedPayload = z.object({ orgId: z.uuid(), eventId: z.uuid(), collectionIds: z.array(z.uuid()) });
const InvoicedPayload = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  collectionId: z.uuid(),
  reason: z.enum(['declined', 'card_removed', 'pay_link']),
});

const money = (minor: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minor / 10 ** fractionDigits(currency),
  );
const fractionDigits = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
const when = (at: Date, locale: string, timeZone: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone }).format(at);
const day = (d: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

/**
 * The donor's messages (P4-12), through the notifications core: after the night is closed, one
 * summary per donor (their pledges; the card and the charge time, or the pay links and the due
 * date); an invoice when a card charge falls back to a pay link; and the reminders at +7, +21 and
 * +28 days, queued with their send time and cancelled the moment the pledge is settled. Messages
 * go to the donor only and are deduplicated per collection.
 */
export function pledgeMailer(deps: { notifier: Notifier; appOrigin: string }) {
  async function remindersTx(
    tx: TenantTx,
    c: CollectionRow,
    slug: string,
    eventName: string,
    timeZone: string,
  ) {
    if (!c.donorEmail || !c.invoicedAt || !c.dueOn) return;
    const plan = invoicePlan(c.invoicedAt, timeZone);
    const keys = reminderKeys(c.id);
    for (const [i, sendAfter] of plan.reminders.entries())
      await deps.notifier.enqueue(tx, {
        kind: 'donations.pledge-reminder',
        to: { email: c.donorEmail, name: c.donorName, userId: null, locale: c.locale, timeZone },
        params: {
          url: pledgePayUrl(deps.appOrigin, slug, c.id),
          name: c.donorName,
          eventName,
          amountMinor: c.amountMinor,
          currency: c.currency,
          dueOn: day(c.dueOn, c.locale),
          step: i + 1,
        },
        dedupeKey: keys[i] ?? `pledge-reminder:${c.id}:${i + 1}`,
        eventId: c.eventId,
        sendAfter,
      });
  }

  return defineSubscriber({
    name: 'donations.pledge-mailer',
    events: ['donations.pledges_closed@1', 'donations.pledge_invoiced@1'],
    handle: async (tx, event) => {
      if (event.type === 'donations.pledges_closed') {
        const p = ClosedPayload.parse(event.payload);
        if (p.collectionIds.length === 0) return;
        const ev = await findEventTx(tx, p.eventId);
        if (!ev) return;
        const rows = await tx
          .select({
            c: pledgeCollections,
            levelName: paddleCalls.levelName,
            brand: savedCards.brand,
            last4: savedCards.last4,
          })
          .from(pledgeCollections)
          .innerJoin(pledges, eq(pledges.id, pledgeCollections.pledgeId))
          .innerJoin(paddleCalls, eq(paddleCalls.id, pledges.callId))
          .leftJoin(savedCards, eq(savedCards.id, pledgeCollections.savedCardId))
          .where(inArray(pledgeCollections.id, p.collectionIds))
          .orderBy(asc(pledgeCollections.createdAt));
        const byDonor = new Map<string, typeof rows>();
        for (const r of rows) {
          if (!r.c.donorEmail) continue;
          const key = `${r.c.donorEmail.toLowerCase()}|${r.c.status === 'scheduled' ? 'card' : 'invoice'}`;
          byDonor.set(key, [...(byDonor.get(key) ?? []), r]);
        }
        for (const list of byDonor.values()) {
          const first = list[0];
          if (!first?.c.donorEmail) continue;
          const c = first.c;
          const card = c.status === 'scheduled';
          const total = list.reduce((s, r) => s + r.c.amountMinor, 0);
          const body = list
            .map((r) =>
              card
                ? `${r.levelName}: ${money(r.c.amountMinor, r.c.currency, c.locale)}`
                : `${r.levelName}: ${money(r.c.amountMinor, r.c.currency, c.locale)} — ${pledgePayUrl(deps.appOrigin, ev.slug, r.c.id)}`,
            )
            .join('\n');
          await deps.notifier.enqueue(tx, {
            kind: 'donations.pledge-summary',
            to: {
              email: c.donorEmail ?? '',
              name: c.donorName,
              userId: null,
              locale: c.locale,
              timeZone: ev.timezone,
            },
            params: {
              url: pledgePayUrl(deps.appOrigin, ev.slug, c.id),
              name: c.donorName,
              eventName: ev.name,
              amountMinor: total,
              currency: c.currency,
              mode: card ? 'card' : 'invoice',
              card: card ? `${first.brand ?? ''} ${first.last4 ?? ''}`.trim() : '',
              chargeAt: card && c.chargeAt ? when(c.chargeAt, c.locale, ev.timezone) : '',
              dueOn: !card && c.dueOn ? day(c.dueOn, c.locale) : '',
              body,
            },
            dedupeKey: `pledge-summary:${c.id}`,
            eventId: ev.id,
          });
          if (!card) for (const r of list) await remindersTx(tx, r.c, ev.slug, ev.name, ev.timezone);
        }
        return;
      }
      const p = InvoicedPayload.parse(event.payload);
      const [c] = await tx.select().from(pledgeCollections).where(eq(pledgeCollections.id, p.collectionId));
      const ev = await findEventTx(tx, p.eventId);
      if (!c || !ev || c.status !== 'invoiced' || !c.donorEmail) return;
      if (p.reason !== 'pay_link' && c.dueOn)
        await deps.notifier.enqueue(tx, {
          kind: 'donations.pledge-invoice',
          to: {
            email: c.donorEmail,
            name: c.donorName,
            userId: null,
            locale: c.locale,
            timeZone: ev.timezone,
          },
          params: {
            url: pledgePayUrl(deps.appOrigin, ev.slug, c.id),
            name: c.donorName,
            eventName: ev.name,
            amountMinor: c.amountMinor,
            currency: c.currency,
            reason: p.reason,
            dueOn: day(c.dueOn, c.locale),
          },
          dedupeKey: `pledge-invoice:${c.id}`,
          eventId: ev.id,
        });
      await remindersTx(tx, c, ev.slug, ev.name, ev.timezone);
    },
  });
}

// ── the run ───────────────────────────────────────────────────────────────────────────────

/**
 * Record a saved card's off-session answer on its order (attach, then the provider event as the
 * webhook would apply it: deduplicated by event id), so the gift, the ledger and the receipt follow
 * the usual path. Safe to replay.
 */
export async function applyCardChargeToOrder(
  orgId: string,
  providerName: 'fake' | 'stripe',
  charge: CardChargeDto,
  result: { providerPaymentId: string; status: 'succeeded' | 'declined' },
  ports: CommandPorts<TenantTx>,
  now?: Date,
) {
  const ctx = createCtx({
    orgId,
    actor: { type: 'system', name: 'donations.card-charge' },
    ...(now ? { now } : {}),
  });
  await executeCommand(
    attachPaymentCommand,
    { orderId: charge.orderId, provider: providerName, providerPaymentId: result.providerPaymentId },
    ctx,
    ports,
  ).catch((err) => {
    // A replay finds the order already moved on (paid or failed): the event below decides.
    if (!isDomainError(err)) throw err;
  });
  return executeCommand(
    applyProviderEventCommand,
    {
      provider: providerName,
      id: `${providerName}:card-charge:${result.providerPaymentId}`,
      type: result.status === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
      providerPaymentId: result.providerPaymentId,
      amountMinor: charge.amount.amount,
      currency: charge.amount.currency,
      orgId,
      orderId: charge.orderId,
    },
    ctx,
    ports,
  );
}

export interface CollectRunResult {
  readonly charged: number;
  readonly declined: number;
  readonly invoiced: number;
  readonly cardsRemoved: number;
}

/**
 * One collection run for an org (the worker every few minutes; the dev route in dev and e2e):
 * claim the due charges, charge each saved card off-session under its order's key, record the
 * answer on the order and on the pledge, then remove the cards whose 30 days have passed.
 */
export async function collectPledges(
  orgId: string,
  deps: { provider: PaymentProvider; ports: CommandPorts<TenantTx> },
  opts: { now?: Date } = {},
): Promise<CollectRunResult> {
  const ctx = createCtx({
    orgId,
    actor: { type: 'system', name: 'donations.collect' },
    ...(opts.now ? { now: opts.now } : {}),
  });
  const claimed = await executeCommand(claimPledgeChargesCommand, {}, ctx, deps.ports);
  let charged = 0;
  let declined = 0;
  let invoiced = claimed.invoiced;
  for (const c of claimed.charges) {
    const result = await deps.provider.chargeSavedCard(c.charge);
    await applyCardChargeToOrder(orgId, deps.provider.name, c.charge, result, deps.ports, opts.now);
    const settled = await executeCommand(
      settleCardChargeCommand,
      { attemptId: c.attemptId, status: result.status, declineCode: result.declineCode ?? null },
      ctx,
      deps.ports,
    );
    if (result.status === 'succeeded') charged++;
    else declined++;
    if (settled.outcome === 'invoiced') invoiced++;
  }
  const expired = await executeCommand(expireSavedCardsCommand, {}, ctx, deps.ports);
  for (const d of expired.detach) await deps.provider.detachSavedCard(d).catch(() => undefined);
  return { charged, declined, invoiced, cardsRemoved: expired.detach.length };
}
