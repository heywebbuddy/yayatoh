import 'server-only';
import { headers } from 'next/headers';
import { bareHost, classifyHost, type HostKind, type RequestOrigin } from '@/lib/hosts.ts';

export interface RequestHost extends RequestOrigin {
  readonly kind: HostKind;
  /** This request's absolute origin. */
  readonly origin: string;
}

/**
 * The request's host and origin (for canonical URLs, absolute og:image and JSON-LD). The host
 * decides the host class only; the tenant itself always comes from the route's org param.
 */
export async function requestHost(): Promise<RequestHost> {
  const h = await headers();
  // The Host header, as proxy.ts sees it (x-forwarded-host is client-controlled when self-hosted).
  const raw = h.get('host') ?? 'localhost';
  const host = bareHost(raw);
  const port = /:(\d+)$/.exec(raw.split(',')[0]?.trim() ?? '')?.[1] ?? '';
  const proto = (
    h.get('x-forwarded-proto') ?? (host === 'localhost' || host.endsWith('.localhost') ? 'http' : 'https')
  )
    .split(',')[0]
    ?.trim();
  const protocol = proto === 'http' ? 'http:' : 'https:';
  const defaultPort = (protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443');
  const p = defaultPort ? '' : port;
  return {
    kind: classifyHost(host),
    host,
    protocol,
    port: p,
    origin: `${protocol}//${host}${p ? `:${p}` : ''}`,
  };
}
