import 'server-only';
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
