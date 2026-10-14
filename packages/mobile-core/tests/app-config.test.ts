import {
  associatedDomains,
  buildExpoConfig,
  DEVELOPMENT_API_BASE_URL,
  googleIosRedirectScheme,
  NATIVE_LOCALES,
  PRODUCTION_API_BASE_URL,
  resolveApiBaseUrl,
  resolveAppEnv,
} from '../src/app-config';

const base = {
  splash: { light: 'light-bg', dark: 'dark-bg' },
  adaptiveBackground: 'adaptive-bg',
  assets: { icon: './i.png', adaptiveForeground: './a.png', splash: './s.png' },
};
const mobile = (env: Record<string, string> = {}) => buildExpoConfig({ ...base, app: 'mobile', env });
const staff = (env: Record<string, string> = {}) => buildExpoConfig({ ...base, app: 'staff', env });

describe('resolveAppEnv', () => {
  it('defaults to development and accepts the three environments', () => {
    expect(resolveAppEnv(undefined)).toBe('development');
    expect(resolveAppEnv(' preview ')).toBe('preview');
    expect(resolveAppEnv('production')).toBe('production');
  });

  it('refuses anything else, so a typo never ships as production', () => {
    expect(() => resolveAppEnv('prod')).toThrow(/APP_ENV/);
    expect(() => resolveAppEnv('staging')).toThrow(/development, preview, production/);
  });
});

describe('names, schemes and identifiers per environment', () => {
  it('suffixes name, scheme and identifiers outside production so builds install side by side', () => {
    const dev = mobile({ APP_ENV: 'development' });
    const preview = mobile({ APP_ENV: 'preview' });
    const prod = mobile({ APP_ENV: 'production' });
    expect([dev.name, preview.name, prod.name]).toEqual(['Yayatoh (Dev)', 'Yayatoh (Preview)', 'Yayatoh']);
    expect([dev.scheme, preview.scheme, prod.scheme]).toEqual(['yayatoh-dev', 'yayatoh-preview', 'yayatoh']);
    expect(dev.ios?.bundleIdentifier).toBe('com.yayatoh.yayatohapp.dev');
    expect(preview.android?.package).toBe('com.yayatoh.yayatohapp.preview');
    expect(prod.ios?.bundleIdentifier).toBe('com.yayatoh.yayatohapp');
    expect(prod.android?.package).toBe('com.yayatoh.yayatohapp');
  });

  it('gives the two apps different identities', () => {
    const m = mobile({ APP_ENV: 'production' });
    const s = staff({ APP_ENV: 'production' });
    expect(s.name).toBe('Yayatoh Staff');
    expect(s.scheme).toBe('yayatoh-staff');
    expect(s.slug).not.toBe(m.slug);
    expect(s.ios?.bundleIdentifier).not.toBe(m.ios?.bundleIdentifier);
    expect(s.android?.package).not.toBe(m.android?.package);
  });

  it('takes production identifiers from the environment and derives the others from them (P7-4)', () => {
    const env = { IOS_BUNDLE_ID: 'com.example.app', ANDROID_PACKAGE: 'com.example.droid' };
    expect(mobile({ ...env, APP_ENV: 'production' }).ios?.bundleIdentifier).toBe('com.example.app');
    expect(mobile({ ...env, APP_ENV: 'production' }).android?.package).toBe('com.example.droid');
    expect(mobile({ ...env, APP_ENV: 'preview' }).ios?.bundleIdentifier).toBe('com.example.app.preview');
    expect(mobile({ ...env, APP_ENV: 'development' }).android?.package).toBe('com.example.droid.dev');
  });

  it('ignores blank identifier variables', () => {
    expect(mobile({ APP_ENV: 'production', IOS_BUNDLE_ID: '  ' }).ios?.bundleIdentifier).toBe(
      'com.yayatoh.yayatohapp',
    );
  });
});

describe('API base URL', () => {
  it('defaults to the local web app in development and the production API otherwise', () => {
    expect(resolveApiBaseUrl('development', {})).toBe(DEVELOPMENT_API_BASE_URL);
    expect(resolveApiBaseUrl('preview', {})).toBe(PRODUCTION_API_BASE_URL);
    expect(resolveApiBaseUrl('production', {})).toBe(PRODUCTION_API_BASE_URL);
  });

  it('takes API_BASE_URL, trims trailing slashes and exposes it in extra', () => {
    expect(resolveApiBaseUrl('development', { API_BASE_URL: 'http://192.168.1.20:3000/api/v1/' })).toBe(
      'http://192.168.1.20:3000/api/v1',
    );
    expect(
      mobile({ APP_ENV: 'preview', API_BASE_URL: 'https://staging.example.com/api/v1' }).extra,
    ).toMatchObject({
      appEnv: 'preview',
      apiBaseUrl: 'https://staging.example.com/api/v1',
    });
  });

  it('refuses plain http outside development and non-http URLs anywhere', () => {
    expect(() => resolveApiBaseUrl('production', { API_BASE_URL: 'http://example.com/api/v1' })).toThrow(
      /https/,
    );
    expect(() => resolveApiBaseUrl('preview', { API_BASE_URL: 'http://example.com/api/v1' })).toThrow(
      /https/,
    );
    expect(() => resolveApiBaseUrl('development', { API_BASE_URL: 'ftp://example.com' })).toThrow(/http/);
  });

  it('allows cleartext traffic only in a build that talks to a plain-http API', () => {
    const plugins = (c: ReturnType<typeof mobile>) => JSON.stringify(c.plugins);
    expect(plugins(mobile({ APP_ENV: 'development' }))).toContain('usesCleartextTraffic');
    expect(
      plugins(mobile({ APP_ENV: 'development', API_BASE_URL: 'https://x.example.com/api/v1' })),
    ).not.toContain('usesCleartextTraffic');
    expect(plugins(mobile({ APP_ENV: 'production' }))).not.toContain('usesCleartextTraffic');
    expect(mobile({ APP_ENV: 'production' }).ios?.infoPlist?.NSAppTransportSecurity).toBeUndefined();
  });
});

describe('link domains', () => {
  it('lists the apex, the app host and the tenant wildcard for iOS', () => {
    expect(associatedDomains({})).toEqual([
      'applinks:yayatoh.com',
      'applinks:app.yayatoh.com',
      'applinks:*.yayatoh.events',
    ]);
    expect(mobile().ios?.associatedDomains).toEqual(associatedDomains({}));
    expect(staff().ios?.associatedDomains).toEqual(associatedDomains({}));
  });

  it('takes the tenant domain from the environment', () => {
    expect(associatedDomains({ TENANT_LINK_DOMAIN: 'tickets.example.org' })).toContain(
      'applinks:*.tickets.example.org',
    );
  });

  it('verifies the same hosts for Android app links', () => {
    const filter = mobile().android?.intentFilters?.[0];
    expect(filter?.autoVerify).toBe(true);
    const data = [filter?.data ?? []].flat();
    expect(data.map((d) => d.host)).toEqual(['yayatoh.com', 'app.yayatoh.com', '*.yayatoh.events']);
    expect(data.every((d) => d.scheme === 'https')).toBe(true);
  });
});

describe('permissions', () => {
  it('asks for the camera in the Staff app only', () => {
    const s = staff();
    expect(s.android?.permissions).toEqual(['android.permission.CAMERA']);
    expect(s.android?.blockedPermissions).toEqual([]);
    expect(s.ios?.infoPlist?.NSCameraUsageDescription).toMatch(/camera/);
    const m = mobile();
    expect(m.android?.permissions).toEqual([]);
    expect(m.android?.blockedPermissions).toEqual(['android.permission.CAMERA']);
    expect(m.ios?.infoPlist?.NSCameraUsageDescription).toBeUndefined();
  });

  it('adds no permission for notifications yet (M7.2c and M7.3d own them)', () => {
    for (const c of [mobile(), staff()]) {
      expect(JSON.stringify(c)).not.toMatch(/NOTIFICATION|UIBackgroundModes|RECORD_AUDIO|LOCATION/);
    }
  });
});

describe('updates and EAS', () => {
  it('leaves updates off and adds no EAS ids without a project id (no credentials in the repo)', () => {
    const c = mobile({ APP_ENV: 'production' });
    expect(c.updates).toEqual({ enabled: false });
    expect(c.extra?.eas).toBeUndefined();
    expect(c.owner).toBeUndefined();
    expect(c.runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('points over-the-air updates at the project from the environment, off in development', () => {
    const env = { EAS_PROJECT_ID: '00000000-0000-4000-8000-000000000000', EXPO_OWNER: 'yayatoh-org' };
    const prod = mobile({ ...env, APP_ENV: 'production' });
    expect(prod.updates).toEqual({ url: `https://u.expo.dev/${env.EAS_PROJECT_ID}`, enabled: true });
    expect(prod.extra?.eas).toEqual({ projectId: env.EAS_PROJECT_ID });
    expect(prod.owner).toBe('yayatoh-org');
    expect(mobile({ ...env, APP_ENV: 'development' }).updates).toMatchObject({ enabled: false });
  });
});

describe('platforms and locales', () => {
  it('builds for iOS and Android only, with iPad support in both apps (P7-10)', () => {
    for (const c of [mobile(), staff()]) {
      expect(c.platforms).toEqual(['ios', 'android']);
      expect(c.ios?.supportsTablet).toBe(true);
    }
  });

  it('uses the same 13 locales as the web, in Expo spelling', () => {
    expect([...NATIVE_LOCALES].sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'nl', 'pt', 'ru', 'zh-Hans', 'zh-Hant'].sort(),
    );
  });

  it('passes locale files through and splash colours as given', () => {
    const c = buildExpoConfig({ ...base, app: 'staff', env: {}, locales: { en: './locales/en.json' } });
    expect(c.locales).toEqual({ en: './locales/en.json' });
    expect(JSON.stringify(c.plugins)).toContain('light-bg');
    expect(JSON.stringify(c.plugins)).toContain('dark-bg');
    expect(c.android?.adaptiveIcon?.backgroundColor).toBe('adaptive-bg');
  });
});

describe('sign-in configuration (M7.1c)', () => {
  const IOS = '1234567890-abcdefg.apps.googleusercontent.com';

  it('enables Sign in with Apple for the attendee app only', () => {
    expect(mobile().ios?.usesAppleSignIn).toBe(true);
    expect(staff().ios?.usesAppleSignIn).toBeUndefined();
  });

  it('adds Google’s redirect schemes only when the client ids are set, keeping the app scheme first', () => {
    expect(mobile({ APP_ENV: 'production' }).scheme).toBe('yayatoh');
    const c = mobile({
      APP_ENV: 'production',
      GOOGLE_IOS_CLIENT_ID: IOS,
      GOOGLE_ANDROID_CLIENT_ID: '999-x.apps.googleusercontent.com',
    });
    expect(c.scheme).toEqual([
      'yayatoh',
      'com.googleusercontent.apps.1234567890-abcdefg',
      'com.yayatoh.yayatohapp',
    ]);
    expect(googleIosRedirectScheme(IOS)).toBe('com.googleusercontent.apps.1234567890-abcdefg');
  });

  it('exposes the public client ids and the Sentry DSN to the app through extra, and nothing when unset', () => {
    const c = mobile({ GOOGLE_IOS_CLIENT_ID: IOS, SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' });
    expect(c.extra).toMatchObject({ googleIosClientId: IOS, sentryDsn: 'https://k@o1.ingest.sentry.io/1' });
    expect(mobile().extra).not.toHaveProperty('sentryDsn');
    expect(mobile().extra).not.toHaveProperty('googleIosClientId');
    expect(mobile({ SENTRY_DSN: '  ' }).extra).not.toHaveProperty('sentryDsn');
  });

  it('adds no permission string for sign-in', () => {
    const keys = (c: ReturnType<typeof mobile>) =>
      Object.keys(c.ios?.infoPlist ?? {}).filter((k) => k.startsWith('NS') && k.endsWith('UsageDescription'));
    expect(keys(mobile())).toEqual([]);
    expect(keys(staff())).toEqual(['NSCameraUsageDescription']);
  });
});
