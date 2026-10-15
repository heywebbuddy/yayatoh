import { light } from '@yayatoh/ui/tokens';
import type { ExpoConfig } from 'expo/config';
import appConfig from '../app.config';

const config = (appEnv: string, extra: Record<string, string> = {}): ExpoConfig => {
  const saved = { ...process.env };
  process.env.APP_ENV = appEnv;
  Object.assign(process.env, extra);
  try {
    return (appConfig as () => ExpoConfig)();
  } finally {
    process.env = saved;
  }
};

describe('Yayatoh app config', () => {
  it('is the attendee app: production name and no camera', () => {
    const c = config('production');
    expect(c.name).toBe('Yayatoh');
    expect(c.slug).toBe('yayatoh');
    expect(c.scheme).toBe('yayatoh');
    expect(c.android?.permissions).toEqual(['android.permission.ACCESS_COARSE_LOCATION']);
    expect(c.android?.blockedPermissions).toContain('android.permission.CAMERA');
    expect(c.ios?.infoPlist?.NSCameraUsageDescription).toBeUndefined();
  });

  it('installs next to the production app in development and preview', () => {
    expect(config('development').name).toBe('Yayatoh (Dev)');
    expect(config('preview').name).toBe('Yayatoh (Preview)');
    expect(config('development').ios?.bundleIdentifier).toMatch(/\.dev$/);
    expect(config('preview').android?.package).toMatch(/\.preview$/);
  });

  it('takes production store identifiers from the environment (P7-4)', () => {
    const c = config('production', {
      IOS_BUNDLE_ID: 'com.example.listing',
      ANDROID_PACKAGE: 'com.example.listing',
    });
    expect(c.ios?.bundleIdentifier).toBe('com.example.listing');
    expect(c.android?.package).toBe('com.example.listing');
  });

  it('is built from the design tokens (splash, adaptive icon)', () => {
    const c = config('production');
    expect(c.android?.adaptiveIcon?.backgroundColor).toBe(light.primary);
  });
});
