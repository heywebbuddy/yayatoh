import 'server-only';
import { LIVE_CHANNEL, MODERATION_CHANNEL, participantKey, signDisplayToken } from '@yayatoh/engagement';
import { appTokenSecret, realtimeChannelName } from '@yayatoh/platform';
import { DEVICE_COOKIE, isDeviceId, newDeviceId } from '@yayatoh/platform/security';
import { cookies } from 'next/headers';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { getSession } from './session.ts';

/**
 * Live polls and Q&A in the web app (M5.7a). A participant is their account when signed in, else
 * their device cookie; the engagement module only ever sees an HMAC of that, scoped to the session.
 */
const secure = process.env.NODE_ENV === 'production';

/**
 * This visitor's participant key for a session. Pages read it (null without a device cookie yet);
 * Server Actions pass `write` to give a cookie-less browser its device cookie first.
 */
export async function participantKeyFor(
  sessionId: string,
  opts: { write?: boolean } = {},
): Promise<string | null> {
  const session = await getSession();
  if (session) return participantKey(appTokenSecret(), sessionId, `user:${session.userId}`);
  const jar = await cookies();
  let device = jar.get(DEVICE_COOKIE)?.value;
  if (!isDeviceId(device)) {
    if (!opts.write) return null;
    device = newDeviceId();
    jar.set(DEVICE_COOKIE, device, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 400,
    });
  }
  return participantKey(appTokenSecret(), sessionId, `device:${device}`);
}

/** The signed-in person's name, offered as the default name on a question. */
export async function participantName(): Promise<string> {
  return (await getSession())?.name ?? '';
}

/** The big-screen link's token for a session at its current display version. */
export const displayToken = (orgId: string, sessionId: string, version: number) =>
  signDisplayToken({ orgId, sessionId, version }, appTokenSecret());

/** Where the big screen streams from: its own route checks the signed token, not a session. */
export const displayStreamUrl = (token: string) => `/api/engagement/display/${encodeURIComponent(token)}`;

export const liveChannelUrl = (orgId: string, eventId: string, sessionId: string) =>
  realtimeUrl(realtimeChannelName(LIVE_CHANNEL, orgId, eventId, sessionId));

export const moderationChannelUrl = (orgId: string, eventId: string, sessionId: string) =>
  realtimeUrl(realtimeChannelName(MODERATION_CHANNEL, orgId, eventId, sessionId));

/** The app's public origin, for QR codes and links shown to be typed or scanned. */
export const appOrigin = () =>
  (process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  );

/** The locale-neutral participant address of a session (the phone's language picks the page's). */
export const participantPath = (eventSlug: string, sessionId: string) =>
  `/events/${eventSlug}/live/${sessionId}`;
