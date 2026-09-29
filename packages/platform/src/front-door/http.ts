import type { FrontDoorInstance } from './routes.ts';

/**
 * Front-door forwarding rules (M2.4a, ADR 0020): which hosts forward to which legacy origin, and
 * what crosses the boundary in each direction. Pure and runtime-agnostic (proxy.ts and tests).
 */

export interface FrontDoorOrigin {
  readonly instance: FrontDoorInstance;
  /** `https://origin-yay.yayatoh.com` (no path). */
  readonly origin: string;
}

export interface FrontDoorConfig {
  /** Public host (lowercase, no port) → its instance and legacy origin. */
  readonly hosts: ReadonlyMap<string, FrontDoorOrigin>;
  /** Sent as `x-yayatoh-front-door` so the legacy nginx accepts only us (roadmap §7.4). */
  readonly secret: string | null;
  /** Time to the legacy response's headers; the body then streams without a limit. */
  readonly timeoutMs: number;
  /**
   * The largest request body forwarded (`FRONT_DOOR_MAX_BODY`, default 64 MiB). The runtime
   * buffers bodies for proxy.ts up to this size (next.config.ts `proxyClientMaxBodySize`).
   */
  readonly maxBody: number;
}

type Env = Record<string, string | undefined>;
const list = (v: string | undefined, fallback: string) =>
  (v ?? fallback)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** An http(s) origin without credentials, path or query; anything else is ignored (front door off). */
export function parseOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== ''))
      return null;
    return u.origin;
  } catch {
    return null;
  }
}

const num = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
};

/** `FRONT_DOOR_MAX_BODY` in bytes (1 MiB to 256 MiB; default 64 MiB). */
export function frontDoorMaxBody(env: Env = process.env): number {
  return num(env.FRONT_DOOR_MAX_BODY, 64 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024);
}

/**
 * The front door is on for an instance only when its origin is configured:
 * - `LEGACY_ORIGIN_URL` for the yayatoh.com instance, hosts `LEGACY_YAY_HOSTS`
 *   (default `yayatoh.com,www.yayatoh.com`);
 * - `LEGACY_ABC_ORIGIN_URL` for abc, hosts `LEGACY_ABC_HOSTS` (default `abc.yayatoh.com`).
 * With neither set (development, CI, every tenant-only deployment) nothing changes.
 */
export function frontDoorConfig(env: Env = process.env): FrontDoorConfig {
  const hosts = new Map<string, FrontDoorOrigin>();
  const yay = parseOrigin(env.LEGACY_ORIGIN_URL);
  const abc = parseOrigin(env.LEGACY_ABC_ORIGIN_URL);
  if (yay)
    for (const h of list(env.LEGACY_YAY_HOSTS, 'yayatoh.com,www.yayatoh.com'))
      hosts.set(h, { instance: 'yay', origin: yay });
  if (abc)
    for (const h of list(env.LEGACY_ABC_HOSTS, 'abc.yayatoh.com'))
      if (!hosts.has(h)) hosts.set(h, { instance: 'abc', origin: abc });
  return {
    hosts,
    secret: env.LEGACY_ORIGIN_SECRET?.trim() || null,
    timeoutMs: num(env.FRONT_DOOR_TIMEOUT_MS, 170_000, 100, 800_000),
    maxBody: frontDoorMaxBody(env),
  };
}

/** Every configured legacy host with its instance, whether or not its origin is set (console). */
export function frontDoorHostList(
  env: Env = process.env,
): { host: string; instance: FrontDoorInstance; configured: boolean }[] {
  const yay = parseOrigin(env.LEGACY_ORIGIN_URL) !== null;
  const abc = parseOrigin(env.LEGACY_ABC_ORIGIN_URL) !== null;
  return [
    ...list(env.LEGACY_YAY_HOSTS, 'yayatoh.com,www.yayatoh.com').map((host) => ({
      host,
      instance: 'yay' as const,
      configured: yay,
    })),
    ...list(env.LEGACY_ABC_HOSTS, 'abc.yayatoh.com').map((host) => ({
      host,
      instance: 'abc' as const,
      configured: abc,
    })),
  ];
}

/**
 * RFC 9110 §7.6.1 connection-specific headers, plus framing the runtime recomputes and `expect`
 * (100-continue is between the client and us; the body has already arrived).
 */
const HOP_BY_HOP = new Set([
  'expect',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

/** Headers a client must never be able to set on the way to legacy (we set our own). */
const CLIENT_CONTROLLED =
  /^(x-forwarded-|x-real-ip$|forwarded$|x-yayatoh-|x-middleware-|x-nonce$|x-front-door)/;

/** The new app's cookies: `__Host-…`, `yy.…`/`yy-…`/`yy_…` and the locale. Legacy never sees them. */
export function isNewAppCookie(name: string): boolean {
  return /^(__Host-|__Secure-yy)|^yy[._-]|^NEXT_LOCALE$/.test(name);
}

/** The request's Cookie header without the new app's cookies (null when nothing is left). */
export function legacyCookieHeader(cookie: string | null): string | null {
  if (!cookie) return null;
  const kept = cookie
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c && !isNewAppCookie(c.split('=', 1)[0]?.trim() ?? ''));
  return kept.length ? kept.join('; ') : null;
}

export interface ForwardContext {
  /** The public host the client asked for (no port). */
  readonly host: string;
  /** `host[:port]` as the client sent it. */
  readonly hostHeader: string;
  readonly proto: 'http' | 'https';
  /** The client IP as the hosting edge reports it, if any. */
  readonly clientIp: string | null;
  readonly secret: string | null;
}

/** Request headers for the legacy origin: hop-by-hop and client-set proxy headers removed. */
export function forwardRequestHeaders(incoming: Headers, ctx: ForwardContext): Headers {
  const connectionListed = new Set(
    (incoming.get('connection') ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const out = new Headers();
  for (const [k, v] of incoming) {
    const name = k.toLowerCase();
    if (HOP_BY_HOP.has(name) || connectionListed.has(name) || CLIENT_CONTROLLED.test(name)) continue;
    if (name === 'cookie') continue;
    out.append(name, v);
  }
  const cookie = legacyCookieHeader(incoming.get('cookie'));
  if (cookie) out.set('cookie', cookie);
  // The runtime decompresses what it fetches; ask for what it can decode.
  out.set('accept-encoding', 'gzip, deflate, br');
  out.set('x-forwarded-host', ctx.hostHeader);
  out.set('x-forwarded-proto', ctx.proto);
  if (ctx.clientIp) {
    out.set('x-forwarded-for', ctx.clientIp);
    out.set('x-real-ip', ctx.clientIp);
  }
  if (ctx.secret) out.set('x-yayatoh-front-door', ctx.secret);
  return out;
}

/**
 * One legacy `Set-Cookie`, made safe for the public host: the `Domain` attribute is dropped (the
 * cookie stays on the exact host that answered, so a yayatoh.com cookie never reaches
 * abc.yayatoh.com or app.yayatoh.com), and a cookie named like one of the new app's is refused.
 */
export function scopeSetCookie(raw: string): string | null {
  const [pair = '', ...attrs] = raw.split(';');
  const name = pair.split('=', 1)[0]?.trim() ?? '';
  if (!name || isNewAppCookie(name)) return null;
  const kept = attrs.map((a) => a.trim()).filter((a) => a && !/^domain\s*=/i.test(a));
  return [pair.trim(), ...kept].join('; ');
}

/** A legacy redirect to its own origin points at the public host instead. */
export function publicLocation(location: string, origin: string, publicOrigin: string): string {
  try {
    const u = new URL(location, origin);
    if (u.origin !== origin) return location;
    return `${publicOrigin}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return location;
  }
}

/** Response headers to pass back: hop-by-hop dropped, cookies scoped, redirects made public. */
export function forwardResponseHeaders(
  upstream: Headers,
  opts: { origin: string; publicOrigin: string; decoded: boolean },
): Headers {
  const out = new Headers();
  for (const [k, v] of upstream) {
    const name = k.toLowerCase();
    if (HOP_BY_HOP.has(name) || name === 'set-cookie') continue;
    // The body was decompressed on the way in: its encoding and length no longer apply.
    if (opts.decoded && name === 'content-encoding') continue;
    if (name === 'location') {
      out.set('location', publicLocation(v, opts.origin, opts.publicOrigin));
      continue;
    }
    out.append(name, v);
  }
  for (const c of upstream.getSetCookie()) {
    const scoped = scopeSetCookie(c);
    if (scoped) out.append('set-cookie', scoped);
  }
  return out;
}
