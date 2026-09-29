/**
 * Rate limiting (M1.14a): a sliding-window counter per key, with pluggable stores (memory for
 * tests and single-process dev, Postgres until Upstash exists, Upstash Redis REST when it does).
 *
 * The window is the classic two-bucket approximation: the previous fixed window's count is
 * weighted by how much of it still overlaps the sliding window. It never lets a burst of 2× the
 * limit through at a window boundary, and it needs O(1) state per key.
 *
 * Keys are built per policy from the device cookie (or, without one, the client IP), the
 * identity being attacked (an email, hashed) and an IP ceiling. Venues and offices share one IP,
 * so the per-IP ceiling is generous and the tight limits are per device and per identity.
 *
 * Pure apart from Web Crypto and fetch: no `node:*`, so proxy.ts and route handlers can use it.
 */

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export interface WindowState {
  /** Start of the current fixed window (ms since epoch, a multiple of windowMs). */
  readonly windowStart: number;
  readonly prev: number;
  readonly curr: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  /** Requests left in the window after this one (0 when denied). */
  readonly remaining: number;
  /** When denied: how long until one more request would be allowed. 0 when allowed. */
  readonly retryAfterMs: number;
}

/**
 * One hit against a key. Denied hits are not counted, so a client that keeps retrying while
 * blocked is let back in on schedule rather than locked out for ever.
 */
export function slidingWindow(
  state: WindowState | null,
  now: number,
  rule: RateLimitRule,
): { state: WindowState; decision: RateLimitDecision } {
  const { limit, windowMs: w } = rule;
  if (limit < 1 || w < 1) throw new Error('rate limit: limit and window must be positive');
  const start = Math.floor(now / w) * w;
  let prev = 0;
  let curr = 0;
  if (state && state.windowStart === start) {
    prev = state.prev;
    curr = state.curr;
  } else if (state && state.windowStart === start - w) {
    prev = state.curr;
  }
  const elapsed = now - start;
  const estimate = prev * (1 - elapsed / w) + curr;
  if (estimate + 1 <= limit) {
    return {
      state: { windowStart: start, prev, curr: curr + 1 },
      decision: {
        allowed: true,
        limit,
        remaining: Math.max(0, Math.floor(limit - estimate - 1)),
        retryAfterMs: 0,
      },
    };
  }
  return {
    state: { windowStart: start, prev, curr },
    decision: { allowed: false, limit, remaining: 0, retryAfterMs: retryAfter(prev, curr, elapsed, rule) },
  };
}

/** Time until `prev·(1 − t/w) + curr + 1 ≤ limit` holds again (in this window or the next). */
export function retryAfter(prev: number, curr: number, elapsed: number, rule: RateLimitRule): number {
  const { limit, windowMs: w } = rule;
  const room = limit - 1 - curr;
  if (prev > 0 && room >= 0) {
    // Solve prev·(1 − (elapsed + dt)/w) ≤ room for dt within this window.
    const dt = w * (1 - room / prev) - elapsed;
    if (dt < w - elapsed) return Math.max(1, Math.ceil(dt));
  }
  // Next window: prev' = curr, curr' = 0 → curr·(1 − t/w) + 1 ≤ limit.
  const t = curr > limit - 1 ? w * (1 - (limit - 1) / curr) : 0;
  return Math.max(1, Math.ceil(w - elapsed + t));
}

export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitDecision>;
}

/** In-process store: tests, `next dev`, and a last-resort fallback. Not shared across instances. */
export function memoryRateLimitStore(maxKeys = 50_000): RateLimitStore & { clear(): void } {
  const buckets = new Map<string, WindowState & { windowMs: number }>();
  return {
    async hit(key, rule, now) {
      const cur = buckets.get(key);
      const { state, decision } = slidingWindow(
        cur && cur.windowMs === rule.windowMs ? cur : null,
        now,
        rule,
      );
      buckets.delete(key);
      buckets.set(key, { ...state, windowMs: rule.windowMs });
      // Oldest-first eviction keeps memory bounded under a key-spraying attack.
      while (buckets.size > maxKeys) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
      return decision;
    },
    clear: () => buckets.clear(),
  };
}

/**
 * The same algorithm as a Redis script (atomic per key). KEYS[1] = key; ARGV = limit, windowMs,
 * nowMs. Returns {allowed(0|1), remaining, retryAfterMs}.
 */
export const REDIS_SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local w = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local start = math.floor(now / w) * w
local s = redis.call('HMGET', key, 'start', 'prev', 'curr')
local prev, curr = 0, 0
if s[1] then
  local ws = tonumber(s[1])
  if ws == start then prev = tonumber(s[2]); curr = tonumber(s[3])
  elseif ws == start - w then prev = tonumber(s[3]) end
end
local elapsed = now - start
local estimate = prev * (1 - elapsed / w) + curr
if estimate + 1 <= limit then
  redis.call('HSET', key, 'start', start, 'prev', prev, 'curr', curr + 1)
  redis.call('PEXPIRE', key, 2 * w)
  return {1, math.floor(limit - estimate - 1), 0}
end
local room = limit - 1 - curr
if prev > 0 and room >= 0 then
  local dt = w * (1 - room / prev) - elapsed
  if dt < w - elapsed then return {0, 0, math.max(1, math.ceil(dt))} end
end
local t = 0
if curr > limit - 1 then t = w * (1 - (limit - 1) / curr) end
return {0, 0, math.max(1, math.ceil(w - elapsed + t))}
`;

/**
 * Upstash Redis over its REST API (no client dependency; fetch only). Needs the owner's Upstash
 * database: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (owner inbox, M1.14).
 */
export function upstashRateLimitStore(opts: {
  url: string;
  token: string;
  prefix?: string;
  fetch?: typeof fetch;
}): RateLimitStore {
  const f = opts.fetch ?? fetch;
  const prefix = opts.prefix ?? 'rl:';
  return {
    async hit(key, rule, now) {
      const res = await f(opts.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
        body: JSON.stringify([
          'EVAL',
          REDIS_SLIDING_WINDOW_LUA,
          '1',
          `${prefix}${key}`,
          String(rule.limit),
          String(rule.windowMs),
          String(now),
        ]),
      });
      if (!res.ok) throw new Error(`rate limit store: HTTP ${res.status}`);
      const body = (await res.json()) as { result?: [number, number, number]; error?: string };
      if (!body.result) throw new Error(`rate limit store: ${body.error ?? 'no result'}`);
      const [allowed, remaining, retry] = body.result;
      return { allowed: allowed === 1, limit: rule.limit, remaining, retryAfterMs: retry };
    },
  };
}

/** A limiter policy: which buckets one request counts against. */
export interface RateLimitPolicy {
  /** Per device cookie (tight). */
  readonly device: RateLimitRule;
  /** Per client IP when there is no device cookie (looser: shared IPs). */
  readonly anonymousIp: RateLimitRule;
  /** Per identity under attack (email, holder link), across devices. */
  readonly identity?: RateLimitRule;
  /** Per client IP ceiling, whatever the device (generous: venue Wi-Fi, offices, carrier NAT). */
  readonly ipCeiling: RateLimitRule;
}

const MIN = 60_000;

/** Defaults (pending owner review; see docs/specs/M1.14/spec.md). */
export const RATE_LIMIT_POLICIES = {
  /** Password and code sign-in attempts. */
  signIn: {
    device: { limit: 10, windowMs: 10 * MIN },
    anonymousIp: { limit: 30, windowMs: 10 * MIN },
    identity: { limit: 20, windowMs: 15 * MIN },
    ipCeiling: { limit: 300, windowMs: 10 * MIN },
  },
  /** Emailed sign-in codes (each one sends an email). */
  otpSend: {
    device: { limit: 5, windowMs: 10 * MIN },
    anonymousIp: { limit: 15, windowMs: 10 * MIN },
    identity: { limit: 5, windowMs: 15 * MIN },
    ipCeiling: { limit: 100, windowMs: 10 * MIN },
  },
  /** Guest email codes (M1.5f: checkout verification, "My tickets" sign-in, seat finder). Each one
   * sends an email: per device, per destination address, and a generous shared-IP ceiling. */
  guestCode: {
    device: { limit: 10, windowMs: 10 * MIN },
    anonymousIp: { limit: 30, windowMs: 10 * MIN },
    identity: { limit: 5, windowMs: 15 * MIN },
    ipCeiling: { limit: 300, windowMs: 10 * MIN },
  },
  /** Guest code checks (each code also locks after 5 wrong tries). */
  guestVerify: {
    device: { limit: 30, windowMs: 10 * MIN },
    anonymousIp: { limit: 60, windowMs: 10 * MIN },
    identity: { limit: 20, windowMs: 15 * MIN },
    ipCeiling: { limit: 300, windowMs: 10 * MIN },
  },
  /** "Email me my order links again" (each one may send several emails). */
  guestLinks: {
    device: { limit: 5, windowMs: 10 * MIN },
    anonymousIp: { limit: 15, windowMs: 10 * MIN },
    identity: { limit: 3, windowMs: 60 * MIN },
    ipCeiling: { limit: 100, windowMs: 10 * MIN },
  },
  /** Joining a waitlist (M3.10a): each join may send a code and a confirmation email. */
  waitlistJoin: {
    device: { limit: 10, windowMs: 10 * MIN },
    anonymousIp: { limit: 30, windowMs: 10 * MIN },
    identity: { limit: 10, windowMs: 60 * MIN },
    ipCeiling: { limit: 300, windowMs: 10 * MIN },
  },
  /** Starting a checkout (creates holds on inventory). */
  checkoutStart: {
    device: { limit: 20, windowMs: 10 * MIN },
    anonymousIp: { limit: 60, windowMs: 10 * MIN },
    ipCeiling: { limit: 600, windowMs: 10 * MIN },
  },
  /** Ticket-holder link actions (resend, transfer) and the holder magic link. */
  holderLink: {
    device: { limit: 10, windowMs: 10 * MIN },
    anonymousIp: { limit: 30, windowMs: 10 * MIN },
    identity: { limit: 10, windowMs: 60 * MIN },
    ipCeiling: { limit: 200, windowMs: 10 * MIN },
  },
  /** Review submissions from order pages (M1.4g); identity = the order's manage token. */
  reviewSubmit: {
    device: { limit: 5, windowMs: 10 * MIN },
    anonymousIp: { limit: 20, windowMs: 10 * MIN },
    identity: { limit: 5, windowMs: 60 * MIN },
    ipCeiling: { limit: 200, windowMs: 10 * MIN },
  },
  /** Refund requests from order pages (M3.10b); identity = the order's manage token. */
  refundRequest: {
    device: { limit: 5, windowMs: 10 * MIN },
    anonymousIp: { limit: 20, windowMs: 10 * MIN },
    identity: { limit: 5, windowMs: 60 * MIN },
    ipCeiling: { limit: 200, windowMs: 10 * MIN },
  },
  /** Reports of public reviews (M1.4g). */
  reviewReport: {
    device: { limit: 10, windowMs: 10 * MIN },
    anonymousIp: { limit: 30, windowMs: 10 * MIN },
    ipCeiling: { limit: 300, windowMs: 10 * MIN },
  },
  /** Webhook calls that fail signature verification (valid deliveries are never limited). */
  webhookAbuse: {
    device: { limit: 30, windowMs: 10 * MIN },
    anonymousIp: { limit: 30, windowMs: 10 * MIN },
    ipCeiling: { limit: 30, windowMs: 10 * MIN },
  },
  /** AI drafts (M1.4f): each one calls a paid model; credits cap the month, this caps bursts
   * (identity = member and event). */
  aiDraft: {
    device: { limit: 20, windowMs: 10 * MIN },
    anonymousIp: { limit: 20, windowMs: 10 * MIN },
    identity: { limit: 60, windowMs: 60 * MIN },
    ipCeiling: { limit: 300, windowMs: 10 * MIN },
  },
  /** Tracked-link clicks (M3.8a): over the limit, the visitor is still redirected but no click is
   * recorded (a flood must not inflate a link's figures). */
  trackedClick: {
    device: { limit: 30, windowMs: 10 * MIN },
    anonymousIp: { limit: 60, windowMs: 10 * MIN },
    ipCeiling: { limit: 600, windowMs: 10 * MIN },
  },
  /** Self-serve organization signup (M3.11a): each attempt may create an org; identity = the
   * account, so one person can't mass-create orgs from many devices. */
  openSignup: {
    device: { limit: 5, windowMs: 60 * MIN },
    anonymousIp: { limit: 5, windowMs: 60 * MIN },
    identity: { limit: 3, windowMs: 24 * 60 * MIN },
    ipCeiling: { limit: 20, windowMs: 60 * MIN },
  },
  /** CSP violation reports. */
  cspReport: {
    device: { limit: 60, windowMs: MIN },
    anonymousIp: { limit: 60, windowMs: MIN },
    ipCeiling: { limit: 300, windowMs: MIN },
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export interface RateLimitSubject {
  /** The device cookie value, when present and well-formed. */
  readonly device?: string | null;
  readonly ip?: string | null;
  /** The identity under attack, e.g. a normalized email. Hashed before it becomes a key. */
  readonly identity?: string | null;
}

export interface RateLimiter {
  check(
    policy: RateLimitPolicyName,
    subject: RateLimitSubject,
    opts?: { now?: number; scope?: string },
  ): Promise<RateLimitDecision>;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const DEVICE_COOKIE = 'yy_did';
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** A new device id for the `yy_did` cookie. */
export function newDeviceId(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export const isDeviceId = (v: string | null | undefined): v is string => !!v && DEVICE_ID.test(v);

/**
 * Count one request against every bucket its policy names and combine the results: denied if
 * any bucket is exhausted, retry after the longest wait. Store failures fail open (logged by the
 * caller's store) so an outage of the limiter never takes sign-in or checkout down.
 */
export function createRateLimiter(store: RateLimitStore, onError?: (err: unknown) => void): RateLimiter {
  return {
    async check(name, subject, opts = {}) {
      const policy: RateLimitPolicy = RATE_LIMIT_POLICIES[name];
      const now = opts.now ?? Date.now();
      const scope = opts.scope ? `${name}:${opts.scope}` : name;
      const ip = subject.ip?.trim() || 'unknown';
      const buckets: [string, RateLimitRule][] = [];
      if (isDeviceId(subject.device)) buckets.push([`${scope}:d:${subject.device}`, policy.device]);
      else buckets.push([`${scope}:a:${ip}`, policy.anonymousIp]);
      if (policy.identity && subject.identity)
        buckets.push([
          `${scope}:i:${await sha256Hex(subject.identity.trim().toLowerCase())}`,
          policy.identity,
        ]);
      // No trustworthy client IP (local runs, internal calls): no shared ceiling to count against.
      if (subject.ip?.trim()) buckets.push([`${scope}:ip:${ip}`, policy.ipCeiling]);
      let result: RateLimitDecision = {
        allowed: true,
        limit: 0,
        remaining: Number.MAX_SAFE_INTEGER,
        retryAfterMs: 0,
      };
      for (const [key, rule] of buckets) {
        let d: RateLimitDecision;
        try {
          d = await store.hit(key, rule, now);
        } catch (err) {
          onError?.(err);
          continue;
        }
        if (!d.allowed) return d;
        if (d.remaining < result.remaining) result = d;
      }
      return result.limit === 0 ? { ...result, remaining: 0 } : result;
    },
  };
}

/** Seconds for a `Retry-After` header (at least 1). */
export const retryAfterSeconds = (d: RateLimitDecision) => Math.max(1, Math.ceil(d.retryAfterMs / 1000));

/** The standard 429 response for route handlers. */
export function tooManyRequests(d: RateLimitDecision, body: Record<string, unknown> = {}): Response {
  const seconds = retryAfterSeconds(d);
  return Response.json(
    { code: 'RATE_LIMITED', retryAfter: seconds, ...body },
    {
      status: 429,
      headers: {
        'retry-after': String(seconds),
        'ratelimit-limit': String(d.limit),
        'ratelimit-remaining': '0',
        'cache-control': 'no-store',
      },
    },
  );
}
