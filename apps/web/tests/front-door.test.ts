import { describe, expect, it } from 'vitest';
import { frontDoor, parseLegacyOrigins } from '../src/lib/front-door.ts';

const origins = parseLegacyOrigins(
  'yayatoh.com=https://origin-yay.yayatoh.com, abc.yayatoh.com=https://origin-abc.yayatoh.com,bad=ftp://x,evil.test=http://evil.test,dev.localhost=http://legacy.localhost:8080,path.test=https://a.test/x',
);
const door = (route: 'next' | 'legacy' | null, host = 'yayatoh.com', cookies = {}) =>
  frontDoor({ route, host, cookies, origins });

describe('cutover front door (M2.5a)', () => {
  it('accepts only https origins (http on localhost) without a path', () => {
    expect([...origins.entries()]).toEqual([
      ['yayatoh.com', 'https://origin-yay.yayatoh.com'],
      ['abc.yayatoh.com', 'https://origin-abc.yayatoh.com'],
      ['dev.localhost', 'http://legacy.localhost:8080'],
    ]);
    expect(parseLegacyOrigins(undefined).size).toBe(0);
  });

  it('a host without a routing entry is served by the new platform', () => {
    expect(door(null)).toEqual({ kind: 'next' });
    expect(door(null, 'unknown.test')).toEqual({ kind: 'next' });
  });

  it('routed to legacy: rewritten to its origin; flipping the flag is the switch', () => {
    expect(door('legacy')).toEqual({ kind: 'legacy', origin: 'https://origin-yay.yayatoh.com' });
    expect(door('next')).toEqual({ kind: 'next' });
    expect(door('legacy', 'abc.yayatoh.com')).toEqual({
      kind: 'legacy',
      origin: 'https://origin-abc.yayatoh.com',
    });
  });

  it('routed to legacy without a configured origin: maintenance, never a wrong site', () => {
    expect(door('legacy', 'no-origin.test')).toEqual({ kind: 'unavailable' });
  });

  it('cookie overrides let testers see either side', () => {
    expect(door('legacy', 'yayatoh.com', { canary: 'next' })).toEqual({ kind: 'next' });
    expect(door('next', 'yayatoh.com', { legacy: '1' })).toEqual({
      kind: 'legacy',
      origin: 'https://origin-yay.yayatoh.com',
    });
    // No origin to fall back to: the override is ignored.
    expect(door('next', 'no-origin.test', { legacy: '1' })).toEqual({ kind: 'next' });
    expect(door('next', 'yayatoh.com', { legacy: 'yes' })).toEqual({ kind: 'next' });
  });
});
