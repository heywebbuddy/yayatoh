/**
 * Email-domain verification (M6.5a): the org publishes `yayatoh-verification=<token>` as a TXT
 * record at `_yayatoh-sso.<domain>`; the check reads it through the `TxtResolver` port.
 */
export const VERIFICATION_LABEL = '_yayatoh-sso';
export const VERIFICATION_PREFIX = 'yayatoh-verification=';

/** Where the TXT record goes, and what it says. */
export const verificationRecord = (domain: string, token: string) => ({
  name: `${VERIFICATION_LABEL}.${domain}`,
  value: `${VERIFICATION_PREFIX}${token}`,
});

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * A domain as typed (or pasted as an address or URL) → its canonical form, or null. Single-label
 * names, IP addresses and the platform's own names are refused.
 */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (d.includes('@')) d = d.slice(d.lastIndexOf('@') + 1);
  d = d.replace(/^https?:\/\//, '').replace(/[/:?#].*$/, '').replace(/\.$/, '');
  if (d.length < 4 || d.length > 253 || !DOMAIN.test(d)) return null;
  if (/^[0-9.]+$/.test(d)) return null;
  if (RESERVED.some((r) => d === r || d.endsWith(`.${r}`))) return null;
  return d;
}

/** Names no org may claim: the platform's own. */
const RESERVED = ['yayatoh.com', 'yayatoh.events'];

/** The domain of an email address (lowercase), or null. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  return normalizeDomain(email.slice(at + 1));
}

/** Whether the TXT answers (each record as its strings) contain the expected value. */
export function txtMatches(records: readonly (readonly string[])[], token: string): boolean {
  const want = `${VERIFICATION_PREFIX}${token}`;
  return records.some((r) => r.join('').trim() === want);
}
