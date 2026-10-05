import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { findOrCreateSsoAccount } from '@yayatoh/auth';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  completeSsoLoginCommand,
  connectionView,
  emailDomain,
  type ServiceProvider,
  ssoPrecheck,
  ssoRuntime,
} from '@yayatoh/sso';
import { getAuth } from './auth.ts';
import { ports } from './ports.ts';
import { appOrigin } from './tenant-return.ts';

/**
 * Single sign-on for the app host (M6.5a). The browser starts at "Sign in with single sign-on"
 * (or an org admin's "Test sign-in"), goes to the org's IdP, and comes back to the SAML ACS
 * (`/auth/sso/saml/acs`, POST) or the OIDC callback (`/auth/sso/callback`, GET). The pending
 * sign-in (org, connection, nonce, intent) is kept server-side for 10 minutes under the SHA-256 of
 * a random state that only this browser's cookie holds: the org always comes from there, never
 * from what the IdP or the request says.
 */

/** Whether single sign-on can run on this deployment (an IdP adapter is configured). */
export const ssoAvailable = () => ssoRuntime().idp !== null;

/** Our side of every connection: what the org admin registers at their IdP. */
export function serviceProvider(): ServiceProvider {
  const origin = appOrigin();
  return {
    entityId: `${origin}/auth/sso/saml/metadata`,
    acsUrl: `${origin}/auth/sso/saml/acs`,
    redirectUri: `${origin}/auth/sso/callback`,
  };
}

export const ssoStateCookie = (https: boolean) => (https ? '__Host-yy.sso' : 'yy.sso');
export const SSO_STATE_MAX_AGE_S = 600;

export interface PendingSso {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly connectionId: string;
  readonly nonce: string;
  readonly locale: string;
  /** `test`: an org admin checking the connection (no one is signed in by it). */
  readonly intent: 'sign_in' | 'test';
  /** For `test`: the admin who started it (must still be the one signed in). */
  readonly userId: string | null;
}

const stateKey = (state: string) => `yy-sso-state:${createHash('sha256').update(state).digest('hex')}`;
const STATE = /^[A-Za-z0-9_-]{43}$/;

/** Start: a state (the cookie), a nonce (InResponseTo / OIDC nonce), and the IdP's URL. */
export async function beginSso(
  pending: Omit<PendingSso, 'nonce'>,
  loginHint: string | null,
): Promise<{ url: string; state: string } | null> {
  const idp = ssoRuntime().idp;
  const conn = idp ? await connectionView(pending.orgId, pending.connectionId) : null;
  if (!idp || !conn) return null;
  const state = randomBytes(32).toString('base64url');
  const full: PendingSso = { ...pending, nonce: randomBytes(16).toString('base64url') };
  const c = await getAuth().$context;
  await c.internalAdapter.createVerificationValue({
    identifier: stateKey(state),
    value: JSON.stringify(full),
    expiresAt: new Date(Date.now() + SSO_STATE_MAX_AGE_S * 1000),
  });
  const url = await idp.startUrl(conn, { state, nonce: full.nonce, sp: serviceProvider(), loginHint });
  return { url, state };
}

/** Take the pending sign-in for a returned state (single use); it must match this browser's cookie. */
export async function takeSso(
  state: string | null,
  cookie: string | null | undefined,
): Promise<PendingSso | null> {
  if (!state || !cookie || !STATE.test(state) || state !== cookie) return null;
  const c = await getAuth().$context;
  const v = await c.internalAdapter.findVerificationValue(stateKey(state));
  if (!v) return null;
  await c.internalAdapter.deleteVerificationByIdentifier(stateKey(state));
  if (new Date(v.expiresAt) <= new Date()) return null;
  return JSON.parse(v.value) as PendingSso;
}

export type SsoOutcome =
  | { readonly kind: 'refused'; readonly reason: string }
  | {
      readonly kind: 'tested';
      readonly ok: boolean;
      readonly reason: string | null;
      readonly email: string | null;
      readonly domainVerified: boolean;
    }
  | {
      readonly kind: 'signed_in';
      readonly userId: string;
      readonly cookies: string[];
      readonly challenge: boolean;
    };

/**
 * The IdP answered: verify it for the pending connection, then (sign-in) check the address is in
 * one of the org's verified domains, find or make the account, link and provision in the org,
 * and make the org-bound session (or the authenticator challenge).
 */
export async function completeSso(
  pending: PendingSso,
  response: string,
  headers: Headers,
): Promise<SsoOutcome> {
  const idp = ssoRuntime().idp;
  const conn = await connectionView(pending.orgId, pending.connectionId);
  if (!idp || !conn) return { kind: 'refused', reason: 'connection_inactive' };
  const answer = response
    ? await idp.complete(conn, { response, nonce: pending.nonce, sp: serviceProvider() }).catch(() => null)
    : null;
  if (pending.intent === 'test') {
    if (!answer?.ok)
      return {
        kind: 'tested',
        ok: false,
        reason: answer ? answer.reason : 'idp_error',
        email: null,
        domainVerified: false,
      };
    const pre = await ssoPrecheck({
      orgId: pending.orgId,
      connectionId: conn.id,
      subject: answer.assertion.subject,
      email: answer.assertion.email,
      test: true,
    });
    return {
      kind: 'tested',
      ok: true,
      reason: null,
      email: answer.assertion.email,
      domainVerified: pre.ok || pre.reason !== 'domain_not_verified',
    };
  }
  if (!answer) return { kind: 'refused', reason: 'idp_error' };
  if (!answer.ok) return { kind: 'refused', reason: answer.reason };
  const { assertion } = answer;
  if (!emailDomain(assertion.email)) return { kind: 'refused', reason: 'no_email' };
  const pre = await ssoPrecheck({
    orgId: pending.orgId,
    connectionId: conn.id,
    subject: assertion.subject,
    email: assertion.email,
    test: false,
  });
  if (!pre.ok) return { kind: 'refused', reason: pre.reason };
  const userId =
    pre.linkedUserId ??
    (
      await findOrCreateSsoAccount(getAuth(), {
        email: assertion.email,
        name: assertion.name,
        via: 'sso',
        protocol: conn.protocol,
      })
    ).userId;
  try {
    await executeCommand(
      completeSsoLoginCommand,
      { connectionId: conn.id, subject: assertion.subject, email: assertion.email, userId },
      createCtx({ orgId: pending.orgId, actor: { type: 'system', name: 'sso.login' } }),
      ports,
    );
  } catch (err) {
    if (isDomainError(err)) return { kind: 'refused', reason: String(err.details?.reason ?? err.code) };
    throw err;
  }
  let res: Response;
  try {
    res = await getAuth().api.ssoSession({
      body: { userId, orgId: pending.orgId },
      headers,
      asResponse: true,
    });
  } catch {
    return { kind: 'refused', reason: 'session_failed' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return {
      kind: 'refused',
      reason: body?.code === 'STAFF_TWO_FACTOR_REQUIRED' ? 'staff_two_factor' : 'session_failed',
    };
  }
  const { challenge } = (await res.json()) as { challenge: boolean };
  return { kind: 'signed_in', userId, cookies: res.headers.getSetCookie(), challenge };
}
