import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { isLegacyBcrypt, verifyLegacyBcrypt } from './compat/bcrypt.ts';
import { isDualHash, verifyDualHash } from './compat/dual.ts';

/** OWASP 2025 Argon2id baseline: 19 MiB, t=2, p=1. */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 as const };

export function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2);
}

/**
 * Verifies Argon2id hashes, migrated Laravel `$2y$` bcrypt hashes and the dual-hash grace of
 * merged legacy identities (`$yydual$`, compat/dual.ts).
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (isLegacyBcrypt(hash)) return verifyLegacyBcrypt(password, hash);
  if (isDualHash(hash)) return verifyDualHash(password, hash);
  if (!hash.startsWith('$argon2')) return false;
  return argon2Verify(hash, password);
}

export const needsRehash = (hash: string) => isLegacyBcrypt(hash) || isDualHash(hash);
