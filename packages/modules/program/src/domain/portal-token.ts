import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Exhibitor portal links and sessions (M5.4a). A link is `{orgId}.{memberId}.{secret}` and a
 * session cookie `{orgId}.{secret}`: the org names the tenant to look in (never a header), and the
 * secret, stored only as an HMAC under the app secret, proves the rest. A forged org or member
 * finds nothing. Pure apart from randomness; unit-tested.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SECRET = '[A-Za-z0-9_-]{43}';
const LINK = new RegExp(`^(${UUID})\\.(${UUID})\\.(${SECRET})$`);
const SESSION = new RegExp(`^(${UUID})\\.(${SECRET})$`);
const SITE = new RegExp(`^(${UUID})\\.(${UUID})\\.([0-9a-f]{64})$`);

/** 32 random bytes, base64url (43 characters). */
export const newPortalSecret = () => randomBytes(32).toString('base64url');

export type PortalSecretPurpose = 'link' | 'session';

/** HMAC-SHA256 (hex) of a link or session secret under the app secret. */
export function portalSecretHash(appSecret: string, purpose: PortalSecretPurpose, secret: string): string {
  return createHmac('sha256', appSecret).update(`exhibitor-portal:${purpose}:${secret}`).digest('hex');
}

/** Constant-time comparison of two hex hashes. */
export function sameHash(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export const portalLinkToken = (orgId: string, memberId: string, secret: string) =>
  `${orgId}.${memberId}.${secret}`;

export function parsePortalLinkToken(token: string) {
  const m = LINK.exec(token);
  return m ? { orgId: m[1] as string, memberId: m[2] as string, secret: m[3] as string } : null;
}

export const portalSessionToken = (orgId: string, secret: string) => `${orgId}.${secret}`;

export function parsePortalSessionToken(token: string) {
  const m = SESSION.exec(token);
  return m ? { orgId: m[1] as string, secret: m[2] as string } : null;
}

/**
 * The portal's sign-in page for one event: `{orgId}.{eventId}.{mac}`, so the page can ask for an
 * email without the visitor naming a tenant. Signed: a changed org or event fails.
 */
export function portalSiteToken(appSecret: string, orgId: string, eventId: string): string {
  const mac = createHmac('sha256', appSecret).update(`exhibitor-portal:site:${orgId}:${eventId}`).digest('hex');
  return `${orgId}.${eventId}.${mac}`;
}

export function verifyPortalSiteToken(appSecret: string, token: string) {
  const m = SITE.exec(token);
  if (!m) return null;
  const want = portalSiteToken(appSecret, m[1] as string, m[2] as string).split('.')[2] as string;
  return sameHash(m[3], want) ? { orgId: m[1] as string, eventId: m[2] as string } : null;
}
