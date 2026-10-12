import { normalizeName } from './guests.ts';
import { lookupHash, type ManifestRow } from './offline.ts';

/**
 * Ticket-holder lookup at the door (agreement §8: "name, phone and email lookup"), shared by the
 * server and the Scan PWA so a device finds the same people offline as the console does online.
 * The manifest carries names, and contact details only as per-event salted hashes: email and
 * phone match exactly, names by every word of the query. Universal: no `node:*`.
 */

export type LookupKind = 'name' | 'email' | 'phone';

/** Fewest digits a typed phone number needs; shorter input is searched as a name. */
export const PHONE_KEY_DIGITS = 8;

/** Most matches a lookup returns (the door screen shows them all). */
export const LOOKUP_LIMIT = 25;

/** What the query looks like: an email address, a phone number, or (anything else) a name. */
export function lookupKind(query: string): LookupKind {
  const q = query.trim();
  if (q.includes('@')) return 'email';
  if (/^[+\d\s().-]+$/.test(q) && phoneKey(q) !== null) return 'phone';
  return 'name';
}

/**
 * The comparable part of a phone number: its last eight digits, so `+1 (415) 555-0134` and the
 * local `415 555 0134` meet without knowing the country. Null when there are too few digits to
 * tell people apart.
 */
export function phoneKey(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits.length >= PHONE_KEY_DIGITS ? digits.slice(-PHONE_KEY_DIGITS) : null;
}

/** The manifest's offline lookup hash for a phone number (domain-separated from the email one). */
export async function phoneLookupHash(salt: string, phone: string): Promise<string | null> {
  const key = phoneKey(phone);
  return key ? lookupHash(salt, `tel:${key}`) : null;
}

/** True when every word of the (normalized) query starts a word of the (normalized) name. */
export function nameMatches(name: string, query: string): boolean {
  const words = normalizeName(name).split(' ').filter(Boolean);
  const wanted = normalizeName(query).split(' ').filter(Boolean);
  if (wanted.length === 0) return false;
  return wanted.every((w) => words.some((n) => n.startsWith(w)));
}

/**
 * Ticket holders matching a door-staff query, best first: active passes before void ones, then by
 * name. Name queries need two characters; email and phone match their hashes exactly.
 */
export async function findTicketHolders(
  rows: Iterable<ManifestRow>,
  salt: string,
  query: string,
  limit = LOOKUP_LIMIT,
): Promise<{ readonly kind: LookupKind; readonly rows: ManifestRow[] }> {
  const q = query.trim();
  const kind = lookupKind(q);
  let match: (r: ManifestRow) => boolean;
  if (kind === 'email') {
    const h = await lookupHash(salt, q);
    match = (r) => r.emailHash === h;
  } else if (kind === 'phone') {
    const h = await phoneLookupHash(salt, q);
    match = (r) => h !== null && r.phoneHash === h;
  } else {
    if (normalizeName(q).length < 2) return { kind, rows: [] };
    match = (r) => nameMatches(r.holderName, q);
  }
  const found: ManifestRow[] = [];
  for (const r of rows) if (match(r)) found.push(r);
  found.sort(
    (a, b) =>
      (a.status === 'void' ? 1 : 0) - (b.status === 'void' ? 1 : 0) ||
      a.holderName.localeCompare(b.holderName) ||
      a.shortCode.localeCompare(b.shortCode),
  );
  return { kind, rows: found.slice(0, limit) };
}
