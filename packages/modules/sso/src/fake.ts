import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { certificateProblem } from './domain/config.ts';
import { fakeIdpMetadata } from './fixtures.ts';
import type {
  AssertionResult,
  IdentityProviderPort,
  MetadataFetcher,
  ServiceProvider,
  SsoConnectionView,
  TxtResolver,
} from './ports.ts';

/**
 * The recorded fake IdP (M6.5a; dev, preview and CI only). It speaks the shape of both
 * protocols: SAML answers are POSTed to the ACS URL as `SAMLResponse` + `RelayState`, OIDC answers
 * come back to the redirect URI as `code` + `state`. An answer is a signed statement
 * (HMAC-SHA256 with a key per org and connection) of issuer, audience, subject, email, name,
 * the request it answers and an expiry: exactly what a real adapter checks in a signed assertion
 * or ID token. Production never uses it (the composition roots refuse).
 */

export const FAKE_ANSWER_TTL_MS = 5 * 60_000;

export interface FakeIdpStatement {
  readonly v: 1;
  readonly protocol: 'saml' | 'oidc';
  /** IdP entity id (SAML) or issuer (OIDC). */
  readonly iss: string;
  /** SP entity id (SAML) or client id (OIDC). */
  readonly aud: string;
  readonly sub: string;
  readonly email: string;
  readonly name: string | null;
  /** InResponseTo (SAML) / nonce (OIDC). */
  readonly nonce: string;
  readonly exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const keyFor = (seed: string, orgId: string, connectionId: string) =>
  createHmac('sha256', seed).update(`yayatoh:fake-idp:${orgId}:${connectionId}`).digest();
const sign = (key: Buffer, body: string) => createHmac('sha256', key).update(body).digest('base64url');
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The issuer and audience a connection's answers must carry. */
export function expectedParties(conn: SsoConnectionView, sp: ServiceProvider) {
  return conn.config.protocol === 'saml'
    ? { iss: conn.config.entityId, aud: sp.entityId }
    : { iss: conn.config.issuer, aud: conn.config.clientId };
}

/** A stable fake subject for an email (the same fake person gets the same id each time). */
export const fakeIdpSubject = (email: string) =>
  `fake-idp-${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24)}`;

/** The fake IdP signs an answer for the connection it is configured as (test fixtures use this too). */
export function signFakeIdpAnswer(
  seed: string,
  conn: { orgId: string; id: string },
  statement: Omit<FakeIdpStatement, 'v' | 'exp'> & { exp?: number },
  now: number = Date.now(),
): string {
  const full: FakeIdpStatement = { ...statement, v: 1, exp: statement.exp ?? now + FAKE_ANSWER_TTL_MS };
  const body = b64(JSON.stringify(full));
  return `${body}.${sign(keyFor(seed, conn.orgId, conn.id), body)}`;
}

/** Verify a fake answer against the connection and the pending request. */
export function openFakeIdpAnswer(
  seed: string,
  conn: SsoConnectionView,
  input: { response: string; nonce: string; sp: ServiceProvider },
  now: number = Date.now(),
): AssertionResult {
  if (input.response.length > 16_384) return { ok: false, reason: 'malformed' };
  const [body, sig, extra] = input.response.split('.');
  if (!body || !sig || extra !== undefined) return { ok: false, reason: 'malformed' };
  if (!same(sig, sign(keyFor(seed, conn.orgId, conn.id), body))) return { ok: false, reason: 'invalid_signature' };
  let s: FakeIdpStatement;
  try {
    s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (s?.v !== 1 || s.protocol !== conn.protocol) return { ok: false, reason: 'malformed' };
  const want = expectedParties(conn, input.sp);
  if (s.iss !== want.iss) return { ok: false, reason: 'wrong_issuer' };
  if (s.aud !== want.aud) return { ok: false, reason: 'wrong_audience' };
  if (typeof s.exp !== 'number' || s.exp <= now) return { ok: false, reason: 'expired' };
  if (typeof s.nonce !== 'string' || !same(s.nonce, input.nonce)) return { ok: false, reason: 'wrong_request' };
  if (typeof s.sub !== 'string' || !s.sub || s.sub.length > 255) return { ok: false, reason: 'malformed' };
  if (typeof s.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(s.email)) return { ok: false, reason: 'no_email' };
  return {
    ok: true,
    assertion: {
      subject: s.sub,
      email: s.email.trim().toLowerCase(),
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 200) : null,
    },
  };
}

/** Reserved test names (`.test`, `example.*`): the fake's OIDC discovery and metadata URLs. */
const TEST_HOST = /(^|\.)(test|example|example\.com|example\.net|example\.org)$/i;

/** The fake adapter. `idpUrl` is the fake IdP page on this app. */
export function fakeIdentityProvider(opts: { seed: string; idpUrl: string }): IdentityProviderPort {
  return {
    kind: 'fake',
    async startUrl(conn, input) {
      const u = new URL(opts.idpUrl);
      u.searchParams.set('connection', conn.id);
      u.searchParams.set('org', conn.orgId);
      u.searchParams.set('protocol', conn.protocol);
      u.searchParams.set('state', input.state);
      u.searchParams.set('nonce', input.nonce);
      if (input.loginHint) u.searchParams.set('login_hint', input.loginHint);
      return u.toString();
    },
    async complete(conn, input) {
      return openFakeIdpAnswer(opts.seed, conn, input);
    },
    async check(conn, now) {
      if (conn.config.protocol === 'saml') {
        const problem = certificateProblem(conn.config.certificate, now);
        return problem ? { ok: false, reason: problem } : { ok: true };
      }
      if (!conn.clientSecret) return { ok: false, reason: 'secret_missing' };
      // The fake "discovers" reserved test issuers only (no network).
      return TEST_HOST.test(new URL(conn.config.issuer).hostname)
        ? { ok: true }
        : { ok: false, reason: 'discovery_failed' };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fake DNS and metadata

interface FakeDnsStore {
  records: Map<string, string[][]>;
}
const globalStore = globalThis as unknown as { __yyFakeSsoDns?: FakeDnsStore };
const dns = (): FakeDnsStore => {
  globalStore.__yyFakeSsoDns ??= { records: new Map() };
  return globalStore.__yyFakeSsoDns;
};

/** Publish (or with null, remove) a fake TXT record (dev route and tests). */
export function publishFakeTxt(name: string, value: string | null): void {
  const key = name.toLowerCase().replace(/\.$/, '');
  if (value === null) dns().records.delete(key);
  else dns().records.set(key, [[value]]);
}

/** The fake resolver: records published with `publishFakeTxt`; anything else has none (ENODATA). */
export const fakeTxtResolver: TxtResolver = async (name) => {
  const hit = dns().records.get(name.toLowerCase().replace(/\.$/, ''));
  if (hit) return hit.map((r) => [...r]);
  throw Object.assign(new Error('queryTxt ENODATA'), { code: 'ENODATA' });
};

/** The fake metadata fetcher: reserved test hosts answer the fake IdP's metadata; others fail. */
export const fakeMetadataFetcher: MetadataFetcher = async (url) => {
  const u = new URL(url);
  if (!TEST_HOST.test(u.hostname) || u.pathname.includes('missing')) throw new Error('metadata_unreachable');
  return fakeIdpMetadata(`${u.origin}/idp`);
};
