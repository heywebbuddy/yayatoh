import {
  type FrontDoorConfig,
  forwardRequestHeaders,
  forwardResponseHeaders,
} from '@yayatoh/platform/front-door';
import type { NextRequest } from 'next/server';

export interface Forwarded {
  /** The legacy response (streamed), or null when legacy could not be reached in time. */
  readonly response: Response | null;
  readonly status: number;
  /** Time to the legacy response's headers. */
  readonly latencyMs: number;
  /** `timeout` (504) or `unreachable` (502) when the front door has to answer itself. */
  readonly failure: 'timeout' | 'unreachable' | null;
}

const NO_BODY = new Set([101, 204, 205, 304]);

/** The client IP as the hosting edge reports it (Vercel sets `x-real-ip` / `x-forwarded-for`). */
export function edgeClientIp(h: Headers): string | null {
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

/**
 * Forward one request to a legacy origin (M2.4a, ADR 0020) and stream the answer back: same
 * method, body and headers (hop-by-hop, the new app's cookies and client-set proxy headers
 * removed; `X-Forwarded-*` and the origin secret added), redirects not followed (their Location is
 * put back on the public host), `Set-Cookie` scoped to the exact public host. Only the wait for the
 * response's headers is bounded (`timeoutMs`); the body then streams for as long as it takes.
 * Bodies are buffered here, so callers send only bodies up to `maxBufferedBody` (larger ones take
 * the platform rewrite, see proxy.ts).
 */
export async function forwardToLegacy(
  req: NextRequest,
  target: { origin: string; pathAndQuery: string; host: string },
  config: FrontDoorConfig,
): Promise<Forwarded> {
  const proto = req.nextUrl.protocol === 'https:' ? 'https' : 'http';
  const hostHeader = req.headers.get('host') ?? target.host;
  const headers = forwardRequestHeaders(req.headers, {
    host: target.host,
    hostHeader,
    proto,
    clientIp: edgeClientIp(req.headers),
    secret: config.secret,
  });
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.arrayBuffer() : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = performance.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${target.origin}${target.pathAndQuery}`, {
      method: req.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    const timedOut = controller.signal.aborted;
    return {
      response: null,
      status: timedOut ? 504 : 502,
      latencyMs: performance.now() - started,
      failure: timedOut ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = performance.now() - started;
  const out = forwardResponseHeaders(upstream.headers, {
    origin: target.origin,
    publicOrigin: `${proto}://${hostHeader}`,
    // fetch decodes gzip/br/deflate bodies itself.
    decoded: upstream.headers.has('content-encoding'),
  });
  out.set('x-front-door', 'legacy');
  const noBody = req.method === 'HEAD' || NO_BODY.has(upstream.status);
  if (noBody) await upstream.body?.cancel().catch(() => {});
  return {
    response: new Response(noBody ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    }),
    status: upstream.status,
    latencyMs,
    failure: null,
  };
}
