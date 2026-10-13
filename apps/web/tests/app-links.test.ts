import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import {
  AASA_PATH,
  appLinkConfig,
  appLinksHost,
  appLinksResponse,
  appleAppSiteAssociation,
  assetLinks,
  isAppLinksPath,
} from '../src/lib/app-links.ts';

const FP_A = `${'AB:'.repeat(31)}AB`;
const FP_B = `${'01:'.repeat(31)}01`;
const env = {
  MARKETPLACE_HOSTS: 'yayatoh.com,www.yayatoh.com',
  APP_HOSTS: 'app.yayatoh.com',
  TENANT_APEX: 'yayatoh.events',
  APPLE_TEAM_ID: 'ABCDE12345',
  IOS_ATTENDEE_BUNDLE_IDS: 'com.yayatoh.app, com.yayatoh.app.staging',
  IOS_STAFF_BUNDLE_IDS: 'com.yayatoh.staff',
  ANDROID_ATTENDEE_PACKAGES: 'com.yayatoh.app',
  ANDROID_ATTENDEE_SHA256_FINGERPRINTS: `${FP_A.toLowerCase()},${FP_B}`,
  ANDROID_STAFF_PACKAGES: 'com.yayatoh.staff',
  ANDROID_STAFF_SHA256_FINGERPRINTS: FP_A,
};

describe('which hosts serve the link files', () => {
  it('serves the platform hosts and the tenant-apex subdomains', () => {
    for (const h of ['yayatoh.com', 'www.yayatoh.com', 'app.yayatoh.com', 'lakeside.yayatoh.events'])
      expect(appLinksHost(h, env)).toBe(true);
  });

  it('never a custom tenant domain, a preview, localhost, a lookalike or the bare tenant apex', () => {
    for (const h of [
      'tickets.example.org',
      'pr-7-yayatoh.vercel.app',
      'localhost',
      '',
      'yayatoh.events',
      'evilyayatoh.events',
      'yayatoh.com.evil.test',
      'abc.yayatoh.com',
    ])
      expect(appLinksHost(h, env)).toBe(false);
  });

  it('lists extra platform-owned link hosts only when configured (abc.yayatoh.com, P7-4)', () => {
    expect(appLinksHost('abc.yayatoh.com', { ...env, APP_LINK_EXTRA_HOSTS: 'abc.yayatoh.com' })).toBe(true);
    expect(appLinksHost('tickets.example.org', { ...env, APP_LINK_EXTRA_HOSTS: 'abc.yayatoh.com' })).toBe(
      false,
    );
  });

  it('follows TENANT_APEX', () => {
    expect(appLinksHost('lakeside.example.events', { ...env, TENANT_APEX: 'Example.Events' })).toBe(true);
    expect(appLinksHost('lakeside.yayatoh.events', { ...env, TENANT_APEX: 'example.events' })).toBe(false);
  });

  it('matches only the two exact paths', () => {
    expect(isAppLinksPath(AASA_PATH)).toBe(true);
    expect(isAppLinksPath('/.well-known/assetlinks.json')).toBe(true);
    for (const p of [
      '/.well-known/apple-app-site-association/',
      '/ar/.well-known/assetlinks.json',
      '/.well-known/security.txt',
      '/apple-app-site-association',
    ])
      expect(isAppLinksPath(p)).toBe(false);
  });
});

describe('apple-app-site-association', () => {
  const aasa = appleAppSiteAssociation(appLinkConfig(env));

  it('lists both apps with their team-prefixed app ids', () => {
    expect(aasa.applinks.details.map((d) => d.appIDs)).toEqual([
      ['ABCDE12345.com.yayatoh.app', 'ABCDE12345.com.yayatoh.app.staging'],
      ['ABCDE12345.com.yayatoh.staff'],
    ]);
  });

  it('opens tickets, orders, claims and events in the attendee app, in every locale', () => {
    const paths = aasa.applinks.details[0]?.components.map((c) => c['/']) ?? [];
    for (const p of ['/events/*', '/e/*', '/my-tickets/*', '/orders/*', '/claim/*']) {
      expect(paths).toContain(p);
      for (const l of LOCALES.filter((x) => x !== 'en')) expect(paths).toContain(`/${l}${p}`);
    }
    expect(paths).toHaveLength(5 * LOCALES.length);
    // The allowlist is closed: no catch-all, nothing for sign-in, checkout or the console.
    expect(paths).not.toContain('/*');
    expect(paths.some((p) => /sign-in|checkout|\/o\/|account|attendee|api/.test(p))).toBe(false);
  });

  it('gives staff enrolment (the scan page with an e= fragment) to the Staff app only', () => {
    const staff = aasa.applinks.details[1]?.components ?? [];
    expect(staff).toContainEqual({ '/': '/scan', '#': 'e=*' });
    expect(staff).toContainEqual({ '/': '/ar/scan', '#': 'e=*' });
    expect(staff).toHaveLength(LOCALES.length);
    const attendee = aasa.applinks.details[0]?.components.map((c) => c['/']) ?? [];
    expect(attendee.some((p) => p.endsWith('/scan'))).toBe(false);
  });

  it('shares passwords with both apps through webcredentials', () => {
    expect(aasa.webcredentials.apps).toEqual([
      'ABCDE12345.com.yayatoh.app',
      'ABCDE12345.com.yayatoh.app.staging',
      'ABCDE12345.com.yayatoh.staff',
    ]);
  });

  it('is valid and empty when the environment has no identifiers', () => {
    expect(appleAppSiteAssociation(appLinkConfig({}))).toEqual({
      applinks: { details: [] },
      webcredentials: { apps: [] },
    });
  });

  it('drops a malformed team id or bundle id instead of serving it', () => {
    const bad = appLinkConfig({ ...env, APPLE_TEAM_ID: 'not-a-team' });
    expect(appleAppSiteAssociation(bad).applinks.details).toEqual([]);
    const some = appLinkConfig({ ...env, IOS_ATTENDEE_BUNDLE_IDS: 'ok.app,not a bundle,*' });
    expect(appleAppSiteAssociation(some).applinks.details[0]?.appIDs).toEqual(['ABCDE12345.ok.app']);
  });
});

describe('assetlinks.json', () => {
  it('has a statement per package with the signing fingerprints, upper-cased', () => {
    expect(assetLinks(appLinkConfig(env))).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
        target: {
          namespace: 'android_app',
          package_name: 'com.yayatoh.app',
          sha256_cert_fingerprints: [FP_A, FP_B],
        },
      },
      {
        relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
        target: {
          namespace: 'android_app',
          package_name: 'com.yayatoh.staff',
          sha256_cert_fingerprints: [FP_A],
        },
      },
    ]);
  });

  it('leaves out a package with no valid fingerprint, and is an empty array without config', () => {
    expect(
      assetLinks(appLinkConfig({ ...env, ANDROID_ATTENDEE_SHA256_FINGERPRINTS: 'AB:CD' })).map(
        (s) => s.target.package_name,
      ),
    ).toEqual(['com.yayatoh.staff']);
    expect(assetLinks(appLinkConfig({}))).toEqual([]);
  });
});

describe('the response', () => {
  it('is 200 application/json, cacheable, without a cookie or a redirect', async () => {
    const res = appLinksResponse(AASA_PATH, 'app.yayatoh.com', env);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('application/json');
    expect(res?.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(res?.headers.has('set-cookie')).toBe(false);
    expect(res?.headers.has('location')).toBe(false);
    expect(JSON.parse((await res?.text()) ?? '').applinks.details).toHaveLength(2);
  });

  it('is null for a host that cannot be in the app entitlements, and for any other path', () => {
    expect(appLinksResponse(AASA_PATH, 'tickets.example.org', env)).toBeNull();
    expect(appLinksResponse('/.well-known/assetlinks.json', 'tickets.example.org', env)).toBeNull();
    expect(appLinksResponse('/robots.txt', 'yayatoh.com', env)).toBeNull();
  });
});
