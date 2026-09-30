/** No 0/o, 1/l/i: automatic codes are read aloud and typed from print. */
export const SHORT_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const AUTO_CODE_LENGTH = 7;

export function generateShortCode(length = AUTO_CODE_LENGTH): string {
  // Rejection sampling keeps every character equally likely (31 doesn't divide 256).
  const limit = 256 - (256 % SHORT_CODE_ALPHABET.length);
  let s = '';
  while (s.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && s.length < length) s += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
    }
  }
  return s;
}

/** Paths and words a vanity code may not take (routes, brand and abuse-prone words). */
export const RESERVED_SHORT_CODES: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'checkout',
  'dashboard',
  'e',
  'events',
  'help',
  'login',
  'logout',
  'my-tickets',
  'new',
  'o',
  'official',
  'orders',
  'portal',
  'scan',
  'settings',
  'sign-in',
  'signup',
  'staff',
  'support',
  'venues',
  'www',
  'yayatoh',
]);

export type VanityProblem = 'too_short' | 'too_long' | 'invalid_characters' | 'reserved';

/** Short codes are case-insensitive: stored and looked up lower-case. */
export const normalizeShortCode = (code: string) => code.trim().toLowerCase();

/**
 * Validate a vanity code (after normalizing): 3–40 of a–z, 0–9 and single hyphens, starting and
 * ending with a letter or digit, not a reserved word. Returns the problem, or null when valid.
 */
export function vanityProblem(raw: string): VanityProblem | null {
  const code = normalizeShortCode(raw);
  if (code.length < 3) return 'too_short';
  if (code.length > 40) return 'too_long';
  if (!/^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$/.test(code)) return 'invalid_characters';
  if (RESERVED_SHORT_CODES.has(code)) return 'reserved';
  return null;
}
