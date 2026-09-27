import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';
import { type AccessGrantDto, accessGrant } from '@yayatoh/events';
import { appTokenSecret, signLinkToken, verifyLinkToken } from '@yayatoh/platform';
import { cookies } from 'next/headers';

const DEVICE_COOKIE = 'yy_device';
const ACCESS_PURPOSE = 'event-access';
const accessCookie = (eventId: string) => `yy_access_${eventId.replace(/-/g, '')}`;
const secure = process.env.NODE_ENV === 'production';

/**
 * The rate-limit key for public forms (access codes, quote requests): an HMAC of a per-device
 * cookie, scoped by purpose. Keyed to the device rather than the IP so shared networks (venue
 * Wi-Fi, CGNAT) don't lock each other out (roadmap §6.1); never stores an address. Server
 * Actions only (it may set the cookie).
 */
export async function clientKey(purpose: string): Promise<string> {
  const jar = await cookies();
  let device = jar.get(DEVICE_COOKIE)?.value;
  if (!device || !/^[0-9a-f-]{36}$/.test(device)) {
    device = randomUUID();
    jar.set(DEVICE_COOKIE, device, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return createHmac('sha256', appTokenSecret()).update(`${purpose}:${device}`).digest('base64url');
}

/** Remember an access code the visitor redeemed for one event (signed; the server re-checks it). */
export async function rememberAccess(eventId: string, grant: AccessGrantDto): Promise<void> {
  const jar = await cookies();
  const maxAge = grant.expiresAt
    ? Math.max(60, Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000))
    : 60 * 60 * 24 * 30;
  jar.set(accessCookie(eventId), signLinkToken(ACCESS_PURPOSE, grant.codeId), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
}

/** The live grant from the visitor's cookie for this event, or null (missing, forged or lapsed). */
export async function currentAccess(orgId: string, eventId: string): Promise<AccessGrantDto | null> {
  const token = (await cookies()).get(accessCookie(eventId))?.value;
  const codeId = token ? verifyLinkToken(ACCESS_PURPOSE, token) : null;
  return codeId ? accessGrant(orgId, eventId, codeId) : null;
}
