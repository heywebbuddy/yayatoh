/**
 * Content-Security-Policy builder (roadmap §10 "Request protection", M1.14a).
 *
 * Two profiles:
 * - `strict` (console, checkout, sign-in, tickets, scan): a per-request nonce plus
 *   `'strict-dynamic'`. Only scripts carrying the nonce (Next's bootstrap and the chunks it loads)
 *   run; host allowlists are ignored by CSP3 browsers.
 * - `public` (home, public event pages, legal and privacy pages): a host allowlist (`'self'` plus
 *   named third-party origins, which must be loaded with `integrity`, i.e. SRI) and no
 *   `'strict-dynamic'`, so the policy stays meaningful for pages that are cached or statically
 *   generated. While these pages are rendered per request they also carry the nonce for Next's
 *   inline bootstrap.
 *
 * Neither profile ever allows `'unsafe-inline'` or `'unsafe-eval'` for scripts in production.
 * Pure: no `node:*` imports, so it runs in proxy.ts and in tests.
 */

export type CspProfile = 'strict' | 'public';

/** What a page type needs beyond the profile's defaults. */
export interface CspOptions {
  readonly profile: CspProfile;
  /** Base64 nonce for this response (see `generateNonce`). */
  readonly nonce: string;
  /** `next dev` needs `'unsafe-eval'` (React's debug stacks); never set in production builds. */
  readonly dev?: boolean;
  /** WebAssembly compilation (the scanner's barcode decoder): `'wasm-unsafe-eval'`, not unsafe-eval. */
  readonly wasm?: boolean;
  /** `frame-ancestors`: `'none'` for console/checkout, `'self'` for public pages. */
  readonly frameAncestors?: readonly string[];
  /** Where violation reports go (same origin). */
  readonly reportUri?: string;
  /** Extra origins per directive (e.g. Stripe, Turnstile, R2, Ably), exact `https://host` only. */
  readonly extra?: Partial<Record<ExtraDirective, readonly string[]>>;
  /** Emit `upgrade-insecure-requests` (production over https). */
  readonly upgradeInsecure?: boolean;
}

export type ExtraDirective = 'script' | 'connect' | 'img' | 'frame' | 'form' | 'font' | 'style';

const NONCE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;
const ORIGIN = /^https:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/;
const KEYWORDS = new Set(["'self'", "'none'"]);

/** A fresh, unguessable nonce: 128 random bits, base64. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function checkSource(src: string): string {
  if (KEYWORDS.has(src) || ORIGIN.test(src)) return src;
  // Never let configuration smuggle in a keyword that weakens the policy.
  throw new Error(`CSP: refused source ${JSON.stringify(src)}`);
}

/** Build the header value. Throws on a malformed nonce or a non-origin extra source. */
export function buildCsp(o: CspOptions): string {
  if (!NONCE.test(o.nonce)) throw new Error('CSP: malformed nonce');
  const extra = (d: ExtraDirective) => (o.extra?.[d] ?? []).map(checkSource);
  const nonce = `'nonce-${o.nonce}'`;
  const script =
    o.profile === 'strict'
      ? // 'self' is the fallback for browsers without strict-dynamic; CSP3 browsers ignore it.
        [nonce, "'strict-dynamic'", "'self'"]
      : ["'self'", nonce, ...extra('script')];
  if (o.wasm) script.push("'wasm-unsafe-eval'");
  if (o.dev) script.push("'unsafe-eval'");
  const frameAncestors = (o.frameAncestors ?? (o.profile === 'strict' ? ["'none'"] : ["'self'"])).map(
    checkSource,
  );
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', script],
    // Next's inline <style> tags carry the nonce. Style attributes are not allowed at all: dynamic
    // values are applied through the CSSOM after hydration (see `applyStyle` in @yayatoh/ui).
    ['style-src', ["'self'", nonce, ...extra('style')]],
    ['style-src-attr', ["'none'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...extra('img')]],
    ['font-src', ["'self'", ...extra('font')]],
    ['connect-src', ["'self'", ...extra('connect')]],
    ['media-src', ["'self'", 'blob:']],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['frame-src', extra('frame').length ? extra('frame') : ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'", ...extra('form')]],
    ['frame-ancestors', frameAncestors],
  ];
  const parts = directives.map(([k, v]) => `${k} ${v.join(' ')}`);
  if (o.upgradeInsecure) parts.push('upgrade-insecure-requests');
  if (o.reportUri) parts.push(`report-uri ${o.reportUri}`, 'report-to csp');
  return parts.join('; ');
}

/** Parse a CSP header into directive → sources (tests and the report endpoint). */
export function parseCsp(header: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), values);
  }
  return out;
}
