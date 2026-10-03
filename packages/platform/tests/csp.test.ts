import { describe, expect, it } from 'vitest';
import { buildCsp, generateNonce, parseCsp } from '../src/security/csp.ts';
import { geolocationAllowed, pageTypeOf, securityHeaders, stripLocale } from '../src/security/headers.ts';

const nonce = generateNonce();

describe('CSP builder', () => {
  it('generates unique 128-bit base64 nonces', () => {
    const seen = new Set(Array.from({ length: 200 }, generateNonce));
    expect(seen.size).toBe(200);
    for (const n of seen) expect(atob(n)).toHaveLength(16);
  });

  it('strict profile: nonce + strict-dynamic, no unsafe-inline/eval, framing denied', () => {
    const csp = parseCsp(buildCsp({ profile: 'strict', nonce }));
    expect(csp.get('script-src')).toEqual([`'nonce-${nonce}'`, "'strict-dynamic'", "'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);
    expect(csp.get('style-src-attr')).toEqual(["'none'"]);
    for (const [, v] of csp) {
      expect(v).not.toContain("'unsafe-inline'");
      expect(v).not.toContain("'unsafe-eval'");
      expect(v).not.toContain('*');
    }
  });

  it('public profile: host allowlist (SRI-friendly) without strict-dynamic, same-origin framing', () => {
    const csp = parseCsp(
      buildCsp({ profile: 'public', nonce, extra: { script: ['https://challenges.cloudflare.com'] } }),
    );
    expect(csp.get('script-src')).toEqual([
      "'self'",
      `'nonce-${nonce}'`,
      'https://challenges.cloudflare.com',
    ]);
    expect(csp.get('script-src')).not.toContain("'strict-dynamic'");
    expect(csp.get('frame-ancestors')).toEqual(["'self'"]);
  });

  it("service workers (scanner, web push M1.10e) load from 'self' on every profile, never from elsewhere", () => {
    for (const profile of ['strict', 'public'] as const) {
      const csp = parseCsp(
        buildCsp({ profile, nonce, extra: { script: [], connect: ['https://x.example'] } }),
      );
      expect(csp.get('worker-src')).toEqual(["'self'", 'blob:']);
    }
  });

  it('dev adds unsafe-eval; wasm adds wasm-unsafe-eval only', () => {
    expect(parseCsp(buildCsp({ profile: 'strict', nonce, dev: true })).get('script-src')).toContain(
      "'unsafe-eval'",
    );
    const wasm = parseCsp(buildCsp({ profile: 'strict', nonce, wasm: true })).get('script-src');
    expect(wasm).toContain("'wasm-unsafe-eval'");
    expect(wasm).not.toContain("'unsafe-eval'");
  });

  it('reporting and upgrade directives', () => {
    const csp = buildCsp({ profile: 'strict', nonce, reportUri: '/api/csp-report', upgradeInsecure: true });
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to csp');
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('refuses malformed nonces and dangerous extra sources', () => {
    expect(() => buildCsp({ profile: 'strict', nonce: "abc'; script-src *" })).toThrow(/nonce/);
    expect(() => buildCsp({ profile: 'public', nonce, extra: { script: ["'unsafe-inline'"] } })).toThrow();
    expect(() => buildCsp({ profile: 'public', nonce, extra: { script: ['http://evil.test'] } })).toThrow();
    expect(() => buildCsp({ profile: 'public', nonce, extra: { img: ['*'] } })).toThrow();
    expect(() =>
      buildCsp({ profile: 'public', nonce, extra: { connect: ['https://x.test; script-src *'] } }),
    ).toThrow();
  });
});

describe('page types and headers', () => {
  const locales = ['en', 'ar', 'fr'];
  it('classifies paths after the locale prefix', () => {
    expect(stripLocale('/ar/o/lakeside', locales)).toBe('/o/lakeside');
    expect(stripLocale('/ar', locales)).toBe('/');
    expect(stripLocale('/orders/x', locales)).toBe('/orders/x');
    expect(pageTypeOf('/o/lakeside/settings/activity')).toBe('console');
    expect(pageTypeOf('/sign-in')).toBe('console');
    expect(pageTypeOf('/checkout/fake')).toBe('checkout');
    expect(pageTypeOf('/my-tickets/tok')).toBe('token');
    expect(pageTypeOf('/tv/yytv_tok')).toBe('token');
    expect(pageTypeOf('/orders/tok')).toBe('token');
    expect(pageTypeOf('/scan')).toBe('scan');
    expect(pageTypeOf('/events/jazz')).toBe('public');
    expect(pageTypeOf('/privacy')).toBe('public');
    expect(pageTypeOf('/')).toBe('public');
    // Prefix matching is by segment.
    expect(pageTypeOf('/organizers')).toBe('public');
    expect(pageTypeOf('/scanner-info')).toBe('public');
  });

  it('sets the full header set per page type', () => {
    const console = securityHeaders('console', { nonce, https: true });
    expect(console['x-frame-options']).toBe('DENY');
    // M1.10d: the console frames same-origin email previews (their own sandboxed policy) and
    // nothing else; other page types still frame nothing. Styles stay nonce-only either way.
    const consoleCsp = parseCsp(console['content-security-policy'] as string);
    expect(consoleCsp.get('frame-src')).toEqual(["'self'"]);
    expect(consoleCsp.get('style-src-attr')).toEqual(["'none'"]);
    expect(consoleCsp.get('style-src')).not.toContain("'unsafe-inline'");
    for (const t of ['checkout', 'token', 'scan', 'public'] as const)
      expect(
        parseCsp(securityHeaders(t, { nonce })['content-security-policy'] as string).get('frame-src'),
      ).toEqual(["'none'"]);
    expect(console['referrer-policy']).toBe('same-origin');
    expect(console['strict-transport-security']).toMatch(/max-age=63072000/);
    expect(console['cross-origin-opener-policy']).toBe('same-origin');
    expect(console['permissions-policy']).toContain('camera=()');
    expect(console['content-security-policy']).toContain("'strict-dynamic'");

    const token = securityHeaders('token', { nonce });
    expect(token['referrer-policy']).toBe('no-referrer');
    expect(token['strict-transport-security']).toBeUndefined();

    expect(console['permissions-policy']).toContain('geolocation=()');
    // M6.14a: only a public page that asks for it may use the visitor's location.
    expect(securityHeaders('public', { nonce, geolocation: true })['permissions-policy']).toContain(
      'geolocation=(self)',
    );
    expect(securityHeaders('console', { nonce, geolocation: true })['permissions-policy']).toContain(
      'geolocation=()',
    );
    expect(geolocationAllowed('/search')).toBe(true);
    expect(geolocationAllowed('/events')).toBe(false);

    const scan = securityHeaders('scan', { nonce });
    expect(scan['permissions-policy']).toContain('camera=(self)');
    expect(scan['content-security-policy']).toContain("'wasm-unsafe-eval'");

    const pub = securityHeaders('public', { nonce });
    expect(pub['x-frame-options']).toBe('SAMEORIGIN');
    expect(pub['content-security-policy']).not.toContain("'strict-dynamic'");
    expect(pub['content-security-policy']).toContain("frame-ancestors 'self'");
  });
});
