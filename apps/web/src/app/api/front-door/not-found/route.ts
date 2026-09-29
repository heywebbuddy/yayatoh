import { frontDoorFlags, recordFrontDoor } from '@yayatoh/platform';
import { CANARY_COOKIE, decideFrontDoor, frontDoorConfig, LEGACY_COOKIE } from '@yayatoh/platform/front-door';
import type { NextRequest } from 'next/server';
import { flushInterval } from '@/lib/front-door/constants.ts';
import { FrontDoorMeter } from '@/lib/front-door/meter.ts';
import { bareHost } from '@/lib/hosts.ts';

const meter = new FrontDoorMeter(recordFrontDoor, flushInterval());
const idle = setInterval(() => void meter.maybeFlush(), 1_000);
(idle as { unref?: () => void }).unref?.();

/**
 * A new-app 404 on a front-door host (M2.4a), reported by the not-found page's beacon. Counted
 * only when the host is a front-door host and the new app serves that path there (so a 404 that
 * legacy served, or a made-up host, is never added). Always 204.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const done = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  const host = bareHost(req.headers.get('host'));
  const site = frontDoorConfig().hosts.get(host);
  if (!site) return done;
  let path: unknown;
  try {
    path = ((await req.json()) as { path?: unknown }).path;
  } catch {
    return done;
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 300) return done;
  let decision: ReturnType<typeof decideFrontDoor>;
  try {
    decision = decideFrontDoor({
      instance: site.instance,
      host,
      path,
      query: new URLSearchParams(),
      flags: await frontDoorFlags(),
      overrides: {
        canary: req.cookies.get(CANARY_COOKIE)?.value === 'next',
        legacy: req.cookies.get(LEGACY_COOKIE)?.value === '1',
      },
    });
  } catch {
    return done;
  }
  if (decision.owner !== 'next') return done;
  meter.notFound(host, decision.route, path);
  await meter.maybeFlush();
  return done;
}
