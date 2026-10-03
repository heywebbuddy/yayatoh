import 'server-only';
import { withTenant } from '@yayatoh/db';
import { publicGiving } from '@yayatoh/donations';
import { findEventTx } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { cookies } from 'next/headers';

/**
 * M4.8e: the device's saved card for an event (P4-14: always the guest's own device). The cookie
 * holds the card's signed link (its own page's token), so the giving page can offer one-tap gifts;
 * the card itself is checked on every use (active, this event). Three days: tonight and the
 * morning after.
 */
const MAX_AGE_S = 3 * 86_400;
const cardCookie = (eventId: string) => `yy_card_${eventId}`;
const secure = () => (process.env.BETTER_AUTH_URL ?? '').startsWith('https:');

export async function deviceCardToken(eventId: string): Promise<string | null> {
  return (await cookies()).get(cardCookie(eventId))?.value ?? null;
}

export async function rememberCard(eventId: string, cardToken: string) {
  (await cookies()).set(cardCookie(eventId), cardToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export async function forgetCard(eventId: string) {
  (await cookies()).delete(cardCookie(eventId));
}

/**
 * The card-saving entry at guest check-in (M4.8e on M4.4b's check-in; batch 3j merge): while the
 * event takes gifts online (a connected account and an open campaign, P4-9), the event's card page
 * opened from check-in (`?src=checkin`), with its QR path. Null otherwise. The Scan PWA's guest
 * check-in and the day-of page show it right after a guest arrives.
 */
export async function checkinCardEntry(
  orgId: string,
  eventId: string,
): Promise<{ url: string; size: number; d: string } | null> {
  const giving = await publicGiving(orgId, eventId);
  if (!giving.available || giving.campaigns.length === 0) return null;
  const event = await withTenant(
    createCtx({ orgId, actor: { type: 'system', name: 'donations.card' } }),
    (tx) => findEventTx(tx, eventId),
  );
  if (!event) return null;
  // The locale-neutral address: the phone's own language decides the page's (proxy).
  const origin = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const url = `${origin}/events/${event.slug}/card?src=checkin`;
  return { url, ...qrPath(url) };
}
