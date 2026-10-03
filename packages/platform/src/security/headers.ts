import { buildCsp, type CspOptions, type CspProfile } from './csp.ts';

/**
 * Page types and their security headers (M1.14a). The type is decided from the path alone
 * (after the locale prefix), so proxy.ts can set headers before anything renders.
 */
export type PageType =
  /** Organizer console, platform console, sign-in and signup. */
  | 'console'
  /** Payment steps. */
  | 'checkout'
  /** Pages reached through a secret link in the path (tickets, orders, claims, invitations). */
  | 'token'
  /** The door scanner PWA (camera + WebAssembly decoder). */
  | 'scan'
  /** Cacheable public pages: home, event pages, legal, privacy. */
  | 'public';

const PREFIXES: readonly [string, PageType][] = [
  ['/o', 'console'],
  ['/dev', 'console'],
  ['/sign-in', 'console'],
  ['/signup', 'console'],
  ['/connect', 'console'],
  ['/portal', 'console'],
  // M5.3a: speaker (and later exhibitor) portal accounts: invitation, sign-in and the portal.
  ['/event-portal', 'console'],
  ['/checkout', 'checkout'],
  ['/my-tickets', 'token'],
  ['/orders', 'token'],
  ['/claim', 'token'],
  ['/invite', 'token'],
  // M3.3a TV mode: a display link's token in the path.
  ['/tv', 'token'],
  // M4.5a: a guest website (its address in the path, its content behind a password).
  ['/w', 'token'],
  // M4.7a: a party's guest hub (its signed RSVP link in the path: no referrer, never framed).
  ['/hub', 'token'],
  ['/scan', 'scan'],
];

/** Strip a leading locale segment (`/ar/o/x` → `/o/x`). */
export function stripLocale(pathname: string, locales: readonly string[]): string {
  const seg = pathname.split('/')[1] ?? '';
  if (locales.includes(seg)) return pathname.slice(seg.length + 1) || '/';
  return pathname;
}

export function pageTypeOf(pathname: string): PageType {
  for (const [prefix, type] of PREFIXES)
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return type;
  return 'public';
}

export const PROFILE_OF: Readonly<Record<PageType, CspProfile>> = {
  console: 'strict',
  checkout: 'strict',
  token: 'strict',
  scan: 'strict',
  public: 'public',
};

export const CSP_REPORT_PATH = '/api/csp-report';

export interface SecurityHeaderOptions {
  readonly nonce: string;
  readonly dev?: boolean;
  /** HTTPS deployments: HSTS and upgrade-insecure-requests. */
  readonly https?: boolean;
  readonly extra?: CspOptions['extra'];
  /** M6.14a: the page may ask for the visitor's location (same origin only). */
  readonly geolocation?: boolean;
}

/**
 * M6.14a: paths (after the locale) whose page may ask for the visitor's location: the
 * marketplace search's "Use my location". Everything else keeps `geolocation=()`.
 */
const GEOLOCATION_PATHS: readonly string[] = ['/search'];
export const geolocationAllowed = (pathname: string) => GEOLOCATION_PATHS.includes(pathname);

/** Every header a page response carries, by page type. */
export function securityHeaders(type: PageType, o: SecurityHeaderOptions): Record<string, string> {
  const framed = type === 'public';
  // The console frames same-origin email previews (M1.10d), which carry their own sandboxed
  // policy; everything else still may frame nothing.
  const frames = type === 'console' ? ["'self'", ...(o.extra?.frame ?? [])] : o.extra?.frame;
  const csp = buildCsp({
    profile: PROFILE_OF[type],
    nonce: o.nonce,
    dev: o.dev,
    wasm: type === 'scan',
    frameAncestors: framed ? ["'self'"] : ["'none'"],
    reportUri: CSP_REPORT_PATH,
    upgradeInsecure: o.https,
    extra: frames ? { ...o.extra, frame: frames } : o.extra,
  });
  const h: Record<string, string> = {
    'content-security-policy': csp,
    'reporting-endpoints': `csp="${CSP_REPORT_PATH}"`,
    'x-content-type-options': 'nosniff',
    // Legacy browsers without frame-ancestors.
    'x-frame-options': framed ? 'SAMEORIGIN' : 'DENY',
    // Secret links must never leak through Referer; the console stays same-origin only.
    'referrer-policy':
      type === 'token'
        ? 'no-referrer'
        : type === 'public'
          ? 'strict-origin-when-cross-origin'
          : 'same-origin',
    'permissions-policy': [
      `camera=${type === 'scan' ? '(self)' : '()'}`,
      'microphone=()',
      `geolocation=${o.geolocation && type === 'public' ? '(self)' : '()'}`,
      'payment=()',
      'usb=()',
      'browsing-topics=()',
    ].join(', '),
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-dns-prefetch-control': 'off',
  };
  if (o.https) h['strict-transport-security'] = 'max-age=63072000; includeSubDomains';
  return h;
}

/** Headers for API responses (JSON, webhooks, downloads): nothing may render or frame them. */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};
