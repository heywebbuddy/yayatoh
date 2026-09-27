import 'server-only';
import { postgresRateLimitStore } from '@yayatoh/platform';
import {
  createRateLimiter,
  DEVICE_COOKIE,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitPolicyName,
  type RateLimitStore,
  retryAfterSeconds,
  upstashRateLimitStore,
} from '@yayatoh/platform/security';
import { cookies, headers } from 'next/headers';

let limiter: RateLimiter | undefined;

/**
 * The web app's limiter: Upstash Redis when the owner's database is configured, otherwise the
 * Postgres counters. A store outage fails open (logged), never blocking sign-in or checkout.
 */
export function rateLimiter(): RateLimiter {
  if (!limiter) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const store: RateLimitStore =
      url && token ? upstashRateLimitStore({ url, token }) : postgresRateLimitStore;
    limiter = createRateLimiter(store, (err) =>
      console.error(JSON.stringify({ rateLimit: 'store_error', message: String(err) })),
    );
  }
  return limiter;
}

/**
 * The client IP as the hosting edge reports it (Vercel sets `x-real-ip` / `x-forwarded-for`).
 * Used only for abuse limits, never for tenancy or authorization.
 */
export function clientIp(h: Headers): string | null {
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || null;
}

function deviceFromCookieHeader(cookie: string | null): string | null {
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === DEVICE_COOKIE) return v.join('=');
  }
  return null;
}

/** Count a route-handler request against a policy. */
export function limitRequest(
  req: Request,
  policy: RateLimitPolicyName,
  opts: { identity?: string | null; scope?: string } = {},
): Promise<RateLimitDecision> {
  return rateLimiter().check(
    policy,
    {
      device: deviceFromCookieHeader(req.headers.get('cookie')),
      ip: clientIp(req.headers),
      identity: opts.identity,
    },
    { scope: opts.scope },
  );
}

/** Count a Server Action against a policy (reads the request's headers and cookies). */
export async function limitAction(
  policy: RateLimitPolicyName,
  opts: { identity?: string | null; scope?: string } = {},
): Promise<RateLimitDecision> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return rateLimiter().check(
    policy,
    { device: c.get(DEVICE_COOKIE)?.value ?? null, ip: clientIp(h), identity: opts.identity },
    { scope: opts.scope },
  );
}

/** Minutes to show in the localized "try again in …" message (at least 1). */
export const retryAfterMinutes = (d: RateLimitDecision) => Math.max(1, Math.ceil(retryAfterSeconds(d) / 60));
