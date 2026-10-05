/**
 * Per-type eligibility (M5.1a), pure: who may pick a registration type. The checkout command
 * applies it to whatever the client sends; pages use it only to hide what cannot be picked.
 */

export type Eligibility =
  | { readonly kind: 'open' }
  | { readonly kind: 'access_code'; readonly accessCode: string }
  | { readonly kind: 'email_domain'; readonly emailDomains: readonly string[] };

export type EligibilityRefusal = 'code_required' | 'code_wrong' | 'domain_not_allowed';

const CODE = /^[A-Z0-9_-]{4,32}$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A code as stored and compared: trimmed, upper case. Null when it can't be a code. */
export function normalizeAccessCode(raw: string): string | null {
  const c = raw.trim().toUpperCase();
  return CODE.test(c) ? c : null;
}

/** A domain as stored: lower case, no leading `@` or dot. Null when it isn't a domain name. */
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, '').replace(/^\./, '').replace(/\.$/, '');
  return DOMAIN.test(d) ? d : null;
}

/** The domain of an address (after its last `@`), lower case; null without one. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const d = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return d ? d : null;
}

/** `staff.example.org` matches `example.org`; `badexample.org` does not. */
export function domainAllowed(domain: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => domain === a || domain.endsWith(`.${a}`));
}

/** Same-length comparison that does not stop at the first difference. */
function sameCode(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Why a buyer may not pick a type, or null when they may. */
export function eligibilityRefusal(
  rule: Eligibility,
  buyer: { readonly email: string; readonly accessCode?: string | null },
): EligibilityRefusal | null {
  if (rule.kind === 'open') return null;
  if (rule.kind === 'access_code') {
    const given = buyer.accessCode ? normalizeAccessCode(buyer.accessCode) : null;
    if (!buyer.accessCode?.trim()) return 'code_required';
    return given && sameCode(given, rule.accessCode) ? null : 'code_wrong';
  }
  const d = emailDomain(buyer.email);
  return d && domainAllowed(d, rule.emailDomains) ? null : 'domain_not_allowed';
}
