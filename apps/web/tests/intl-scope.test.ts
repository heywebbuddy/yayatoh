import { describe, expect, it } from 'vitest';
import { INTL_SCOPE_HEADER, intlScopeOf, scopedMessages } from '../src/lib/intl-scope.ts';

describe('intl scopes (M4.7a)', () => {
  it('scopes the guest hub page only, not its manifest, passes or anything else', () => {
    expect(intlScopeOf('/hub/abc~def')).toBe('hub');
    expect(intlScopeOf('/hub/abc~def/')).toBe('hub');
    for (const p of [
      '/hub',
      '/hub/',
      '/hub/abc/manifest',
      '/hub/abc/pass/apple',
      '/rsvp/abc',
      '/',
      '/o/x/hub/y',
    ])
      expect(intlScopeOf(p)).toBeNull();
    expect(INTL_SCOPE_HEADER).toMatch(/^x-/);
  });

  it('keeps only the scope’s namespaces; no scope (or an unknown one) means the whole catalogue', () => {
    const all = { hub: { a: '1' }, rsvp: { b: '2' }, common: { c: '3' } };
    expect(scopedMessages(all, 'hub')).toEqual({ hub: { a: '1' } });
    expect(scopedMessages(all, null)).toBeUndefined();
    expect(scopedMessages(all, undefined)).toBeUndefined();
    expect(scopedMessages(all, 'toString')).toBeUndefined();
    expect(scopedMessages(all, 'rsvp')).toBeUndefined();
  });
});
