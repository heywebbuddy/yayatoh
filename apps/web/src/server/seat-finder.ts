import 'server-only';
import { createHash } from 'node:crypto';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  FAKE_HUMAN_TOKEN,
  fakeHumanCheck,
  type HumanCheck,
  signLinkToken,
  turnstileHumanCheck,
  verifyLinkToken,
} from '@yayatoh/platform';
import { DEVICE_COOKIE } from '@yayatoh/platform/security';
import { publicVenueMapQuery } from '@yayatoh/seating';
import { cookies } from 'next/headers';
import { ports } from './ports.ts';

/**
 * The public seat finder's browser state (M1.7e). The device cookie (M1.14a, set by the proxy on
 * every page) keys the rate limit (roadmap §6.1: per device + event, tolerant of shared venue
 * Wi-Fi). The code and view cookies hold signed code ids, bound to the event.
 */
const CODE_MAX_AGE_S = 15 * 60;
const VIEW_MAX_AGE_S = 24 * 3600;

const codeCookie = (eventId: string) => `yy_sf_code_${eventId}`;
const viewCookie = (eventId: string) => `yy_sf_view_${eventId}`;
const codePurpose = (eventId: string) => `seat-finder-code:${eventId}`;
const viewPurpose = (eventId: string) => `seat-finder-view:${eventId}`;

/** The rate-limit key of this browser: a hash of its device cookie (requests without one share a key). */
export async function deviceKey(): Promise<string> {
  const id = (await cookies()).get(DEVICE_COOKIE)?.value;
  return createHash('sha256')
    .update(id ?? 'no-device-cookie')
    .digest('hex')
    .slice(0, 40);
}

const secure = () => (process.env.BETTER_AUTH_URL ?? '').startsWith('https:');

async function setToken(name: string, value: string, maxAge: number) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
    maxAge,
  });
}

async function readToken(name: string, purpose: string): Promise<string | null> {
  const raw = (await cookies()).get(name)?.value;
  return raw ? verifyLinkToken(purpose, raw) : null;
}

export const pendingCode = (eventId: string) => readToken(codeCookie(eventId), codePurpose(eventId));
export const verifiedCode = (eventId: string) => readToken(viewCookie(eventId), viewPurpose(eventId));

export const rememberPendingCode = (eventId: string, codeId: string) =>
  setToken(codeCookie(eventId), signLinkToken(codePurpose(eventId), codeId), CODE_MAX_AGE_S);

export async function rememberVerifiedCode(eventId: string, codeId: string) {
  (await cookies()).delete(codeCookie(eventId));
  await setToken(viewCookie(eventId), signLinkToken(viewPurpose(eventId), codeId), VIEW_MAX_AGE_S);
}

export async function forgetFinder(eventId: string) {
  const jar = await cookies();
  jar.delete(codeCookie(eventId));
  jar.delete(viewCookie(eventId));
}

let humanCheck: HumanCheck | null | undefined;

/**
 * The challenge shown past the rate limit: Cloudflare Turnstile when its keys are set
 * (`HUMAN_CHECK_PROVIDER=turnstile`, owner account), otherwise the fake checkbox in dev, preview
 * and CI. Production without Turnstile has no challenge (null): over-limit lookups wait instead.
 */
export function getHumanCheck(): HumanCheck | null {
  if (humanCheck !== undefined) return humanCheck;
  const production = process.env.VERCEL_ENV === 'production';
  const provider = process.env.HUMAN_CHECK_PROVIDER || (production ? 'turnstile' : 'fake');
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  humanCheck =
    provider === 'turnstile'
      ? siteKey && secretKey
        ? turnstileHumanCheck({ siteKey, secretKey })
        : null
      : production
        ? null
        : fakeHumanCheck;
  return humanCheck;
}

/** What the browser needs to show the challenge. */
export function humanCheckWidget(): {
  provider: 'fake' | 'turnstile';
  siteKey: string | null;
  fakeToken: string;
} | null {
  const h = getHumanCheck();
  return h
    ? { provider: h.provider, siteKey: h.siteKey, fakeToken: h.provider === 'fake' ? FAKE_HUMAN_TOKEN : '' }
    : null;
}

/** Did this form carry a solved challenge? */
export async function passedHumanCheck(form: FormData): Promise<boolean | null> {
  const token = String(form.get('cf-turnstile-response') ?? form.get('human') ?? '');
  if (!token) return null;
  return (await getHumanCheck()?.verify(token)) ?? false;
}

/** The venue map, only when the organizer opened it; null otherwise (closed, or no module). */
export async function openVenueMap(orgId: string, eventId: string, occurrenceId: string | null = null) {
  // Per-date charts (M1.7g): the plan the chosen date uses.
  return executeQuery(publicVenueMapQuery, { eventId, occurrenceId }, createCtx({ orgId }), ports).catch(
    (err) => {
      if (isDomainError(err) && err.code === 'module_not_enabled') return null;
      throw err;
    },
  );
}
