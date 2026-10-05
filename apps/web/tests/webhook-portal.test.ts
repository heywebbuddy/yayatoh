import { securityHeaders } from '@yayatoh/platform/security';
import { describe, expect, it } from 'vitest';
import { webhookPortalFrameSources } from '../src/lib/webhook-portal.ts';

const csp = (frame: string[], type: 'console' | 'public' = 'console') =>
  securityHeaders(type, { nonce: 'AAAAAAAAAAAAAAAAAAAAAA==', extra: { frame } })[
    'content-security-policy'
  ] as string;

describe('webhook portal frame sources (M6.3b)', () => {
  it('adds nothing without Svix, so dev and CI headers are unchanged', () => {
    expect(webhookPortalFrameSources('/o/acme/webhooks/portal', {})).toEqual([]);
    expect(csp([])).toBe(
      securityHeaders('console', { nonce: 'AAAAAAAAAAAAAAAAAAAAAA==' })['content-security-policy'],
    );
  });

  it('allows Svix’s portal on the portal page only', () => {
    const env = { SVIX_API_KEY: 'sk_x' };
    expect(webhookPortalFrameSources('/o/acme/webhooks/portal', env)).toEqual(['https://app.svix.com']);
    expect(webhookPortalFrameSources('/o/acme/webhooks', env)).toEqual([]);
    expect(webhookPortalFrameSources('/events/x', env)).toEqual([]);
    expect(csp(['https://app.svix.com'])).toMatch(/frame-src 'self' https:\/\/app\.svix\.com;/);
  });

  it('takes a custom portal origin, and ignores a malformed one', () => {
    expect(
      webhookPortalFrameSources('/o/a/webhooks/portal', {
        SVIX_API_KEY: 'k',
        SVIX_PORTAL_ORIGIN: 'https://hooks.yayatoh.com',
      }),
    ).toEqual(['https://hooks.yayatoh.com']);
    expect(
      webhookPortalFrameSources('/o/a/webhooks/portal', {
        SVIX_API_KEY: 'k',
        SVIX_PORTAL_ORIGIN: "'unsafe-inline'",
      }),
    ).toEqual([]);
  });
});
