import { isLegacyBcrypt, verifyLegacyBcrypt } from './bcrypt.ts';

/**
 * Dual-hash grace (roadmap §7.5 T1): a person who had an account on both legacy instances (merged
 * into one identity) may sign in with either instance's password for 180 days after the cutover
 * freeze; after that only the primary one works. The migration stores
 * `$yydual$<until, epoch seconds>$<primary>|<other>|…` (bcrypt hashes never contain `|`), and the
 * first successful sign-in rehashes to Argon2id, which ends the grace for that person.
 */
export const GRACE_DAYS = 180;
const PREFIX = '$yydual$';

export function dualHash(primary: string, others: readonly string[], until: Date): string {
  const all = [primary, ...others.filter((h) => h !== primary)];
  if (!all.every(isLegacyBcrypt)) throw new Error('dualHash: only legacy bcrypt hashes');
  return `${PREFIX}${Math.floor(until.getTime() / 1000)}$${all.join('|')}`;
}

export const isDualHash = (hash: string) => hash.startsWith(PREFIX);

export function parseDualHash(hash: string): { until: Date; primary: string; others: string[] } | null {
  if (!isDualHash(hash)) return null;
  const rest = hash.slice(PREFIX.length);
  const i = rest.indexOf('$');
  const secs = Number(rest.slice(0, i));
  const hashes = rest.slice(i + 1).split('|');
  if (i <= 0 || !Number.isSafeInteger(secs) || !hashes.length || !hashes.every(isLegacyBcrypt)) return null;
  const [primary, ...others] = hashes as [string, ...string[]];
  return { until: new Date(secs * 1000), primary, others };
}

/** Verify against a dual hash: the primary always, the others only until the grace ends. */
export async function verifyDualHash(password: string, hash: string, now = new Date()): Promise<boolean> {
  const d = parseDualHash(hash);
  if (!d) return false;
  if (await verifyLegacyBcrypt(password, d.primary)) return true;
  if (now.getTime() >= d.until.getTime()) return false;
  for (const h of d.others) if (await verifyLegacyBcrypt(password, h)) return true;
  return false;
}
