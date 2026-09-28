import 'server-only';
import { DEFAULT_LOCALE } from '@yayatoh/contracts';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import {
  CLICK_COOKIE,
  CLICK_COOKIE_MAX_AGE_S,
  destinationProblem,
  isLikelyBot,
  recordClickCommand,
  redirectTarget,
  resolveTrackedLink,
  signClickId,
} from '@yayatoh/marketing';
import { appTokenSecret } from '@yayatoh/platform';
import { DEVICE_COOKIE, isDeviceId } from '@yayatoh/platform/security';
import { ports } from './ports.ts';
import { clientIp, limitRequest } from './rate-limit.ts';

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/**
 * The tracked-link redirector (M3.8a), `/r/{code}` on the marketplace and on tenant hosts. The org
 * comes from the link (on a tenant host it must be the host's org, else 404). Humans get a click
 * row and a signed click id (URL `yyc` + the short-lived `yy_click` cookie); bots, HEAD requests
 * and rate-limited floods are redirected without either. Always a 302 with `no-store`, to a path
 * on this same host (open-redirect proof).
 */
export async function trackedRedirect(
  req: Request,
  code: string,
  locale: string,
  hostOrgId: string | null,
): Promise<Response> {
  const target = await resolveTrackedLink(code);
  if (!target || (hostOrgId !== null && target.orgId !== hostOrgId)) return notFound();
  const path = target.destinationPath ?? `/events/${target.slug}`;
  if (destinationProblem(path)) return notFound();

  let token: string | null = null;
  const human = req.method === 'GET' && !isLikelyBot(req.headers.get('user-agent'));
  if (human) {
    const limit = await limitRequest(req, 'trackedClick');
    if (limit.allowed) {
      const device = cookieValue(req, DEVICE_COOKIE);
      try {
        const { clickId } = await executeCommand(
          recordClickCommand,
          {
            linkId: target.linkId,
            deviceId: isDeviceId(device) ? device : null,
            ip: clientIp(req.headers),
          },
          createCtx({ orgId: target.orgId, actor: { type: 'anonymous' } }),
          ports,
        );
        token = signClickId(clickId, appTokenSecret());
      } catch (err) {
        // Tracking never blocks the visitor (e.g. the org lost the marketing module).
        console.error(JSON.stringify({ trackedLink: 'click_not_recorded', message: String(err) }));
      }
    }
  }

  const url = new URL(req.url);
  const location = redirectTarget({
    origin: url.origin,
    localePrefix: locale === DEFAULT_LOCALE ? '' : `/${locale}`,
    path,
    utm: target.utm,
    incoming: url.searchParams,
    clickToken: token,
  });
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  });
  if (token) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    headers.append(
      'Set-Cookie',
      `${CLICK_COOKIE}=${token}; Path=/; Max-Age=${CLICK_COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`,
    );
  }
  return new Response(null, { status: 302, headers });
}
