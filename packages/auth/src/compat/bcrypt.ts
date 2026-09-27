import bcrypt from 'bcryptjs';

/** True for Laravel/PHP bcrypt hashes (`$2y$`, also `$2a$`/`$2b$`). */
export function isLegacyBcrypt(hash: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(hash);
}

/**
 * Verify a password against a Laravel `$2y$` hash. PHP's `$2y$` is the same algorithm as
 * `$2b$`; only the prefix differs. Callers rehash to Argon2id after a successful verify.
 */
export async function verifyLegacyBcrypt(password: string, hash: string): Promise<boolean> {
  if (!isLegacyBcrypt(hash)) return false;
  return bcrypt.compare(password, hash.replace(/^\$2y\$/, '$2b$'));
}
