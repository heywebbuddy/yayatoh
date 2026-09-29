import 'server-only';
import {
  createPortalSession,
  endPortalSession,
  type PortalLimits,
  type PortalPrincipal,
  portalCtx,
  portalPrincipalBySession,
} from '@yayatoh/events';
import { type Ctx, DomainError, executeQuery } from '@yayatoh/kernel';
import { signLinkToken, verifyLinkToken } from '@yayatoh/platform';
import { DEVICE_COOKIE } from '@yayatoh/platform/security';
import { speakerPortalQuery } from '@yayatoh/program';
import { cookies, headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { cache } from 'react';
import { ports } from './ports.ts';
import { clientIp, rateLimiter } from './rate-limit.ts';
import { requestHost } from './request-origin.ts';

/**
 * Portal sessions in the browser (M5.3a, P5-7): speakers (and, from M5.4a, exhibitor admins and
 * staff, sponsor contacts) sign in with an emailed code or magic link from their invitation. The
 * cookie `yy_portal` (`__Host-` on HTTPS) is host-only and httpOnly, separate from organizer and
 * attendee sessions, and names its org; the session row stores only an HMAC of its secret. The
 * tenant comes from that cookie (and the invitation token), never from a header.
 */
const COOKIE = 'yy_portal';
const PENDING = 'yy_pp';

const https = async () => (await requestHost()).protocol === 'https:';
const cookieName = async (base: string) => ((await https()) ? `__Host-${base}` : base);

async function setCookie(base: string, value: string, maxAgeS: number) {
  (await cookies()).set(await cookieName(base), value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await https(),
    path: '/',
    maxAge: Math.max(1, maxAgeS),
  });
}
const readCookie = async (base: string) => (await cookies()).get(await cookieName(base))?.value ?? null;

/** The M1.14 limiter and this request's device cookie and IP. */
export async function portalLimits(): Promise<PortalLimits> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return {
    limiter: rateLimiter(),
    subject: { device: c.get(DEVICE_COOKIE)?.value ?? null, ip: clientIp(h) },
  };
}

/** Sign this browser in as a verified account (session bound to this host). */
export async function signInPortal(orgId: string, accountId: string): Promise<void> {
  const { host } = await requestHost();
  const s = await createPortalSession({ orgId, accountId, host });
  await setCookie(COOKIE, s.token, Math.floor((s.expiresAt.getTime() - Date.now()) / 1000));
  (await cookies()).delete(await cookieName(PENDING));
}

/**
 * Sign this browser out: the session row is revoked, so the cookie opens nothing. The cookie is
 * left for the next sign-in to replace (changing it would re-render the page before the browser
 * loads the signed-out one).
 */
export async function signOutPortal(): Promise<void> {
  await endPortalSession(await readCookie(COOKIE));
}

/** The signed-in portal principal on this host, or null (once per request). */
export const currentPortalPrincipal = cache(async (): Promise<PortalPrincipal | null> => {
  const token = await readCookie(COOKIE);
  if (!token) return null;
  return portalPrincipalBySession(token, (await requestHost()).host);
});

/**
 * The shared portal sign-in foundation (M5.3a; M5.4a codes against this shape): the signed-in
 * principal `{ orgId, eventId, eventRoleAssignmentId, role, subjectId, … }`, or `forbidden`.
 * Pages that should show a sign-in hint instead use `currentPortalPrincipal()`.
 */
export async function requirePortalPrincipal(): Promise<PortalPrincipal> {
  const p = await currentPortalPrincipal();
  if (!p) throw new DomainError('forbidden', 'Portal sign-in required');
  return p;
}

/** A command context for the signed-in principal (its org, its portal actor, this locale). */
export async function portalRequestCtx(p: PortalPrincipal): Promise<Ctx> {
  return portalCtx(p, await getLocale());
}

/** The code this browser waits for: a signed challenge id (the code itself is only emailed). */
export async function rememberPortalChallenge(challengeId: string) {
  await setCookie(PENDING, signLinkToken('portal-sign-in', challengeId), 20 * 60);
}
export async function pendingPortalChallenge(): Promise<string | null> {
  const raw = await readCookie(PENDING);
  return raw ? verifyLinkToken('portal-sign-in', raw) : null;
}

/**
 * The signed-in speaker's portal, or null when nobody (or no speaker) is signed in on this host.
 * Once per request.
 */
export const loadSpeakerPortal = cache(async () => {
  const principal = await currentPortalPrincipal();
  if (!principal || principal.role !== 'speaker') return null;
  const ctx = await portalRequestCtx(principal);
  const data = await executeQuery(speakerPortalQuery, {}, ctx, ports);
  return { principal, data };
});
