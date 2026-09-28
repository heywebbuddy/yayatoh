'use server';

import { withTenant } from '@yayatoh/db';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  consumeGuestLink,
  createGuestSession,
  endGuestSession,
  GUEST_CODE_TTL_MS,
  GUEST_LINK_TTL_MS,
  orgsWithOrdersFor,
  requestGuestChallenge,
  requestOrderLinksCommand,
  revokeGuestSessions,
  verifyGuestChallenge,
} from '@yayatoh/orders';
import { organizationNameTx, resolveHost } from '@yayatoh/tenancy';
import { getLocale } from 'next-intl/server';
import type { GuestCodeStatus } from '@/components/guest-code-fields.tsx';
import { redirect } from '@/i18n/navigation.ts';
import { classifyHost } from '@/lib/hosts.ts';
import {
  browserState,
  clearGuestSessionCookie,
  currentGuestSession,
  forgetPendingChallenge,
  guestHost,
  guestLimits,
  guestSessionToken,
  pendingChallenge,
  rememberPendingChallenge,
  rememberVerifiedEmail,
  sendGuestEmail,
  setGuestSessionCookie,
} from '@/server/guest.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

/**
 * "My tickets" (M1.5f): attendees sign in on an org's site (that org's orders) or the
 * marketplace (every org's) with an emailed code or magic link. The site comes from the route
 * (`/t/[org]/…` on tenant hosts, none on the marketplace) and must agree with the host the
 * request came to; sessions are bound to that host.
 */
async function assertSite(orgId: string | null): Promise<void> {
  const { host } = await guestHost();
  if (orgId === null) {
    if (classifyHost(host) === 'tenant') throw new Error('My tickets: marketplace scope on a tenant host');
    return;
  }
  const site = await resolveHost(host);
  if (site?.orgId !== orgId) throw new Error('My tickets: site and host disagree');
}

const localePrefix = (locale: string) => (locale === 'en' ? '' : `/${locale}`);
const minutes = (ms: number | undefined) => Math.max(1, Math.ceil((ms ?? 60_000) / 60_000));

async function siteName(orgId: string | null): Promise<string> {
  if (!orgId) return 'Yayatoh';
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'orders.my-tickets' } });
  return (await withTenant(ctx, (tx) => organizationNameTx(tx, orgId))) ?? 'Yayatoh';
}

export type SignInState = {
  readonly step: 'email' | 'code';
  readonly code: string | null;
  readonly email?: string;
  readonly status?: GuestCodeStatus;
  readonly attemptsLeft?: number | null;
  readonly resendAt?: number | null;
  readonly retryMinutes?: number;
};

async function sendSignInCode(orgId: string | null, email: string): Promise<SignInState> {
  const locale = await getLocale();
  const state = await browserState(true);
  let r: Awaited<ReturnType<typeof requestGuestChallenge>>;
  try {
    r = await requestGuestChallenge(
      { purpose: 'sign_in', scopeOrgId: orgId, email, browserState: state },
      await guestLimits(),
    );
  } catch (err) {
    if (isDomainError(err)) return { step: 'email', code: 'validation_failed' };
    throw err;
  }
  if (r.status === 'rate_limited')
    return { step: 'email', code: 'rate_limited', retryMinutes: minutes(r.retryAfterMs) };
  if (r.status === 'cooldown')
    return { step: 'code', code: null, email, status: 'cooldown', resendAt: r.resendAt.getTime() };
  const { origin } = await guestHost();
  await sendGuestEmail({
    kind: 'guest.sign-in',
    to: email,
    locale,
    orgId,
    params: {
      code: r.code,
      url: `${origin}${localePrefix(locale)}/my-tickets/verify/${r.linkToken}`,
      minutes: GUEST_CODE_TTL_MS / 60_000,
      linkMinutes: GUEST_LINK_TTL_MS / 60_000,
      site: await siteName(orgId),
    },
  });
  await rememberPendingChallenge('sign_in', r.challengeId);
  return { step: 'code', code: null, email, status: 'sent', resendAt: r.resendAt.getTime() };
}

async function signIn(orgId: string | null, email: string) {
  const { host } = await guestHost();
  const session = await createGuestSession({ email, scopeOrgId: orgId, host });
  await setGuestSessionCookie(session.token);
  await rememberVerifiedEmail(email);
  await forgetPendingChallenge('sign_in');
  redirect({ href: '/my-tickets', locale: await getLocale() });
}

/**
 * Step 1 (email → code and link) and step 2 (code → signed in) of the sign-in form. Every
 * address gets the same answer: a code is always sent, and what an address has bought is only
 * shown after it is proved.
 */
export async function signInAction(
  orgId: string | null,
  prev: SignInState,
  form: FormData,
): Promise<SignInState> {
  await assertSite(orgId);
  const email = String(form.get('email') ?? prev.email ?? '').trim();
  if (!email) return { step: 'email', code: 'validation_failed' };
  const code = String(form.get('verifyCode') ?? '').replace(/\s/g, '');
  const pending = await pendingChallenge('sign_in');
  if (prev.step === 'code' && code && form.get('verifyIntent') !== 'resend' && pending) {
    const r = await verifyGuestChallenge(
      { challengeId: pending, code, purpose: 'sign_in', scopeOrgId: orgId, email },
      await guestLimits(),
    );
    if (r.status === 'ok') return signIn(orgId, email) as never;
    if (r.status === 'rate_limited')
      return { ...prev, code: 'rate_limited', retryMinutes: minutes(r.retryAfterMs) };
    return { step: 'code', code: null, email, status: r.status, attemptsLeft: r.attemptsLeft };
  }
  return sendSignInCode(orgId, email);
}

export type LinkCodeState = {
  readonly code: string | null;
  readonly status?: GuestCodeStatus;
  readonly attemptsLeft?: number | null;
  readonly retryMinutes?: number;
};

/** The magic link in the browser that asked for it: spend it and sign in. */
export async function openLinkAction(orgId: string | null, token: string): Promise<void> {
  await assertSite(orgId);
  const r = await consumeGuestLink({ token, browserState: await browserState(false), scopeOrgId: orgId });
  if (r.status === 'ok') return signIn(orgId, r.email);
  redirect({ href: `/my-tickets/verify/${token}`, locale: await getLocale() });
}

/** The magic link opened in another browser: the code from the same email proves the address. */
export async function linkCodeAction(
  orgId: string | null,
  token: string,
  _prev: LinkCodeState,
  form: FormData,
): Promise<LinkCodeState> {
  await assertSite(orgId);
  const r = await consumeGuestLink({ token, browserState: null, scopeOrgId: orgId, spend: false });
  if (r.status === 'invalid') return { code: null, status: 'expired' };
  const v = await verifyGuestChallenge(
    {
      challengeId: r.challengeId,
      code: String(form.get('verifyCode') ?? '').replace(/\s/g, ''),
      purpose: 'sign_in',
      scopeOrgId: orgId,
    },
    await guestLimits(),
  );
  if (v.status === 'ok')
    return v.email ? (signIn(orgId, v.email) as never) : { code: null, status: 'expired' };
  if (v.status === 'rate_limited') return { code: 'rate_limited', retryMinutes: minutes(v.retryAfterMs) };
  return { code: null, status: v.status, attemptsLeft: v.attemptsLeft };
}

/** Sign out this browser. */
export async function signOutAction(orgId: string | null): Promise<void> {
  await assertSite(orgId);
  await endGuestSession(await guestSessionToken());
  await clearGuestSessionCookie();
  redirect({ href: '/my-tickets?signedOut=1', locale: await getLocale() });
}

/** Sign out on every device: revoke all of this address's sessions for this site. */
export async function signOutEverywhereAction(orgId: string | null): Promise<void> {
  await assertSite(orgId);
  const session = await currentGuestSession(orgId);
  if (session) await revokeGuestSessions(session.email, orgId);
  await clearGuestSessionCookie();
  redirect({ href: '/my-tickets?signedOut=all', locale: await getLocale() });
}

export type OrderLinksState = {
  readonly sent: boolean;
  readonly code: string | null;
  readonly retryMinutes?: number;
};

/**
 * "Email me my order links again": the same answer whatever the address (no enumeration);
 * limited per device and per address. On a site, that org's orders; on the marketplace, every
 * org's (one request per org that has any).
 */
export async function orderLinksAction(
  orgId: string | null,
  _prev: OrderLinksState,
  form: FormData,
): Promise<OrderLinksState> {
  await assertSite(orgId);
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return { sent: false, code: 'validation_failed' };
  const limit = await limitAction('guestLinks', { identity: email, scope: orgId ?? 'marketplace' });
  if (!limit.allowed) return { sent: false, code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  const orgs = orgId ? [orgId] : await orgsWithOrdersFor(email);
  for (const org of orgs)
    await executeCommand(
      requestOrderLinksCommand,
      { email },
      createCtx({ orgId: org, locale: await getLocale() }),
      ports,
    );
  return { sent: true, code: null };
}
