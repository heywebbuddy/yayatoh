/**
 * Host classes (roadmap §3.2, §4.2). Pure: proxy.ts, route handlers and pages share it.
 * - `marketplace`: yayatoh.com (+ www) and `yayatoh.localhost` for local testing.
 * - `app`: the organizer dashboard host (app.yayatoh.com); never indexed.
 * - `dev`: localhost and preview deployments: marketplace and dashboard together, never indexed.
 * - `tenant`: anything else; the proxy resolves it through `org_domains` or answers 404.
 */
export type HostKind = 'marketplace' | 'app' | 'dev' | 'tenant';

const list = (v: string | undefined, fallback: string) =>
  (v ?? fallback)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function marketplaceHosts(env: Record<string, string | undefined> = process.env): string[] {
  return list(env.MARKETPLACE_HOSTS, 'yayatoh.com,www.yayatoh.com,yayatoh.localhost');
}
export function appHosts(env: Record<string, string | undefined> = process.env): string[] {
  return list(env.APP_HOSTS, 'app.yayatoh.com');
}

/** The Host header without port, lowercased, without a trailing dot. */
export function bareHost(hostHeader: string | null | undefined): string {
  const h = (hostHeader ?? '').trim().toLowerCase();
  const noPort = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.replace(/:\d+$/, '');
  return noPort.replace(/\.$/, '');
}

export function classifyHost(host: string, env: Record<string, string | undefined> = process.env): HostKind {
  if (marketplaceHosts(env).includes(host)) return 'marketplace';
  if (appHosts(env).includes(host)) return 'app';
  if (
    host === '' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.vercel.app')
  )
    return 'dev';
  return 'tenant';
}

/** The canonical marketplace host (the first configured one, yayatoh.com in production). */
export const apexHost = (env: Record<string, string | undefined> = process.env) =>
  marketplaceHosts(env)[0] ?? 'yayatoh.com';

export interface RequestOrigin {
  readonly protocol: 'http:' | 'https:';
  readonly host: string;
  /** Non-default port of the request ('' in production). */
  readonly port: string;
}

/** An absolute origin for a host, reusing the request's scheme and port (so local ports work). */
export function originFor(req: RequestOrigin, host: string): string {
  return `${req.protocol}//${host}${req.port ? `:${req.port}` : ''}`;
}

/** Hosts whose pages may be indexed. Dashboards, previews and localhost never are. */
export const indexable = (kind: HostKind) => kind === 'marketplace' || kind === 'tenant';

/**
 * Whether a session may be used on this request's host (M1.2d: "a tenant cookie is valid only on
 * its host"). A session bound to a host (`host:port` outside production) works there only; an
 * unbound one (API clients, sessions from before M1.2d) never works on a tenant host.
 */
export function sessionHostAccepted(
  sessionHost: string | null | undefined,
  requestHost: string | null,
  kind: HostKind,
): boolean {
  if (sessionHost) return sessionHost === requestHost;
  return kind !== 'tenant';
}

export interface TenantReturn {
  /** `https://tickets.example.com` (with the port outside production). */
  readonly origin: string;
  /** The host a handoff code is bound to: hostname plus port when there is one. */
  readonly host: string;
  readonly hostname: string;
  /** Path and query to land on there. */
  readonly path: string;
}

/**
 * A tenant site's "come back here" URL, as the app host's sign-in receives it (M1.2d). Only a
 * tenant host qualifies (never the app, the marketplace or a preview), with the app's own scheme
 * (https in production) and port; no credentials. Whether the host is one of an org's verified
 * hosts is checked by the caller (`resolveHost`).
 */
export function parseTenantReturn(
  raw: string | null | undefined,
  appOrigin: string,
  env: Record<string, string | undefined> = process.env,
): TenantReturn | null {
  if (!raw || raw.length > 2048) return null;
  let url: URL;
  let app: URL;
  try {
    url = new URL(raw);
    app = new URL(appOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== app.protocol || url.username || url.password) return null;
  if (url.port !== app.port) return null;
  const hostname = bareHost(url.hostname);
  if (!hostname || classifyHost(hostname, env) !== 'tenant') return null;
  const host = url.port ? `${hostname}:${url.port}` : hostname;
  return { origin: `${url.protocol}//${host}`, host, hostname, path: `${url.pathname}${url.search}` };
}
