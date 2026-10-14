import { withTenant } from '@yayatoh/db';
import { checkoutTarget, orgUnavailableForEvent, publicEventBySlug } from '@yayatoh/events';
import { publicForm } from '@yayatoh/forms';
import { createCtx, DomainError, executeCommand } from '@yayatoh/kernel';
import {
  type AppCheckoutInput,
  type AppCheckoutResultDto,
  attachPaymentCommand,
  orderPaymentStateTx,
  recordCheckoutBlockCommand,
  startAppCheckoutCommand,
} from '@yayatoh/orders';
import { hasRegistration } from '@yayatoh/registration';
import { seatedTicketTypeIds } from '@yayatoh/seating';
import { publicTicketTypes, transferFeeTicketTypeIds } from '@yayatoh/ticketing';
import { streamingTicketTypeIds } from '@yayatoh/virtual';
import type { z } from 'zod';
import type { MeContext, V1Deps } from './context.ts';
import { platformLimiter } from './platform-limiter.ts';
import { idempotent } from './routes/common.ts';
import { resolveMobile } from './versions.ts';

/**
 * Checkout for the mobile apps (M7.2f, decision P7-7). The app buys a cart it can finish natively
 * (passes with a quantity, a promo code) through the same steps as the web's `checkoutAction`: hold
 * and price (`startCheckoutTx`), the provider payment, then attach it. Payment happens on the
 * provider's hosted page in a secure in-app browser; the return and cancel links are universal
 * links the app opens.
 *
 * Carts the app cannot finish natively get the web checkout URL instead (nothing is held):
 * checkout questions, seat selection, registration types with approval, a pass whose holders pay
 * a transfer fee, choose-your-amount passes. Passes that give access to a stream are refused
 * (`buy_on_web`): Apple requires in-app purchase for live one-to-many services.
 */

/** Why a cart finishes on the web. */
export const WEB_REASONS = [
  'checkout_questions',
  'seat_selection',
  'registration',
  'transfer_fee',
  'choose_your_amount',
] as const;
export type WebReason = (typeof WEB_REASONS)[number];

export interface CartFacts {
  /** Passes in the cart that give access to the stream. */
  readonly streaming: readonly string[];
  /** Passes in the cart that are sold by seat. */
  readonly seated: readonly string[];
  /** Passes in the cart whose holders pay a transfer fee. */
  readonly transferFee: readonly string[];
  /** Passes in the cart where the buyer chooses the amount. */
  readonly chooseAmount: readonly string[];
  /** The event sells through registration types (approvals, groups, guests). */
  readonly registration: boolean;
  /** The event asks checkout questions. */
  readonly questions: boolean;
}

/** The first reason the cart cannot be finished in the app (pure; the order is the order of `WEB_REASONS`). */
export function webReasonOf(f: CartFacts): WebReason | null {
  if (f.registration) return 'registration';
  if (f.seated.length > 0) return 'seat_selection';
  if (f.questions) return 'checkout_questions';
  if (f.transferFee.length > 0) return 'transfer_fee';
  if (f.chooseAmount.length > 0) return 'choose_your_amount';
  return null;
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

/**
 * The event's page on the web, where the web checkout runs (opened in the same browser session as
 * the app's sign-in hand-off). Tracked as a visit from the app (UTM) like any tracked link.
 */
export function webCheckoutUrl(webBase: string, slug: string, occurrenceId?: string): string {
  const q = new URLSearchParams({ utm_source: 'yayatoh-app', utm_medium: 'app' });
  if (occurrenceId) q.set('date', occurrenceId);
  return `${trimSlash(webBase)}/events/${slug}?${q}`;
}

/** Where the hosted payment page sends the buyer back: universal links the app opens (`/events/*`). */
export function returnUrls(webBase: string, slug: string, orderId: string) {
  const link = (checkout: 'return' | 'cancelled') => {
    const q = new URLSearchParams({ checkout, order: orderId });
    return `${trimSlash(webBase)}/events/${slug}?${q}`;
  };
  return { returnUrl: link('return'), cancelUrl: link('cancelled') };
}

export type AppCheckoutBody = {
  readonly items: readonly { ticketTypeId: string; quantity: number }[];
  readonly occurrenceId?: string | undefined;
  readonly name?: string | undefined;
  readonly promoCode?: string | undefined;
  readonly marketingOptIn?: boolean | undefined;
};

export type AppCheckoutOutcome =
  | {
      readonly action: 'pay';
      readonly orderId: string;
      readonly paymentUrl: string;
      readonly expiresAt: Date | null;
    }
  | { readonly action: 'paid'; readonly orderId: string }
  | { readonly action: 'web'; readonly reason: WebReason; readonly webUrl: string };

/** The buyer's name for the order: what they gave, else their account name, else the address's local part. */
function buyerName(me: MeContext, given: string | undefined): string {
  const name = (given ?? me.user.name ?? '').trim() || me.user.email.split('@')[0] || 'Guest';
  return name.slice(0, 120);
}

export async function appCheckout(
  deps: V1Deps,
  args: {
    readonly me: MeContext;
    readonly slug: string;
    readonly body: AppCheckoutBody;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly ip: string | null;
  },
): Promise<AppCheckoutOutcome> {
  const { me, slug, body } = args;
  const webBase = resolveMobile(deps.mobile).baseUrls.web;

  // Each checkout start holds stock: the web's `checkoutStart` policy, per signed-in person (the
  // phone has no device cookie, so the person stands in for the device) and per client IP.
  const decision = await (deps.checkoutLimiter ?? platformLimiter()).check('checkoutStart', {
    device: `user-${me.user.id}`,
    ip: args.ip,
  });
  if (!decision.allowed)
    throw new DomainError('rate_limited', 'Too many checkouts started', {
      retryAfter: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)),
    });

  const target = await checkoutTarget(slug);
  if (!target) {
    // The page was opened before staff suspended or closed the org (M1.3f): say so plainly.
    if (await orgUnavailableForEvent(slug))
      throw new DomainError('invalid_state', 'The organizer is not selling right now', {
        reason: 'org_suspended',
      });
    throw new DomainError('not_found', 'Event not found');
  }
  const event = await publicEventBySlug(slug);
  if (!event) throw new DomainError('not_found', 'Event not found');

  const ids = body.items.map((i) => i.ticketTypeId);
  if (new Set(ids).size !== ids.length)
    throw new DomainError('validation_failed', 'List each pass once', { field: 'items' });
  const [streaming, seated, transferFee, passes, registration, questions] = await Promise.all([
    streamingTicketTypeIds(target.orgId, target.eventId, ids),
    seatedTicketTypeIds(target.orgId, target.eventId, ids),
    transferFeeTicketTypeIds(target.orgId, target.eventId, ids),
    publicTicketTypes(slug),
    hasRegistration(target.orgId, target.eventId),
    publicForm(target.orgId, {
      kind: 'checkout_questions',
      subjectType: 'event',
      subjectId: target.eventId,
    }),
  ]);
  const webUrl = webCheckoutUrl(webBase, slug, body.occurrenceId);

  // P7-7: live access is not sold in the app. Refused outright, even in a mixed cart.
  if (streaming.length > 0)
    throw new DomainError('invalid_state', 'This ticket is bought on the web', {
      reason: 'buy_on_web',
      webUrl,
      ticketTypeIds: streaming,
    });

  const reason = webReasonOf({
    streaming,
    seated,
    transferFee,
    chooseAmount: passes.filter((p) => ids.includes(p.id) && p.isDonation).map((p) => p.id),
    registration,
    questions: questions !== null,
  });
  if (reason) return { action: 'web', reason, webUrl };

  const ctx = createCtx({
    orgId: target.orgId,
    requestId: args.requestId,
    idempotencyKey: args.idempotencyKey,
    actor: { type: 'user', userId: me.user.id },
    locale: me.ctx.locale,
  });
  const input: z.input<typeof AppCheckoutInput> = {
    eventId: target.eventId,
    items: body.items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
    ...(body.occurrenceId ? { occurrenceId: body.occurrenceId } : {}),
    // The address is the session's verified one: it is what finds the person's tickets afterwards.
    buyer: { email: me.user.email, name: buyerName(me, body.name) },
    marketingOptIn: body.marketingOptIn === true,
    ...(body.promoCode?.trim() ? { promoCode: body.promoCode.trim() } : {}),
    locale: ctx.locale.slice(0, 10),
  };

  let started: AppCheckoutResultDto;
  try {
    started = await executeCommand(idempotent(startAppCheckoutCommand), input, ctx, deps.ports);
  } catch (err) {
    if (err instanceof DomainError && err.code === 'forbidden' && err.details?.reason === 'risk_blocked') {
      // M1.9e: the refused attempt becomes a fraud signal for the organizer; recording it never
      // changes the buyer's answer, which carries no rule names or counts.
      try {
        await executeCommand(
          recordCheckoutBlockCommand,
          {
            eventId: target.eventId,
            email: me.user.email.slice(0, 320),
            rules: (err.details.rules as string[]) ?? ['unknown'],
            emailOrders: Number(err.details.emailOrders ?? 0),
            paymentFailures: Number(err.details.paymentFailures ?? 0),
          },
          createCtx({ ...ctx, idempotencyKey: null }),
          deps.ports,
        );
      } catch (recordErr) {
        console.warn(`checkout block not recorded: ${(recordErr as Error).message}`);
      }
      throw new DomainError('forbidden', 'This order cannot be placed', { reason: 'risk_blocked' });
    }
    throw err;
  }

  const { order, payment: flow } = started;
  if (order.status === 'paid') return { action: 'paid', orderId: order.id };

  // A replay (the same Idempotency-Key) arrives here with the stored order; its payment may already
  // exist, and it may have lapsed meanwhile. Read where the order stands now.
  const state = await withTenant(ctx, (tx) => orderPaymentStateTx(tx, order.id));
  if (!state) throw new DomainError('not_found', 'Order not found');
  if (state.status === 'paid') return { action: 'paid', orderId: order.id };
  if (!state.open)
    throw new DomainError('invalid_state', 'This order is no longer open', {
      reason: 'hold_expired',
      orderId: order.id,
    });

  const provider = deps.payments();
  const { returnUrl, cancelUrl } = returnUrls(webBase, slug, order.id);
  const payment = await provider.createPayment({
    orgId: target.orgId,
    orderId: order.id,
    amount: { amount: order.totalMinor, currency: order.currency },
    fundsFlow: flow.fundsFlow,
    connectedAccountId: flow.connectedAccountId,
    applicationFee: { amount: flow.applicationFeeMinor, currency: order.currency },
    buyerEmail: order.buyerEmail,
    // The line the buyer sees on the hosted payment page and their card statement.
    description: event.name,
    // Stable per order, as on the web: a retried request never creates a second payment.
    idempotencyKey: `order:${order.id}:1`,
    returnUrl,
    cancelUrl,
  });
  let expiresAt = state.expiresAt;
  if (state.status !== 'awaiting_payment') {
    const attached = await executeCommand(
      attachPaymentCommand,
      {
        orderId: order.id,
        provider: payment.provider ?? provider.name,
        providerPaymentId: payment.providerPaymentId,
      },
      createCtx({ ...ctx, idempotencyKey: null }),
      deps.ports,
    );
    expiresAt = attached.expiresAt;
  }
  return { action: 'pay', orderId: order.id, paymentUrl: payment.redirectUrl, expiresAt };
}
