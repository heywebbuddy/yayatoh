// Shared helpers for the k6 scripts (M1.14d). Plain k6 JavaScript (no build step).

const randomIntBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const BASE = __ENV.BASE_URL || 'http://localhost:3000';

/** Load data written by `pnpm --filter @yayatoh/web load:prepare` (local) or provided for staging. */
export function loadData() {
  return JSON.parse(open(__ENV.LOAD_DATA || './.data/load.json'));
}

/**
 * Each iteration is a different visitor: a fresh device cookie and its own client IP (TEST-NET),
 * the way real buyers arrive. The shared-IP case is covered by the rate-limit tests.
 */
export function visitorHeaders() {
  return { 'x-real-ip': `198.51.${randomIntBetween(0, 255)}.${randomIntBetween(1, 254)}` };
}

export function uuid() {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[randomIntBetween(0, 15)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
