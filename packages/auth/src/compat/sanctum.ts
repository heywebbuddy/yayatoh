import { createHash, timingSafeEqual } from 'node:crypto';

export interface SanctumToken {
  /** personal_access_tokens.id */
  readonly id: number;
  /** The secret part after `id|`, hashed with SHA-256 in `personal_access_tokens.token`. */
  readonly secret: string;
}

/** Parse a Sanctum bearer token `"<id>|<secret>"`. Returns null for anything else. */
export function parseSanctumToken(bearer: string): SanctumToken | null {
  const i = bearer.indexOf('|');
  if (i <= 0) return null;
  const id = Number(bearer.slice(0, i));
  const secret = bearer.slice(i + 1);
  if (!Number.isSafeInteger(id) || id <= 0 || secret.length < 20) return null;
  return { id, secret };
}

/** Constant-time check of a Sanctum secret against the stored SHA-256 hex hash. */
export function verifySanctumSecret(secret: string, storedSha256Hex: string): boolean {
  const actual = createHash('sha256').update(secret).digest();
  const expected = Buffer.from(storedSha256Hex, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
