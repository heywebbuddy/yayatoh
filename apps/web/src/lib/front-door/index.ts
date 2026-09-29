import { matchLegacyRedirect } from '@yayatoh/marketplace';
import { frontDoorFlags, recordFrontDoor } from '@yayatoh/platform';
import {
  CANARY_COOKIE,
  decideFrontDoor,
  type FlagStates,
  type FrontDoorConfig,
  type FrontDoorDecision,
  forwardRequestHeaders,
  frontDoorConfig,
  LEGACY_COOKIE,
  stripFrontDoorLocale,
} from '@yayatoh/platform/front-door';
import { resolveHost } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { bareHost, classifyHost } from '../hosts.ts';
import { TtlCache } from '../ttl-cache.ts';
import { flushInterval } from './constants.ts';
import { forwardToLegacy } from './forward.ts';
import { FrontDoorMeter } from './meter.ts';

/**
 * The coexistence front door (M2.4a, roadmap §7.4, ADR 0020), run first by proxy.ts. On a legacy
 * host with a configured origin it decides who serves the request (the versioned route table and
 * its per-host flags) and either forwards it to legacy, answers a legacy URL with a single-hop
 * redirect to its new shape, or lets the new app serve it. Elsewhere it does nothing.
 */

export { FRONT_DOOR_ROUTE_HEADER } from './constants.ts';

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

let config: FrontDoorConfig | undefined;
const getConfig = () => {
  config ??= frontDoorConfig();
  return config;
};
const flagCache = new TtlCache<FlagStates>(1, num(process.env.FRONT_DOOR_FLAG_TTL_MS, 5_000));
const hostCache = new TtlCache<boolean>(100, 30_000);
const redirectCache = new TtlCache<{ location: string; status: number } | null>(5000, 60_000);

export const frontDoorMeter = new FrontDoorMeter(recordFrontDoor, flushInterval());
// A quiet server still flushes what it counted.
const idle = setInterval(() => void frontDoorMeter.maybeFlush(), 1_000);
(idle as { unref?: () => void }).unref?.();

async function flags(): Promise<FlagStates> {
  const hit = flagCache.get('all');
  if (hit) return hit;
  try {
    const f = await frontDoorFlags();
    flagCache.set('all', f);
    return f;
  } catch (err) {
    // No flags means legacy for every moved route: the safe side.
    console.error('front door: flags unavailable', err);
    return new Map();
  }
}

/** A tenant-kind legacy host (abc) that is not attached to an org yet stays on legacy. */
async function attached(host: string): Promise<boolean> {
  let ok = hostCache.get(host);
  if (ok === undefined) {
    ok = (await resolveHost(host)) !== null;
    hostCache.set(host, ok);
  }
  return ok;
}

export type FrontDoorOutcome =
  /** Not a front-door host: the proxy carries on as before. */
  | null
  /** The front door answered (legacy's response, a redirect, or a rewrite to legacy). */
  | { readonly kind: 'response'; readonly response: Response }
  /** The new app serves it: the proxy carries on, without the legacy-redirect lookup. */
  | { readonly kind: 'next'; readonly route: string };

function cookiesOf(req: NextRequest) {
  return {
    canary: req.cookies.get(CANARY_COOKIE)?.value === 'next',
    legacy: req.cookies.get(LEGACY_COOKIE)?.value === '1',
  };
}

async function decide(req: NextRequest, host: string, instance: 'yay' | 'abc', path: string) {
  return decideFrontDoor({
    instance,
    host,
    path,
    query: req.nextUrl.searchParams,
    flags: await flags(),
    overrides: cookiesOf(req),
  });
}

/** Whether a target path on this host is served by the new app (a redirect may only go there). */
async function servedByNext(req: NextRequest, host: string, instance: 'yay' | 'abc', target: string) {
  const u = new URL(target, 'http://x');
  const d = decideFrontDoor({
    instance,
    host,
    path: u.pathname,
    query: u.searchParams,
    flags: await flags(),
    overrides: cookiesOf(req),
  });
  return d.owner === 'next';
}

export async function frontDoor(
  req: NextRequest,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<FrontDoorOutcome> {
  const cfg = getConfig();
  if (!cfg.hosts.size) return null;
  const host = bareHost(req.headers.get('host'));
  const site = cfg.hosts.get(host);
  if (!site) return null;
  const path = req.nextUrl.pathname;
  const method = req.method;
  const flush = () => {
    const p = frontDoorMeter.maybeFlush();
    if (p) waitUntil(p);
  };

  let decision: FrontDoorDecision = await decide(req, host, site.instance, path);

  // A legacy URL shape with a new home (roadmap §7.7): one hop, straight to the final URL, but
  // only once that URL is served here. Until then legacy keeps answering its own URL.
  if (decision.owner === 'legacy' && (method === 'GET' || method === 'HEAD')) {
    const key = `${host}|${path}`;
    let hit = redirectCache.get(key);
    if (hit === undefined) {
      hit = await matchLegacyRedirect(host, path);
      redirectCache.set(key, hit);
    }
    if (
      hit &&
      (/^https:\/\//.test(hit.location) || (await servedByNext(req, host, site.instance, hit.location)))
    ) {
      const target = new URL(hit.location, `${req.nextUrl.protocol}//${req.headers.get('host') ?? host}`);
      for (const [k, v] of req.nextUrl.searchParams)
        if (!target.searchParams.has(k)) target.searchParams.set(k, v);
      frontDoorMeter.record({ host, route: decision.route, servedBy: 'next', status: hit.status });
      flush();
      const res = NextResponse.redirect(target, hit.status);
      res.headers.set('x-front-door', 'next');
      return { kind: 'response', response: res };
    }
  }

  // An attached-later tenant host (abc before B-A) can't be served here yet.
  if (decision.owner === 'next' && decision.reason !== 'platform' && classifyHost(host) === 'tenant')
    if (!(await attached(host))) decision = { owner: 'legacy', route: decision.route, reason: 'flag' };

  if (decision.owner === 'next') {
    frontDoorMeter.record({ host, route: decision.route, servedBy: 'next' });
    flush();
    return { kind: 'next', route: decision.route };
  }

  // Legacy has no locale prefixes: `/ar/events/x` is `/events/x` there.
  const forwardPath = stripFrontDoorLocale(path).locale ? stripFrontDoorLocale(path).rest : path;
  const pathAndQuery = `${forwardPath}${req.nextUrl.search}`;
  const f = await forwardToLegacy(req, { origin: site.origin, pathAndQuery, host }, cfg);
  frontDoorMeter.record({
    host,
    route: decision.route,
    servedBy: 'legacy',
    status: f.status,
    proxyError: f.failure !== null,
    latencyMs: f.latencyMs,
    path,
  });
  flush();
  if (f.response) return { kind: 'response', response: f.response };
  if (f.failure === 'too_large')
    return {
      kind: 'response',
      response: new Response(null, {
        status: 413,
        headers: { 'x-front-door': 'legacy', 'cache-control': 'no-store' },
      }),
    };
  // Legacy is down or too slow: a localized error page from the new app, with 502/504.
  const locale = stripFrontDoorLocale(path).locale ?? req.cookies.get('NEXT_LOCALE')?.value ?? 'en';
  const safeLocale = /^[a-zA-Z-]{2,5}$/.test(locale) ? locale : 'en';
  const res = NextResponse.rewrite(new URL(`/api/front-door/unavailable/${f.status}/${safeLocale}`, req.url));
  res.headers.set('x-front-door', 'legacy');
  return { kind: 'response', response: res };
}
