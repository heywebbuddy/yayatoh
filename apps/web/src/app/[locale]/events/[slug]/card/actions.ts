'use server';

import {
  attachCardSetupCommand,
  type CARD_SOURCES,
  partyCardTarget,
  removeSavedCardCommand,
  startCardSetupCommand,
} from '@yayatoh/donations';
import { checkoutTarget } from '@yayatoh/events';
import { rsvpLinkRef } from '@yayatoh/guests';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { deviceCardToken, forgetCard, rememberCard } from '@/server/saved-card.ts';
import { ownSession } from '@/server/session.ts';

export interface CardState {
  readonly code: string | null;
  readonly reason?: string;
  readonly field?: string;
  readonly retryMinutes?: number;
}

/** Where the card page is: an event's page (check-in and table QR codes, checkout) or a party's own. */
export interface CardTarget {
  readonly slug: string | null;
  readonly rsvpToken: string | null;
  readonly source: (typeof CARD_SOURCES)[number];
}

const UUID = /^[0-9a-f-]{36}$/;
const text = (form: FormData, key: string, max: number) =>
  String(form.get(key) ?? '')
    .trim()
    .slice(0, max);

async function resolve(target: CardTarget) {
  if (target.rsvpToken) {
    const ref = await rsvpLinkRef(target.rsvpToken);
    const party = ref ? await partyCardTarget(ref.orgId, target.rsvpToken) : null;
    return ref && party
      ? {
          orgId: ref.orgId,
          eventId: party.eventId,
          eventName: party.eventName,
          path: `/rsvp/${encodeURIComponent(target.rsvpToken)}/card`,
        }
      : null;
  }
  if (!target.slug) return null;
  const t = await checkoutTarget(target.slug);
  return t
    ? { orgId: t.orgId, eventId: t.eventId, eventName: '', path: `/events/${target.slug}/card` }
    : null;
}

/**
 * Save a card for tonight's giving (public, M4.8e, P4-14): opt-in only, on the guest's own phone.
 * The consent box is required and recorded (text version and time); then the provider's hosted
 * step saves the card on the charity's connected account (a SetupIntent for off-session use).
 * Yayatoh keeps the provider's reference only, never the card. Rate-limited per device; the page's
 * Idempotency-Key makes a double submit one card. This device remembers the card for one-tap gifts.
 */
export async function saveCardAction(
  target: CardTarget,
  idempotencyKey: string,
  _prev: CardState,
  form: FormData,
): Promise<CardState> {
  const locale = await getLocale();
  if (!UUID.test(idempotencyKey)) return { code: 'not_found' };
  const where = await resolve(target);
  if (!where) return { code: 'not_found' };
  const name = text(form, 'name', 120);
  if (!name) return { code: 'validation_failed', field: 'name', reason: 'name' };
  const email = text(form, 'email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { code: 'validation_failed', field: 'email', reason: 'email' };
  if (form.get('consent') !== 'on') return { code: 'validation_failed', field: 'consent', reason: 'consent' };

  const limit = await limitAction('checkoutStart');
  if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  const session = await ownSession();
  const provider = getPaymentProvider();
  const ctx = createCtx({
    orgId: where.orgId,
    actor: session ? { type: 'user', userId: session.userId } : { type: 'anonymous' },
    locale,
    idempotencyKey,
  });
  let started: Awaited<ReturnType<typeof start>>;
  try {
    started = await start(ctx, {
      eventId: where.eventId,
      name,
      email,
      consent: true,
      source: target.source,
      rsvpToken: target.rsvpToken,
      locale,
      provider: provider.name,
    });
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { code: err.code, ...(err.details?.reason ? { reason: String(err.details.reason) } : {}) };
  }
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const setup = await provider.createCardSetup({
    ...started.setup,
    description: where.eventName,
    returnUrl: `${origin}${prefix}${where.path}?saved=1`,
  });
  await executeCommand(
    attachCardSetupCommand,
    { cardId: started.cardId, provider: provider.name, providerSetupId: setup.providerSetupId },
    createCtx({ orgId: where.orgId, actor: { type: 'anonymous' }, locale }),
    ports,
  );
  await rememberCard(where.eventId, started.cardToken);
  nextRedirect(setup.redirectUrl);
}

const start = (ctx: ReturnType<typeof createCtx>, input: Record<string, unknown>) =>
  executeCommand(startCardSetupCommand, input, ctx, ports);

/**
 * Remove this device's saved card (public): it is never charged again (scheduled pledge charges
 * become pay links) and is removed from the charity's customer at the provider.
 */
export async function removeCardAction(target: CardTarget): Promise<void> {
  const locale = await getLocale();
  const where = await resolve(target);
  if (!where) return;
  const token = await deviceCardToken(where.eventId);
  if (token) {
    try {
      const r = await executeCommand(
        removeSavedCardCommand,
        { cardToken: token },
        createCtx({ orgId: where.orgId, actor: { type: 'anonymous' }, locale }),
        ports,
      );
      if (r.detach)
        await getPaymentProvider()
          .detachSavedCard(r.detach)
          .catch(() => undefined);
    } catch (err) {
      if (!isDomainError(err)) throw err;
    }
    await forgetCard(where.eventId);
  }
  const prefix = locale === 'en' ? '' : `/${locale}`;
  nextRedirect(`${prefix}${where.path}?removed=1`);
}
