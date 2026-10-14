import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
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

describe('Yayatoh Staff app config', () => {
  it('is the staff app: its own name, scheme and identifiers', () => {
    const c = config('production');
    expect(c.name).toBe('Yayatoh Staff');
    expect(c.slug).toBe('yayatoh-staff');
    expect(c.scheme).toBe('yayatoh-staff');
    expect(c.ios?.bundleIdentifier).toBe('com.yayatoh.staff');
    expect(c.android?.package).toBe('com.yayatoh.staff');
  });

  it('is the only app that asks for the camera', () => {
    const c = config('production');
    expect(c.android?.permissions).toEqual(['android.permission.CAMERA']);
    expect(c.android?.blockedPermissions).toEqual([]);
    expect(c.ios?.infoPlist?.NSCameraUsageDescription).toMatch(/camera/i);
  });

  it('installs next to the production app in development and preview', () => {
    expect(config('development').name).toBe('Yayatoh Staff (Dev)');
    expect(config('preview').scheme).toBe('yayatoh-staff-preview');
    expect(config('development').ios?.bundleIdentifier).toBe('com.yayatoh.staff.dev');
  });

  it('has the camera text in every web locale', () => {
    const c = config('production');
    const locales = c.locales as Record<string, string>;
    expect(Object.keys(locales).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'nl', 'pt', 'ru', 'zh-Hans', 'zh-Hant'].sort(),
    );
    for (const file of Object.values(locales)) {
      const abs = path.join(__dirname, '..', file);
      expect(existsSync(abs)).toBe(true);
      const json = JSON.parse(readFileSync(abs, 'utf8')) as { NSCameraUsageDescription?: string };
      expect(json.NSCameraUsageDescription?.trim().length).toBeGreaterThan(10);
    }
  });

  it('is built from the design tokens (adaptive icon)', () => {
    expect(config('production').android?.adaptiveIcon?.backgroundColor).toBe(light.brandStrong);
  });
});
