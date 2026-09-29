import {
  cutoverUnavailable,
  decideFrontDoor,
  type FlagStates,
  frontDoorConfig,
  type HostRouteTarget,
} from '@yayatoh/platform/front-door';
import { describe, expect, it } from 'vitest';

/**
 * M2.5a cutover host routing, on the M2.4a front door (batch 3c merge: one front door). The
 * cutover tool's `host_route:<host>` switches a whole host; the M2.4a route table decides while
 * it is unset. Origins come from the M2.4a configuration (`LEGACY_ORIGIN_URL`, …).
 */
const config = frontDoorConfig({
  LEGACY_ORIGIN_URL: 'https://origin-yay.yayatoh.com',
  LEGACY_ABC_ORIGIN_URL: 'https://origin-abc.yayatoh.com',
});
const noFlags: FlagStates = new Map();
const door = (
  hostRoute: HostRouteTarget,
  path = '/events/gala',
  cookies: { canary?: boolean; legacy?: boolean } = {},
  host = 'yayatoh.com',
) =>
  decideFrontDoor({
    instance: config.hosts.get(host)?.instance ?? 'yay',
    host,
    path,
    query: new URLSearchParams(),
    flags: noFlags,
    overrides: { canary: cookies.canary ?? false, legacy: cookies.legacy ?? false },
    hostRoute,
  });

describe('cutover front door (M2.5a on the M2.4a front door)', () => {
  it('the legacy hosts get their origins from the front-door configuration', () => {
    expect(config.hosts.get('yayatoh.com')?.origin).toBe('https://origin-yay.yayatoh.com');
    expect(config.hosts.get('abc.yayatoh.com')?.origin).toBe('https://origin-abc.yayatoh.com');
    expect(frontDoorConfig({}).hosts.size).toBe(0);
  });

  it('a host without a routing entry follows the route table (moved routes start on legacy)', () => {
    expect(door(null)).toMatchObject({ owner: 'legacy', reason: 'flag' });
    expect(door(null, '/some/legacy/page')).toMatchObject({ owner: 'legacy', reason: 'unowned' });
  });

  it('routed to next: the whole host is served by the new app; flipping the flag is the switch', () => {
    expect(door('next')).toMatchObject({ owner: 'next', route: 'events.page', reason: 'cutover' });
    expect(door('next', '/some/legacy/page')).toMatchObject({ owner: 'next', reason: 'cutover' });
    expect(door('legacy')).toMatchObject({ owner: 'legacy', reason: 'cutover' });
    expect(door('legacy', '/events/gala', {}, 'abc.yayatoh.com')).toMatchObject({
      owner: 'legacy',
      reason: 'cutover',
    });
  });

  it('routed to legacy, whatever the route flags say', () => {
    const d = decideFrontDoor({
      instance: 'yay',
      host: 'yayatoh.com',
      path: '/events/gala',
      query: new URLSearchParams(),
      flags: new Map([['yayatoh.com|events.page', 'next']]),
      overrides: { canary: false, legacy: false },
      hostRoute: 'legacy',
    });
    expect(d).toMatchObject({ owner: 'legacy', reason: 'cutover' });
  });

  it('routed to legacy without a configured origin: maintenance, never a wrong site', () => {
    expect(cutoverUnavailable({ hostRoute: 'legacy', path: '/events/gala', canary: false })).toBe(true);
    expect(cutoverUnavailable({ hostRoute: 'legacy', path: '/events/gala', canary: true })).toBe(false);
    expect(cutoverUnavailable({ hostRoute: 'legacy', path: '/ar/sign-in', canary: false })).toBe(false);
    expect(cutoverUnavailable({ hostRoute: 'next', path: '/events/gala', canary: false })).toBe(false);
    expect(cutoverUnavailable({ hostRoute: null, path: '/events/gala', canary: false })).toBe(false);
  });

  it('cookie overrides let testers see either side', () => {
    expect(door('legacy', '/events/gala', { canary: true })).toMatchObject({
      owner: 'next',
      reason: 'canary',
    });
    expect(door('next', '/events/gala', { legacy: true })).toMatchObject({
      owner: 'legacy',
      reason: 'override',
    });
  });

  it('the new app’s own paths are never forwarded, even while the host is routed to legacy', () => {
    for (const p of ['/api/v2/events', '/sign-in', '/ar/my-tickets', '/widget.js'])
      expect(door('legacy', p)).toMatchObject({ owner: 'next', reason: 'platform' });
  });
});
