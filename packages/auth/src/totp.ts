import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238, HMAC-SHA-1, 6 digits, 30 s) and backup-code helpers. Pure functions: the same
 * math Better Auth's two-factor plugin uses for the sign-in challenge, so a seed enrolled here
 * verifies there. The HMAC key is the UTF-8 bytes of the stored secret string; authenticator
 * apps receive it base32-encoded (the "setup key").
 */
export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
/** Codes one step either side of now are accepted (clock drift between phone and server). */
export const TOTP_WINDOW = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** RFC 4648 base32 without padding. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Decodes base32, ignoring case, spaces, dashes and padding. Throws on other characters. */
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** HOTP (RFC 4226) for one counter. */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 15;
  const bin =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** The time step (counter) for a moment. */
export const totpStep = (atMs: number) => Math.floor(atMs / 1000 / TOTP_PERIOD_S);

/** The TOTP code at a moment. */
export function totp(key: Uint8Array, atMs: number, digits = TOTP_DIGITS): string {
  return hotp(key, totpStep(atMs), digits);
}

/** The HMAC key for a stored secret string (Better Auth's convention: its UTF-8 bytes). */
export const secretKey = (secret: string) => new Uint8Array(Buffer.from(secret, 'utf8'));

/** The setup key shown to people (base32 of the HMAC key), in groups of four for reading. */
export function setupKey(secret: string): string {
  return base32Encode(secretKey(secret))
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/** Only digits, exactly six: what a person may type as a TOTP code (spaces tolerated). */
export function normalizeTotp(input: string): string | null {
  const code = input.replace(/\s/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Whether `code` is valid for `secret` at `atMs`, one step either side (constant-time compare). */
export function verifyTotp(secret: string, code: string, atMs: number): boolean {
  return matchTotpStep(secret, code, atMs) !== null;
}

/**
 * The time step `code` belongs to (one step either side of `atMs`), or null if it matches none.
 * Replay protection keeps the last accepted step per person and refuses that step or an earlier
 * one, so a code works once even inside its 90-second window (RFC 6238 §5.2).
 */
export function matchTotpStep(secret: string, code: string, atMs: number): number | null {
  const c = normalizeTotp(code);
  if (!c) return null;
  const key = secretKey(secret);
  const step = totpStep(atMs);
  let matched: number | null = null;
  // Every candidate is compared (constant time); the newest matching step wins.
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) if (same(hotp(key, step + d), c)) matched = step + d;
  return matched;
}

/** Whether a code for `step` may still be accepted after `lastUsed` (replay protection). */
export const isFreshStep = (step: number, lastUsed: number | null | undefined) =>
  lastUsed === null || lastUsed === undefined || step > lastUsed;

/** `otpauth://` URI for authenticator apps (and the QR code). */
export function otpauthUri(opts: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secretKey(opts.secret)),
    issuer: opts.issuer,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** A random alphanumeric secret: 20 characters ≈ 119 bits, a 32-character setup key. */
export function generateTotpSecret(length = 20): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALNUM[randomInt(ALNUM.length)];
  return s;
}

export const BACKUP_CODE_COUNT = 10;

/** Ten single-use backup codes, `xxxxx-xxxxx` (Better Auth's format). */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = generateTotpSecret(10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** A typed backup code in the stored format (spaces removed, the dash put back). */
export function normalizeBackupCode(input: string): string | null {
  const raw = input.replace(/[\s-]/g, '');
  return /^[A-Za-z0-9]{10}$/.test(raw) ? `${raw.slice(0, 5)}-${raw.slice(5)}` : null;
}

/**
 * A deterministic TOTP secret for a seeded development persona, derived from the dev-only persona
 * password (never stored in the repo). Local and preview seeds only; the e2e suite derives the
 * same secret to answer the sign-in challenge.
 */
export function devPersonaTotpSecret(email: string, devPassword: string): string {
  const mac = createHmac('sha256', devPassword).update(`yayatoh-dev-totp:${email}`).digest();
  let s = '';
  for (let i = 0; i < 20; i++) s += ALNUM[(mac[i] ?? 0) % ALNUM.length];
  return s;
}
