import { createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Laravel `Crypt` compatibility (AES-256-CBC + HMAC-SHA256, the default cipher) for reading
 * legacy remember-me cookies and encrypted values during migration. Keys are per instance
 * (yayatoh.com, abc.yayatoh.com) and come from the vault, never the repo.
 */
export function parseAppKey(appKey: string): Buffer {
  const key = appKey.startsWith('base64:')
    ? Buffer.from(appKey.slice(7), 'base64')
    : Buffer.from(appKey, 'utf8');
  if (key.length !== 32) throw new Error('APP_KEY must be 32 bytes for AES-256-CBC');
  return key;
}

interface Payload {
  iv: string;
  value: string;
  mac: string;
  tag?: string;
}

/** Decrypt a Laravel `encrypt()` payload. Returns the raw plaintext, or null if invalid. */
export function laravelDecrypt(payloadB64: string, key: Buffer): string | null {
  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')) as Payload;
  } catch {
    return null;
  }
  if (typeof p?.iv !== 'string' || typeof p.value !== 'string' || typeof p.mac !== 'string') return null;
  const expected = createHmac('sha256', key)
    .update(p.iv + p.value)
    .digest();
  const mac = Buffer.from(p.mac, 'hex');
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(p.iv, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(p.value, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

/** Unwrap a PHP `serialize()`d string (`s:<len>:"…";`), as Laravel does for encrypted cookies. */
export function unserializeString(v: string): string | null {
  const m = /^s:(\d+):"([\s\S]*)";$/.exec(v);
  if (!m) return null;
  const body = m[2] ?? '';
  return Buffer.byteLength(body, 'utf8') === Number(m[1]) ? body : null;
}

/**
 * Decrypt a Laravel cookie. Since Laravel 5.6.30 the plaintext is prefixed with
 * `hmac_sha1(cookieName + 'v2', key) + '|'`, binding the value to the cookie name.
 */
export function decryptLaravelCookie(cookieName: string, cookieValue: string, key: Buffer): string | null {
  const plain = laravelDecrypt(decodeURIComponent(cookieValue), key);
  if (plain === null) return null;
  const value = unserializeString(plain) ?? plain;
  const prefix = `${createHmac('sha1', key).update(`${cookieName}v2`).digest('hex')}|`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

export interface RememberMe {
  readonly userId: string;
  readonly token: string;
  readonly passwordHash: string;
}

/**
 * A remember-me cookie (`remember_web_<sha1>`) holds `userId|rememberToken|passwordHash`.
 * The caller must check the token against `users.remember_token` and the hash against the
 * current password hash (a password change invalidates it).
 */
export function parseRememberCookie(plain: string): RememberMe | null {
  const parts = plain.split('|');
  if (parts.length !== 3 || !parts.every(Boolean)) return null;
  const [userId, token, passwordHash] = parts as [string, string, string];
  return { userId, token, passwordHash };
}
