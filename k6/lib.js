// Shared helpers for the k6 scripts (M1.14d). Plain k6 JavaScript (no build step).
import { sleep } from 'k6';
import http from 'k6/http';

export const randomIntBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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

/* ------------------------------------------------------------------------------------------ */
/* M7.x helpers for the mobile-route scripts (me-tickets, app-checkout, scan-batch-peak,        */
/* staff-heartbeat). Plain k6 JavaScript; nothing here touches the network except `signIn`.     */
/* ------------------------------------------------------------------------------------------ */

const PREPARE_HINT =
  'Run `pnpm --filter @yayatoh/web load:prepare` (local) or pass -e LOAD_DATA=<file> prepared for the target.';

/**
 * Load data for the M7.x scripts, or a clear failure. `required` lists the keys the script needs; a
 * file from before M7.x (no `attendees` / `deviceTokens`) is named as such instead of failing later
 * with "undefined is not iterable".
 */
export function loadMobileData(required) {
  const path = __ENV.LOAD_DATA || './.data/load.json';
  let raw;
  try {
    raw = open(path);
  } catch (_) {
    throw new Error(`Load data not found at ${path}. ${PREPARE_HINT}`);
  }
  const data = JSON.parse(raw);
  const missing = required.filter(
    (k) => data[k] === undefined || data[k] === null || (Array.isArray(data[k]) && data[k].length === 0),
  );
  if (missing.length > 0)
    throw new Error(
      `Load data ${path} has no ${missing.join(', ')} (prepared before M7.x, or with LOAD_ATTENDEES=0 / LOAD_DEVICES=0). ${PREPARE_HINT}`,
    );
  return data;
}

/** A positive integer env knob, or the default; a malformed value fails the run instead of being ignored. */
export function envNumber(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name}=${raw} is not a non-negative number`);
  return n;
}

/**
 * The headers the mobile apps send (`X-Yayatoh-Client: <app>/<version> (<build>)`), plus one
 * visitor IP per call so the limiter sees phones, not one load generator.
 */
export function appHeaders(client, extra = {}) {
  return { 'x-yayatoh-client': `${client}/1.0.0 (1)`, ...visitorHeaders(), ...extra };
}

/** Bearer + JSON headers for a signed-in attendee or a Staff device. */
export function bearer(token, client, extra = {}) {
  return appHeaders(client, {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extra,
  });
}

/** Parse a response body as JSON, or null (a failed check, never an exception that ends the VU). */
export function jsonOf(res) {
  try {
    return res.json();
  } catch (_) {
    return null;
  }
}

/**
 * The attendees' bearer tokens for a run lasting `needMs`. The tokens `load:prepare` wrote are used
 * while they have that much life left (access tokens last 15 minutes); the rest sign in with
 * `POST /v1/auth/token` (grantType password), one at a time, `SIGNIN_PACE` seconds apart (the
 * sign-in limit is 100 a minute per IP: set `-e SIGNIN_PACE=0.7` when every request reaches the
 * server from one address, as behind a proxy). Fails the run when a sign-in is refused.
 */
export function attendeeTokens(data, count, needMs) {
  const users = data.attendees.slice(0, count);
  const pace = envNumber('SIGNIN_PACE', 0);
  const out = [];
  let signedIn = 0;
  for (const a of users) {
    if (a.expiresAt - Date.now() > needMs + 30000) {
      out.push({ email: a.email, token: a.accessToken });
      continue;
    }
    if (pace > 0 && signedIn > 0) sleep(pace);
    const res = http.post(
      `${BASE}/api/v1/auth/token`,
      JSON.stringify({ grantType: 'password', email: a.email, password: data.attendeePassword }),
      {
        headers: appHeaders('yayatoh-ios', { 'content-type': 'application/json' }),
        tags: { name: 'signin' },
      },
    );
    if (res.status !== 200)
      throw new Error(
        `Sign-in of ${a.email} failed with ${res.status} (${res.body}). The prepared accounts must exist on the target; ${PREPARE_HINT}`,
      );
    signedIn += 1;
    out.push({ email: a.email, token: jsonOf(res).accessToken });
  }
  return out;
}

/** A RFC 9457 problem answer: right content type, and a stable `code`. */
export function isProblem(res, code) {
  return /problem\+json/.test(res.headers['Content-Type'] || '') && jsonOf(res)?.code === code;
}
