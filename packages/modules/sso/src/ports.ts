import type { IdpConfig } from './domain/config.ts';
import type { SsoProtocol } from './schema.ts';

/** A connection as the IdP adapter sees it (the client secret opened, server only). */
export interface SsoConnectionView {
  readonly id: string;
  readonly orgId: string;
  readonly protocol: SsoProtocol;
  readonly config: IdpConfig;
  readonly clientSecret: string | null;
}

/** Our side of the connection (what the org admin registers at the IdP). */
export interface ServiceProvider {
  /** SAML SP entity id (audience). */
  readonly entityId: string;
  /** SAML Assertion Consumer Service URL (HTTP-POST binding). */
  readonly acsUrl: string;
  /** OIDC redirect URI. */
  readonly redirectUri: string;
}

/** What the IdP says about the person, once its answer is verified. */
export interface SsoAssertion {
  /** The IdP's stable id for the person (SAML NameID / OIDC `sub`). */
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
}

export const ASSERTION_REFUSALS = [
  'malformed',
  'invalid_signature',
  'wrong_issuer',
  'wrong_audience',
  'wrong_request',
  'expired',
  'no_email',
  'idp_error',
] as const;
export type AssertionRefusal = (typeof ASSERTION_REFUSALS)[number];

export type AssertionResult =
  | { readonly ok: true; readonly assertion: SsoAssertion }
  | { readonly ok: false; readonly reason: AssertionRefusal };

export const CHECK_REFUSALS = [
  'certificate_invalid',
  'certificate_expired',
  'certificate_not_yet_valid',
  'discovery_failed',
  'secret_missing',
] as const;
export type CheckRefusal = (typeof CHECK_REFUSALS)[number];

/**
 * The identity-provider port (SAML 2.0 and OpenID Connect). The fake adapter (dev, preview, CI)
 * sends the browser to the fake IdP page and verifies HMAC-signed answers; a real adapter
 * (SAML signature validation and OIDC code exchange) is switched on with the owner's IdP test
 * tenant (owner inbox). Every answer is checked for issuer, audience, the request it answers
 * (InResponseTo / nonce) and expiry before any account is touched.
 */
export interface IdentityProviderPort {
  readonly kind: 'fake' | 'real';
  /** Where to send the browser to sign in. */
  startUrl(
    conn: SsoConnectionView,
    input: { state: string; nonce: string; sp: ServiceProvider; loginHint: string | null },
  ): Promise<string>;
  /** What the IdP's answer (SAMLResponse or authorization code) proves. */
  complete(
    conn: SsoConnectionView,
    input: { response: string; nonce: string; sp: ServiceProvider },
  ): Promise<AssertionResult>;
  /** A configuration check without a browser (certificate, discovery). */
  check(conn: SsoConnectionView, now: Date): Promise<{ ok: true } | { ok: false; reason: CheckRefusal }>;
}

/** DNS TXT lookups: each record as its character strings (node:dns `resolveTxt` shape). */
export type TxtResolver = (name: string) => Promise<string[][]>;

/** Fetch an IdP metadata document from a URL the org admin gave (SSRF-guarded in production). */
export type MetadataFetcher = (url: string) => Promise<string>;
