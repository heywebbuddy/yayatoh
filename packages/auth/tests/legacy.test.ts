import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptLaravelCookie,
  laravelDecrypt,
  parseAppKey,
  parseRememberCookie,
  parseSanctumToken,
  verifyLaravelSignedUrl,
  verifyLegacyBcrypt,
  verifySanctumSecret,
} from '../src/legacy/index.ts';

// Test-only key, generated for these vectors. Real APP_KEYs live in the vault.
const APP_KEY = `base64:${Buffer.alloc(32, 7).toString('base64')}`;
const key = parseAppKey(APP_KEY);

/** Laravel Encrypter::encrypt (AES-256-CBC), re-implemented from its documented format. */
function laravelEncrypt(plain: string, k: Buffer): string {
  const iv = randomBytes(16);
  const c = createCipheriv('aes-256-cbc', k, iv);
  const value = Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64');
  const ivB64 = iv.toString('base64');
  const mac = createHmac('sha256', k)
    .update(ivB64 + value)
    .digest('hex');
  return Buffer.from(JSON.stringify({ iv: ivB64, value, mac, tag: '' })).toString('base64');
}

describe('legacy bcrypt', () => {
  it("verifies Laravel's well-known $2y$ hash of 'password'", async () => {
    const hash = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
    expect(await verifyLegacyBcrypt('password', hash)).toBe(true);
    expect(await verifyLegacyBcrypt('Password', hash)).toBe(false);
    expect(await verifyLegacyBcrypt('password', '$argon2id$v=19$m=19456,t=2,p=1$x$y')).toBe(false);
  });
});

describe('Sanctum tokens', () => {
  it('parses id|secret and checks the SHA-256 hash in constant time', () => {
    const secret = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdo';
    const stored = createHash('sha256').update(secret).digest('hex');
    const t = parseSanctumToken(`42|${secret}`);
    expect(t).toEqual({ id: 42, secret });
    expect(verifySanctumSecret(secret, stored)).toBe(true);
    expect(verifySanctumSecret(`${secret}x`, stored)).toBe(false);
    expect(parseSanctumToken('nope')).toBeNull();
    expect(parseSanctumToken('0|short')).toBeNull();
  });
});

describe('Laravel Crypt', () => {
  it('round-trips an encrypted value and rejects tampering or a wrong key', () => {
    const payload = laravelEncrypt('hello', key);
    expect(laravelDecrypt(payload, key)).toBe('hello');
    const other = parseAppKey(`base64:${Buffer.alloc(32, 9).toString('base64')}`);
    expect(laravelDecrypt(payload, other)).toBeNull();
    const tampered = JSON.parse(Buffer.from(payload, 'base64').toString());
    tampered.value = Buffer.from('evil').toString('base64');
    expect(laravelDecrypt(Buffer.from(JSON.stringify(tampered)).toString('base64'), key)).toBeNull();
  });

  it('reads a remember-me cookie bound to its cookie name', () => {
    const name = `remember_web_${createHash('sha1').update('Illuminate\\Auth\\SessionGuard').digest('hex')}`;
    const inner = `1027|remembertoken60chars|$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi`;
    const prefix = createHmac('sha1', key).update(`${name}v2`).digest('hex');
    const cookie = encodeURIComponent(laravelEncrypt(`${prefix}|${inner}`, key));
    const plain = decryptLaravelCookie(name, cookie, key);
    expect(plain).toBe(inner);
    expect(parseRememberCookie(plain as string)).toMatchObject({
      userId: '1027',
      token: 'remembertoken60chars',
    });
    // The same ciphertext presented under another cookie name is rejected.
    expect(decryptLaravelCookie('laravel_session', cookie, key)).toBeNull();
  });
});

describe('signed URLs', () => {
  const sign = (url: string) => `${url}&signature=${createHmac('sha256', key).update(url).digest('hex')}`;
  it('accepts a valid, unexpired signature and rejects edits or expiry', () => {
    const now = new Date('2026-09-27T00:00:00Z');
    const exp = Math.floor(now.getTime() / 1000) + 3600;
    const url = sign(`https://yayatoh.com/email/verify/1027/abc?expires=${exp}`);
    expect(verifyLaravelSignedUrl(url, key, now)).toBe(true);
    expect(verifyLaravelSignedUrl(url.replace('1027', '1028'), key, now)).toBe(false);
    expect(verifyLaravelSignedUrl(url, key, new Date((exp + 1) * 1000))).toBe(false);
    expect(verifyLaravelSignedUrl('https://yayatoh.com/x?signature=zz', key, now)).toBe(false);
  });
});
