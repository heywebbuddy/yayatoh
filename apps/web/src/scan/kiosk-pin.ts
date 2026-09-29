/**
 * Kiosk PIN on the device (M3.4a). The server stores and hands the kiosk only a PBKDF2 hash
 * (`pbkdf2-sha256$iterations$salt$hash`, base64url), so the PIN is checked offline. After 5 wrong
 * PINs the pad locks for 30 s (then again after each further miss).
 */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 30_000;

const fromB64url = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2-sha256' || !salt || !hash || !Number.isInteger(iterations) || iterations < 1000)
    return false;
  if (!/^\d{4,8}$/.test(pin)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations },
      key,
      256,
    ),
  );
  const want = fromB64url(hash);
  if (bits.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= (bits[i] as number) ^ (want[i] as number);
  return diff === 0;
}

/** Until when the PIN pad is locked after `failures` wrong PINs, the last at `lastAt` (ms). */
export function pinLockedUntil(failures: number, lastAt: number): number | null {
  return failures >= PIN_MAX_ATTEMPTS ? lastAt + PIN_LOCK_MS : null;
}
