import 'server-only';
import { withTenant } from '@yayatoh/db';
import { type Ctx, createCtx } from '@yayatoh/kernel';
import {
  devMailboxTransports,
  type MessageKind,
  PLATFORM_SENDER,
  renderMessage,
  type Transports,
} from '@yayatoh/notifications';
import { appTokenSecret } from '@yayatoh/platform';
import {
  endPortalSession,
  newPortalSecret,
  type PortalPrincipal,
  parsePortalSessionToken,
  portalLinkToken,
  portalPrincipalBySession,
  portalSecretHash,
  portalSessionToken,
  portalSiteToken,
  verifyPortalSiteToken,
} from '@yayatoh/program';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestHost } from './request-origin.ts';

/**
 * The exhibitor portal's sign-in (M5.4a; decision P5-7). A minimal local version of the portal
 * account foundation M5.3a owns, behind the same contract: `requirePortalPrincipal()` returns
 * `{ orgId, eventId, eventRoleAssignmentId, role, subjectId }`. Portal people are never org
 * members: they sign in by an emailed link, and their httpOnly cookie names the org (never a
 * header) plus a secret whose HMAC is the session. Cookies use `__Host-` on HTTPS.
 */
const SESSION = 'yy_xp';
/** The last event's sign-in page (a signed org + event), so a signed-out visitor can ask for a link. */
const SITE = 'yy_xps';
const SESSION_MAX_AGE_S = 7 * 24 * 3600;

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

/** A fresh link secret and the HMAC the command stores. */
export function newPortalLink() {
  const secret = newPortalSecret();
  return { secret, hash: portalSecretHash(appTokenSecret(), 'link', secret) };
}

export const linkHashOf = (secret: string) => portalSecretHash(appTokenSecret(), 'link', secret);

/** A new browser session: the cookie value is set by `startPortalSession` after the command. */
export function newPortalSession(orgId: string) {
  const secret = newPortalSecret();
  return {
    hash: portalSecretHash(appTokenSecret(), 'session', secret),
    cookie: portalSessionToken(orgId, secret),
  };
}

export async function startPortalSession(cookie: string, orgId: string, eventId: string) {
  await setCookie(SESSION, cookie, SESSION_MAX_AGE_S);
  await setCookie(SITE, portalSiteToken(appTokenSecret(), orgId, eventId), 180 * 24 * 3600);
}

async function sessionOfCookie() {
  const raw = await readCookie(SESSION);
  const parsed = raw ? parsePortalSessionToken(raw) : null;
  if (!parsed) return null;
  return { orgId: parsed.orgId, hash: portalSecretHash(appTokenSecret(), 'session', parsed.secret) };
}

/** The portal principal of this browser, or null (signed out, expired, revoked). */
export async function currentPortalPrincipal(): Promise<PortalPrincipal | null> {
  const s = await sessionOfCookie();
  return s ? portalPrincipalBySession(s.orgId, s.hash) : null;
}

/**
 * The signed-in portal principal, or a redirect to the portal's signed-out page. Pages and
 * actions call this; commands re-check the principal in their own transaction.
 */
export async function requirePortalPrincipal(locale = 'en'): Promise<PortalPrincipal> {
  const p = await currentPortalPrincipal();
  if (!p) redirect(`/${locale}/exhibitor/signed-out`);
  return p;
}

/** Sign this browser out of the portal. */
export async function endThisPortalSession() {
  const s = await sessionOfCookie();
  if (s) await endPortalSession(s.orgId, s.hash);
  (await cookies()).delete(await cookieName(SESSION));
}

/** The signed sign-in page token remembered in this browser, if any. */
export async function rememberedPortalSite(): Promise<string | null> {
  const raw = await readCookie(SITE);
  return raw && verifyPortalSiteToken(appTokenSecret(), raw) ? raw : null;
}

export const verifySite = (token: string) => verifyPortalSiteToken(appTokenSecret(), token);
export const siteTokenFor = (orgId: string, eventId: string) =>
  portalSiteToken(appTokenSecret(), orgId, eventId);

/** A command context for portal actions: the principal's org, no org member acting. */
export const portalCtx = (principal: Pick<PortalPrincipal, 'orgId'>, locale: string): Ctx =>
  createCtx({ orgId: principal.orgId, locale });

/** The absolute URL of a sign-in link on this host. */
export async function portalLinkUrl(orgId: string, memberId: string, secret: string, locale: string) {
  const { origin } = await requestHost();
  return `${origin}/${locale}/exhibitor/join/${portalLinkToken(orgId, memberId, secret)}`;
}

let transports: Transports | null | undefined;

/**
 * Where portal links go: sent at once (the secret is never stored), through the dev mailbox in
 * development, preview and CI; production needs the owner's SES account (owner inbox) first.
 */
function portalTransports(): Transports | null {
  if (transports !== undefined) return transports;
  transports =
    process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production'
      ? null
      : devMailboxTransports();
  return transports;
}

export async function sendPortalEmail(input: {
  readonly kind: Extract<MessageKind, 'portal.exhibitor-invite' | 'portal.exhibitor-sign-in'>;
  readonly to: string;
  readonly locale: string;
  readonly orgId: string;
  readonly params: Readonly<Record<string, string | number>>;
}): Promise<void> {
  const brand = await withTenant(
    createCtx({ orgId: input.orgId, actor: { type: 'system', name: 'program.portal-mail' } }),
    (tx) => organizationBrandTx(tx, input.orgId),
  );
  const org = {
    name: brand?.name ?? 'Yayatoh',
    brandColor: brand?.brandColor ?? null,
    poweredByVisible: brand?.poweredByVisible ?? false,
  };
  const rendered = renderMessage({ kind: input.kind, locale: input.locale, params: input.params, org });
  const t = portalTransports();
  if (!t) throw new Error('No email provider is configured for portal links (owner inbox: SES)');
  await t.email.send({
    from: { name: org.name, address: PLATFORM_SENDER },
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {},
    idempotencyKey: `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
}
