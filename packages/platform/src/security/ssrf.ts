import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { DomainError } from '@yayatoh/kernel';

/**
 * SSRF guard (roadmap §10, M1.14a) for every server-side fetch of a URL a user or organizer
 * supplied: custom-domain checks, outbound webhooks, remote images.
 *
 * - https (and optionally http) only; no credentials in the URL; ports 443/80 unless allowed.
 * - Every address the name resolves to must be public unicast: private, loopback, link-local,
 *   CGNAT, multicast, documentation, benchmarking, and IPv6 ULA/link-local/NAT64/6to4/Teredo
 *   and IPv4-mapped forms of those are refused.
 * - DNS rebinding: the name is resolved once, checked, and the connection is pinned to that
 *   address (the socket's `lookup` returns it), so a second resolution can't swap in 127.0.0.1.
 * - Redirects are followed by hand (at most 3) and every hop is checked again.
 * - Time and size limits on the response.
 */

export type ResolvedAddress = { readonly address: string; readonly family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export const defaultResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

export interface SsrfPolicy {
  /** Allow plain http (e.g. ACME http-01 style checks). Default: https only. */
  readonly allowHttp?: boolean;
  readonly allowedPorts?: readonly number[];
  readonly resolver?: Resolver;
}

const refuse = (reason: string): never => {
  throw new DomainError('validation_failed', `URL not allowed: ${reason}`);
};

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

const V4_BLOCKED: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isBlockedIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return true;
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (v4ToInt(base) & mask) >>> 0;
  });
}

/** Expand an IPv6 address to 8 groups (handles `::` and a trailing dotted IPv4). */
export function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const tail: number[] = [];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1]) {
    if (isIP(dotted[1]) !== 4) return null;
    const n = v4ToInt(dotted[1]);
    tail.push(Math.floor(n / 65536), n % 65536);
    s = s.slice(0, -dotted[1].length);
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const [head = '', rest] = s.split('::');
  if (s.split('::').length > 2) return null;
  const parse = (part: string) => (part ? part.split(':').map((g) => Number.parseInt(g, 16)) : []);
  const a = parse(head);
  const b = rest === undefined ? [] : parse(rest);
  const fill = 8 - a.length - b.length - tail.length;
  if (rest === undefined && fill !== 0) return null;
  if (fill < 0) return null;
  const groups = [...a, ...Array(rest === undefined ? 0 : fill).fill(0), ...b, ...tail];
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

export function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, , g5 = 0, g6 = 0, g7 = 0] = g;
  const embedded4 = () => `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8)) return true; // ::
  if (zeroTo(7) && g7 === 1) return true; // ::1
  if (zeroTo(5) && g5 === 0xffff) return isBlockedIPv4(embedded4()); // ::ffff:a.b.c.d
  if (zeroTo(6)) return true; // deprecated IPv4-compatible ::a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b) return true; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard 100::/64
  if (g0 === 0x2001 && g1 < 0x0200) return true; // 2001::/23 IETF (Teredo 2001::/32, ORCHID…)
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return true; // 6to4
  if (g0 === 0x3fff && g1 < 0x1000) return true; // documentation 3fff::/20
  if ((g0 & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isBlockedIPv4(ip);
  if (v === 6) return isBlockedIPv6(ip);
  return true;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|intranet|lan)$/i;

/** Check a URL and resolve it; returns the addresses to connect to (all public). */
export async function assertPublicUrl(
  raw: string | URL,
  policy: SsrfPolicy = {},
): Promise<{ url: URL; addresses: readonly ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    return refuse('malformed');
  }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) refuse('scheme');
  if (url.username || url.password) refuse('credentials');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const ports = policy.allowedPorts ?? [443, 80];
  if (!ports.includes(port)) refuse('port');
  // WHATWG URL already normalizes 0x7f.1, 2130706433 and friends to dotted IPv4.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_NAMES.test(host.replace(/\.$/, ''))) refuse('host');
  if (isIP(host)) {
    if (isBlockedAddress(host)) refuse('address');
    return { url, addresses: [{ address: host, family: isIP(host) === 6 ? 6 : 4 }] };
  }
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await (policy.resolver ?? defaultResolver)(host);
  } catch {
    return refuse('dns');
  }
  if (addresses.length === 0) refuse('dns');
  // Any private answer poisons the name: an attacker can't win by racing the order.
  if (addresses.some((a) => isBlockedAddress(a.address))) refuse('address');
  return { url, addresses };
}

export interface SafeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly url: string;
}

export interface TransportRequest {
  readonly url: URL;
  /** The checked address the socket must use (pinned). */
  readonly address: ResolvedAddress;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export type Transport = (req: TransportRequest) => Promise<Omit<SafeResponse, 'url'>>;

/** The `lookup` a pinned socket uses: always the checked address, whatever DNS says now. */
export function pinnedLookup(address: ResolvedAddress) {
  return (
    _host: string,
    opts: unknown,
    cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
  ) => {
    if ((opts as { all?: boolean } | null)?.all)
      cb(null, [{ address: address.address, family: address.family }]);
    else cb(null, address.address, address.family);
  };
}

/** node:http(s) with the pinned lookup; SNI and Host stay the original name. */
export const nodeTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    const mod = req.url.protocol === 'https:' ? https : http;
    const r = mod.request(
      req.url,
      {
        method: req.method,
        headers: req.headers,
        lookup: pinnedLookup(req.address) as never,
        timeout: req.timeoutMs,
        servername: req.url.hostname.replace(/^\[|\]$/g, ''),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > req.maxBytes) {
            res.destroy();
            reject(new DomainError('validation_failed', 'Response too large'));
          } else chunks.push(c);
        });
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') headers[k] = v;
          resolve({ status: res.statusCode ?? 0, headers, body: new Uint8Array(Buffer.concat(chunks)) });
        });
        res.on('error', reject);
      },
    );
    r.on('timeout', () => r.destroy(new DomainError('validation_failed', 'Timed out')));
    r.on('error', reject);
    if (req.body) r.write(req.body);
    r.end();
  });

/**
 * Fetch a user-supplied URL safely. Throws `validation_failed` for anything the guard refuses.
 */
export async function safeFetch(
  raw: string | URL,
  opts: SsrfPolicy & {
    method?: 'GET' | 'HEAD' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    maxRedirects?: number;
    timeoutMs?: number;
    maxBytes?: number;
    transport?: Transport;
  } = {},
): Promise<SafeResponse> {
  const transport = opts.transport ?? nodeTransport;
  const maxRedirects = opts.maxRedirects ?? 3;
  let target: string | URL = raw;
  let method = opts.method ?? 'GET';
  let body = opts.body;
  let headers = { 'user-agent': 'Yayatoh/2.0 (+https://yayatoh.com)', ...opts.headers };
  let origin: string | null = null;
  for (let hop = 0; ; hop++) {
    const { url, addresses } = await assertPublicUrl(target, opts);
    const address = addresses[0] as ResolvedAddress;
    // Credentials never follow a redirect to another origin.
    if (origin !== null && url.origin !== origin)
      headers = Object.fromEntries(
        Object.entries(headers).filter(([k]) => !['authorization', 'cookie'].includes(k.toLowerCase())),
      ) as typeof headers;
    origin = url.origin;
    const res = await transport({
      url,
      address,
      method,
      headers,
      body,
      timeoutMs: opts.timeoutMs ?? 5_000,
      maxBytes: opts.maxBytes ?? 1_048_576,
    });
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) refuse('too many redirects');
      target = new URL(location, url);
      // 303 (and 301/302 for POST, like browsers) turn into GET without a body.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    return { ...res, url: url.toString() };
  }
}
