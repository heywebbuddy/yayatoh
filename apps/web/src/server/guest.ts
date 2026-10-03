import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import {
  devMailboxTransports,
  emailIdentityTx,
  type MessageKind,
  PLATFORM_SENDER,
  renderMessage,
  type Transports,
} from '@yayatoh/notifications';
import {
  GUEST_SESSION_MS,
  GUEST_VERIFIED_MS,
  type GuestLimits,
  type GuestSession,
  guestEmailHash,
  guestSessionByToken,
  newGuestSecret,
  normalizeGuestEmail,
} from '@yayatoh/orders';
import { appTokenSecret, signLinkToken, verifyLinkToken } from '@yayatoh/platform';
import { DEVICE_COOKIE } from '@yayatoh/platform/security';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { cookies, headers } from 'next/headers';
import { rememberDevCode } from './auth.ts';
import { devAuthEnabled } from './dev.ts';
import { clientIp, rateLimiter } from './rate-limit.ts';
import { requestHost } from './request-origin.ts';
import { ownAuthSession } from './session.ts';

/**
 * Guest email verification in the browser (M1.5f): the cookies behind checkout verification and
 * attendee ("My tickets") sessions, and the email that carries a code. Cookies are host-only and
 * httpOnly; on HTTPS they use the `__Host-` prefix, so no sibling host can set or read them.
 * Attendee sessions are a separate cookie from organizer sessions (Better Auth `yy.session`).
 */
const https = async () => (await requestHost()).protocol === 'https:';
const cookieName = async (base: string) => ((await https()) ? `__Host-${base}` : base);

async function setCookie(base: string, value: string, maxAgeS: number) {
  (await cookies()).set(await cookieName(base), value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await https(),
    path: '/',
    maxAge: maxAgeS,
  });
}
async function readCookie(base: string): Promise<string | null> {
  return (await cookies()).get(await cookieName(base))?.value ?? null;
}
async function dropCookie(base: string) {
  (await cookies()).delete(await cookieName(base));
}

/** The M1.14 limiter and this request's device cookie and IP. */
export async function guestLimits(): Promise<GuestLimits> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return {
    limiter: rateLimiter(),
    subject: { device: c.get(DEVICE_COOKIE)?.value ?? null, ip: clientIp(h) },
  };
}

/** This request's host (sessions are bound to it) and origin (for magic links). */
export async function guestHost() {
  const h = await requestHost();
  return { host: h.host, origin: h.origin };
}

// ─── Verified address (checkout) ────────────────────────────────────────────────────────────

const VERIFIED = 'yy_gv';
const mac = (value: string) =>
  createHmac('sha256', appTokenSecret()).update(`guest-verified:${value}`).digest('hex');

/** Remember in this browser, for 30 minutes, that it proved this address (skips the next code). */
export async function rememberVerifiedEmail(email: string) {
  const until = Date.now() + GUEST_VERIFIED_MS;
  const body = `${until}.${guestEmailHash(appTokenSecret(), email)}`;
  await setCookie(VERIFIED, `${body}.${mac(body)}`, Math.floor(GUEST_VERIFIED_MS / 1000));
}

/**
 * Did this browser prove this address recently: a checkout code (cookie), a My tickets sign-in on
 * this site (the attendee session), or a signed-in account whose verified email it is (M1.2f)?
 */
export async function emailVerifiedHere(email: string, orgId: string | null): Promise<boolean> {
  const raw = await readCookie(VERIFIED);
  if (raw) {
    const [until, hash, sig] = raw.split('.');
    const body = `${until}.${hash}`;
    const want = Buffer.from(mac(body), 'hex');
    const got = Buffer.from(sig ?? '', 'hex');
    if (
      got.length === want.length &&
      timingSafeEqual(got, want) &&
      Number(until) > Date.now() &&
      hash === guestEmailHash(appTokenSecret(), email)
    )
      return true;
  }
  const session = await currentGuestSession(orgId);
  if (session !== null && session.email === normalizeGuestEmail(email)) return true;
  // A person signed in on this host (M1.2f) whose account email is verified has proved it already;
  // never while staff act as them (M1.2e).
  const own = await ownAuthSession();
  return (
    Boolean(own?.user.emailVerified) &&
    normalizeGuestEmail(own?.user.email ?? '') === normalizeGuestEmail(email)
  );
}

// ─── Pending codes ──────────────────────────────────────────────────────────────────────────

const PENDING_MAX_AGE_S = 20 * 60;
/** `privacy`: a self-service data-subject request (M6.1c; a site sign-in code, its own cookie). */
type PendingFor = 'checkout' | 'sign_in' | 'privacy';
const PENDING_BASE: Record<PendingFor, string> = { checkout: 'yy_gc', sign_in: 'yy_gp', privacy: 'yy_gr' };
const pendingBase = (purpose: PendingFor) => PENDING_BASE[purpose];

/** The code this browser is waiting for (a signed challenge id; the code itself is only emailed). */
export async function rememberPendingChallenge(purpose: PendingFor, challengeId: string) {
  await setCookie(pendingBase(purpose), signLinkToken(`guest-${purpose}`, challengeId), PENDING_MAX_AGE_S);
}
export async function pendingChallenge(purpose: PendingFor): Promise<string | null> {
  const raw = await readCookie(pendingBase(purpose));
  return raw ? verifyLinkToken(`guest-${purpose}`, raw) : null;
}
export const forgetPendingChallenge = (purpose: PendingFor) => dropCookie(pendingBase(purpose));

/** The random state that binds a sign-in magic link to this browser (made on first request). */
export async function browserState(create: boolean): Promise<string | null> {
  const have = await readCookie('yy_gs');
  if (have && /^[A-Za-z0-9_-]{43}$/.test(have)) return have;
  if (!create) return null;
  const state = newGuestSecret();
  await setCookie('yy_gs', state, 60 * 60);
  return state;
}

// ─── Attendee sessions ──────────────────────────────────────────────────────────────────────

const SESSION = 'yy_att';

export async function setGuestSessionCookie(token: string) {
  await setCookie(SESSION, token, Math.floor(GUEST_SESSION_MS / 1000));
}
export const guestSessionToken = () => readCookie(SESSION);
export const clearGuestSessionCookie = () => dropCookie(SESSION);

/** The attendee signed in on this host for this site (org or marketplace), if any. */
export async function currentGuestSession(orgId: string | null): Promise<GuestSession | null> {
  const token = await readCookie(SESSION);
  if (!token) return null;
  return guestSessionByToken(token, { scopeOrgId: orgId, host: (await guestHost()).host });
}

// ─── Email ──────────────────────────────────────────────────────────────────────────────────

let transports: Transports | null | undefined;

/**
 * Where guest codes go. They are sent at once (never queued, so the code is never stored): the
 * dev mailbox in development, preview and CI; production needs the owner's SES account (owner
 * inbox, M1.10) and refuses to pretend until then.
 */
function guestTransports(): Transports | null {
  if (transports !== undefined) return transports;
  transports =
    process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production'
      ? null
      : devMailboxTransports();
  return transports;
}

/** Send a guest code or sign-in email in the visitor's language, branded for the org's site. */
export async function sendGuestEmail(input: {
  readonly kind: Extract<
    MessageKind,
    | 'guest.checkout-code'
    | 'guest.sign-in'
    | 'guest.waitlist-code'
    | 'portal.sign-in'
    | 'portal.invite'
    | 'privacy.request-code'
    | 'privacy.archive-ready'
    | 'privacy.erasure-done'
  >;
  readonly to: string;
  readonly locale: string;
  readonly orgId: string | null;
  readonly params: Readonly<Record<string, string | number>>;
}): Promise<void> {
  const to = normalizeGuestEmail(input.to);
  const [brand, identity] = input.orgId
    ? await withTenant(
        createCtx({ orgId: input.orgId, actor: { type: 'system', name: 'orders.guest-mail' } }),
        async (tx) =>
          [await organizationBrandTx(tx, input.orgId as string), await emailIdentityTx(tx)] as const,
      )
    : [null, null];
  const org = {
    name: brand?.name ?? 'Yayatoh',
    brandColor: brand?.brandColor ?? null,
    poweredByVisible: brand?.poweredByVisible ?? false,
  };
  const rendered = renderMessage({ kind: input.kind, locale: input.locale, params: input.params, org });
  const t = guestTransports();
  if (!t) throw new Error('No email provider is configured for guest codes (owner inbox: SES)');
  // Dev and e2e read the latest code through /api/dev/last-code (never in production).
  if (devAuthEnabled() && typeof input.params.code === 'string') await rememberDevCode(to, input.params.code);
  await t.email.send({
    // U10: the org's From name and Reply-To, as on all its email.
    from: { name: identity?.fromName ?? org.name, address: PLATFORM_SENDER },
    ...(identity?.replyTo ? { replyTo: identity.replyTo } : {}),
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {},
    idempotencyKey: `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
}
