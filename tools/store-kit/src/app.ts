/** Loads one app's store files from the repository (`apps/<app>/store/*`) and its production config. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExpoConfig } from '@yayatoh/mobile-core/app-config';
import { checkCompliance, MOBILE_GUIDELINES, STAFF_GUIDELINES } from './compliance.ts';
import { checkApple, checkPlay } from './files.ts';
import { checkPrivacy, declaredPermissions, type Privacy, shippedDependencies } from './privacy.ts';
import { checkScreenshotPlan, type ScreenshotPlan } from './screenshots.ts';

export const APPS = ['mobile', 'staff'] as const;
export type App = (typeof APPS)[number];

/** The repository root; `STORE_KIT_ROOT` points the kit at a copy (tests) instead. */
export const REPO_ROOT =
  process.env.STORE_KIT_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const readJson = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** The production Expo config of an app (what the stores see); assets and colours are placeholders. */
export function productionConfig(app: App) {
  return buildExpoConfig({
    app,
    env: { APP_ENV: 'production' },
    splash: { light: '#ffffff', dark: '#000000' },
    adaptiveBackground: '#ffffff',
    assets: { icon: './i.png', adaptiveForeground: './a.png', splash: './s.png' },
  });
}

export const storeDir = (app: App, root = REPO_ROOT) => join(root, 'apps', app, 'store');

export function loadStore(app: App, root = REPO_ROOT) {
  const dir = storeDir(app, root);
  return {
    dir,
    apple: readJson<unknown>(join(dir, 'store.config.json')),
    play: readJson<unknown>(join(dir, 'play.json')),
    privacy: readJson<Privacy>(join(dir, 'privacy.json')),
    compliance: readJson<unknown>(join(dir, 'compliance.json')),
    screenshots: readJson<ScreenshotPlan>(join(dir, 'screenshots.json')),
  };
}

export function runChecks(app: App, root = REPO_ROOT): Record<string, string[]> {
  const s = loadStore(app, root);
  const config = productionConfig(app);
  const appDir = join(root, 'apps', app);
  const notes = (s.apple as { apple?: { review?: { notes?: string } } }).apple?.review?.notes ?? '';
  return {
    listing: [...checkApple(s.apple), ...checkPlay(s.play)],
    privacy: checkPrivacy({
      privacy: s.privacy,
      dependencies: shippedDependencies(root, app),
      permissions: declaredPermissions(config as Parameters<typeof declaredPermissions>[0]),
    }),
    compliance: checkCompliance({
      compliance: s.compliance,
      reviewNotes: notes,
      configUsesNonExemptEncryption: (
        config.ios as { config?: { usesNonExemptEncryption?: boolean } } | undefined
      )?.config?.usesNonExemptEncryption,
      requiredGuidelines: app === 'mobile' ? MOBILE_GUIDELINES : STAFF_GUIDELINES,
    }),
    screenshots: checkScreenshotPlan({
      plan: s.screenshots,
      exists: (p) => existsSync(join(appDir, p)),
      read: (p) => (existsSync(join(appDir, p)) ? readFileSync(join(appDir, p), 'utf8') : null),
      supportsTablet: config.ios?.supportsTablet === true,
    }),
  };
}
