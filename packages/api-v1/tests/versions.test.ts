import { describe, expect, it } from 'vitest';
import { clientInfo, compareVersions, mobileSettingsFromEnv } from '../src/index.ts';
import { DEFAULT_MOBILE, mobileApps, upgradeRequired } from '../src/versions.ts';

const headers = (h: Record<string, string>) => new Headers(h);

describe('compareVersions', () => {
  it('compares part by part, numerically', () => {
    expect(compareVersions('3.10.0', '3.9.1')).toBe(1);
    expect(compareVersions('3.9.1', '3.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('10', '9.9.9')).toBe(1);
  });
  it('treats a missing part as zero and ignores a pre-release or build suffix', () => {
    expect(compareVersions('3', '3.0.0')).toBe(0);
    expect(compareVersions('3.0.0-beta.1', '3.0.0')).toBe(0);
    expect(compareVersions('3.0.0+45', '3.0.0')).toBe(0);
    expect(compareVersions('3.0', '3.0.1')).toBe(-1);
  });
});

describe('X-Yayatoh-Client with a build number', () => {
  it('reads the version before the build in parentheses', () => {
    expect(clientInfo(headers({ 'x-yayatoh-client': 'yayatoh-ios/3.2.1 (45)' }))).toEqual({
      client: 'yayatoh-ios',
      appVersion: '3.2.1',
    });
    expect(clientInfo(headers({ 'x-yayatoh-client': 'Yayatoh-Staff-Android/2.0.0' })).client).toBe(
      'yayatoh-staff-android',
    );
  });
});

describe('mobileApps', () => {
  it('gives the attendee apps the per-platform values and the Staff apps no minimum', () => {
    const apps = mobileApps({
      ...DEFAULT_MOBILE,
      minimumVersions: { ios: '3.0.0', android: '3.1.0' },
      latestVersions: { ios: '3.4.0', android: '3.5.0' },
    });
    expect(apps['yayatoh-ios']).toMatchObject({ minimumVersion: '3.0.0', latestVersion: '3.4.0' });
    expect(apps['yayatoh-android']).toMatchObject({ minimumVersion: '3.1.0', latestVersion: '3.5.0' });
    expect(apps['yayatoh-staff-ios'].minimumVersion).toBe('0.0.0');
    expect(apps['yayatoh-staff-android'].minimumVersion).toBe('0.0.0');
    expect(apps['yayatoh-ios'].storeUrl).toBe(DEFAULT_MOBILE.baseUrls.web);
  });
  it('lets an app override any field on its own', () => {
    const apps = mobileApps({
      ...DEFAULT_MOBILE,
      apps: { 'yayatoh-staff-ios': { minimumVersion: '2.0.0', storeUrl: 'https://s.test/staff' } },
    });
    expect(apps['yayatoh-staff-ios']).toEqual({
      minimumVersion: '2.0.0',
      latestVersion: '0.0.0',
      storeUrl: 'https://s.test/staff',
    });
  });
});

describe('mobileSettingsFromEnv', () => {
  it('is undefined without configuration', () => {
    expect(mobileSettingsFromEnv({})).toBeUndefined();
  });
  it('takes MOBILE_CONFIG_JSON and fills the store links from their env names', () => {
    const s = mobileSettingsFromEnv({
      MOBILE_CONFIG_JSON: '{"minimumVersions":{"ios":"3.0.0","android":"3.0.0"}}',
      IOS_ATTENDEE_STORE_URL: ' https://apps.apple.com/app/x ',
      ANDROID_STAFF_STORE_URL: 'https://play.google.com/store/apps/details?id=x',
    });
    expect(s?.minimumVersions?.ios).toBe('3.0.0');
    expect(s?.apps?.['yayatoh-ios']?.storeUrl).toBe('https://apps.apple.com/app/x');
    expect(s?.apps?.['yayatoh-staff-android']?.storeUrl).toContain('play.google.com');
  });
  it('keeps a store link the JSON sets and ignores one that is not https', () => {
    const s = mobileSettingsFromEnv({
      MOBILE_CONFIG_JSON: '{"apps":{"yayatoh-ios":{"storeUrl":"https://json.test/ios"}}}',
      IOS_ATTENDEE_STORE_URL: 'https://env.test/ios',
      IOS_STAFF_STORE_URL: 'javascript:alert(1)',
      ANDROID_ATTENDEE_STORE_URL: 'http://insecure.test',
    });
    expect(s?.apps?.['yayatoh-ios']?.storeUrl).toBe('https://json.test/ios');
    expect(s?.apps?.['yayatoh-staff-ios']).toBeUndefined();
    expect(s?.apps?.['yayatoh-android']).toBeUndefined();
  });
});

describe('upgradeRequired', () => {
  it('is a problem document with the store link', () => {
    const body = upgradeRequired('yayatoh-ios', '2.0.0', {
      minimumVersion: '3.0.0',
      latestVersion: '3.4.0',
      storeUrl: 'https://s.test',
    });
    expect(body).toMatchObject({
      status: 426,
      code: 'upgrade_required',
      details: { storeUrl: 'https://s.test' },
    });
    expect(body.type).toMatch(/\/upgrade_required$/);
  });
});
