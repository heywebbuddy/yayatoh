import 'server-only';
import { resolveHost } from '@yayatoh/tenancy';
import { bareHost, classifyHost, type HostKind } from '@/lib/hosts.ts';

export type HostSite =
  | { readonly kind: Exclude<HostKind, 'tenant'>; readonly host: string }
  | {
      readonly kind: 'tenant';
      readonly host: string;
      readonly orgId: string;
      readonly primaryHost: string | null;
    };

/**
 * The site a request's Host serves, for route handlers outside the proxy's matcher (robots.txt,
 * sitemaps). Tenant hosts resolve through `org_domains`; an unknown host is null (404).
 */
export async function hostSite(req: Request): Promise<HostSite | null> {
  const host = bareHost(req.headers.get('host'));
  const kind = classifyHost(host);
  if (kind !== 'tenant') return { kind, host };
  const site = await resolveHost(host);
  return site ? { kind, host, orgId: site.orgId, primaryHost: site.primaryHost } : null;
}

/** This request's origin (scheme from x-forwarded-proto as set by the platform, host with port). */
export function originOf(req: Request): string {
  const url = new URL(req.url);
  const hostHeader = req.headers.get('host') ?? url.host;
  const proto = (req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')).split(',')[0]?.trim();
  return `${proto === 'https' ? 'https' : 'http'}://${hostHeader}`;
}

/** A 308 to the same path on the primary host (non-primary tenant hosts, roadmap §4.2). */
export function toPrimary(req: Request, primaryHost: string): Response {
  const url = new URL(req.url);
  const to = new URL(originOf(req));
  to.hostname = primaryHost;
  return Response.redirect(`${to.origin}${url.pathname}${url.search}`, 308);
}
