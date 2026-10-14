/**
 * UUIDv7 for scan ids (RFC 9562): a 48-bit Unix millisecond time then random bits, so ids sort in
 * the order the scans were made. The server applies each `scanId` once (the idempotency key).
 * Random bytes come from the injected source (`expo-crypto` on a phone): Hermes has no
 * `crypto.getRandomValues` to rely on.
 */
import type { RandomBytes } from '@yayatoh/mobile-core';

export function uuidv7(random: RandomBytes, now: number): string {
  const b = Uint8Array.from(random(16));
  if (b.length !== 16) throw new Error('random source must return 16 bytes');
  let ms = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
