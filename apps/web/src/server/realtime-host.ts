import 'server-only';
import { resolveHost } from '@yayatoh/tenancy';
import { bareHost, classifyHost } from '@/lib/hosts.ts';

/**
 * Which org a realtime URL on this host may serve: `'any'` on the platform's own hosts (the
 * channel name decides and the caller is checked against it), the site's org on a tenant host,
 * or null for an unknown host. The Host only ever narrows what a request may reach; it never
 * grants an org (the proxy resolves tenant pages the same way).
 */
export async function realtimeHostOrg(req: Request): Promise<{ orgId: string } | 'any' | null> {
  const host = bareHost(req.headers.get('host'));
  if (classifyHost(host) !== 'tenant') return 'any';
  const site = await resolveHost(host);
  return site ? { orgId: site.orgId } : null;
}
