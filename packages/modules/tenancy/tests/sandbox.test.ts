import { describe, expect, it } from 'vitest';
import { isApiKeyLive } from '../src/commands/api-keys.ts';
import { sandboxOrgName, sandboxSlug } from '../src/commands/sandbox.ts';
import { roleCan } from '../src/domain/permissions.ts';
import { ORG_ROLES } from '../src/schema.ts';

describe('sandbox orgs (M6.3a)', () => {
  it('names a sandbox after its parent, within the 63-character slug limit', () => {
    expect(sandboxSlug('lakeside-events', 'a1b2c3')).toBe('lakeside-events-sandbox-a1b2c3');
    const long = sandboxSlug(`${'x'.repeat(39)}-yyyyyyyyyyyyyyyyyyyy`, 'ffffff');
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toBe(`${'x'.repeat(39)}-sandbox-ffffff`);
    expect(sandboxSlug('abc')).toMatch(/^abc-sandbox-[0-9a-f]{6}$/);
  });

  it('names the sandbox org after its parent, so it sorts right after it', () => {
    expect(sandboxOrgName('Lakeside Events', 'Staging')).toBe('Lakeside Events – Staging');
    expect(['Lakeside Events – E2E', 'Lakeside Events'].sort()[0]).toBe('Lakeside Events');
    expect(sandboxOrgName('x'.repeat(120), 'y'.repeat(60)).length).toBeLessThanOrEqual(120);
  });

  it('only owners and admins manage sandboxes', () => {
    expect(ORG_ROLES.filter((r) => roleCan(r, 'sandbox:manage')).sort()).toEqual(['admin', 'owner']);
  });
});

describe('API key liveness (M6.3a)', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('is live until revoked or past its expiry', () => {
    expect(isApiKeyLive({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(isApiKeyLive({ revokedAt: null, expiresAt: new Date('2026-10-02T12:00:01Z') }, now)).toBe(true);
    expect(isApiKeyLive({ revokedAt: null, expiresAt: now }, now)).toBe(false);
    expect(isApiKeyLive({ revokedAt: new Date('2026-10-01T00:00:00Z'), expiresAt: null }, now)).toBe(false);
  });
});
