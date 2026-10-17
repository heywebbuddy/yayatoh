import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { APPS, loadStore, productionConfig, REPO_ROOT, runChecks } from '../src/app.ts';
import { checkPrivacy, declaredPermissions, type Privacy, shippedDependencies } from '../src/privacy.ts';
import { clone } from './doc.ts';

describe.each(APPS)('%s privacy labels', (app) => {
  const privacy = loadStore(app).privacy;
  const dependencies = shippedDependencies(REPO_ROOT, app);
  const permissions = declaredPermissions(productionConfig(app) as Parameters<typeof declaredPermissions>[0]);
  const check = (
    p: Privacy = privacy,
    d: readonly string[] = dependencies,
    perms: readonly string[] = permissions,
  ) => checkPrivacy({ privacy: p, dependencies: d, permissions: perms });

  it('match the dependencies and permissions the app ships', () => {
    expect(runChecks(app).privacy).toEqual([]);
    expect(dependencies.length).toBeGreaterThan(20);
  });

  it('never says the app tracks', () => {
    expect(privacy.tracking).toBe(false);
  });

  it('fails when a dependency that collects data is added without a label change', () => {
    for (const lib of [
      '@segment/analytics-react-native',
      'react-native-mixpanel',
      '@react-native-firebase/analytics',
      'react-native-appsflyer',
    ]) {
      const errors = check(privacy, [...dependencies, lib]);
      expect(errors.join('\n'), lib).toContain(`dependency ${lib} is not reviewed`);
    }
  });

  it('fails when the data-collecting dependency is listed as collecting nothing', () => {
    const p = clone(privacy) as Privacy & {
      dependencies: Record<string, { collects: string[]; why: string }>;
    };
    p.dependencies['react-native-mixpanel'] = { collects: [], why: 'nothing' };
    const errors = check(p, [...dependencies, 'react-native-mixpanel']);
    expect(errors.join('\n')).toMatch(/react-native-mixpanel: the name suggests it collects data/);
  });

  it('fails when a known collector is removed without updating the labels', () => {
    const without = dependencies.filter((d) => d !== '@sentry/react-native');
    const errors = check(privacy, without).join('\n');
    expect(errors).toMatch(/dependencies\.@sentry\/react-native is no longer a dependency/);
    expect(errors).toMatch(
      /dataTypes\.crash_data: collected via @sentry\/react-native, which is no longer a dependency/,
    );
  });

  it('fails when a collector forgets what it is known to collect', () => {
    const p = clone(privacy) as Privacy & {
      dependencies: Record<string, { collects: string[]; why: string }>;
    };
    p.dependencies['expo-notifications'] = { collects: [], why: 'x' };
    expect(check(p).join('\n')).toMatch(/expo-notifications: is known to collect "device_id"/);
  });

  it('fails when a data type loses its label but a dependency still collects it', () => {
    const p = clone(privacy) as Privacy & { dataTypes: Record<string, unknown> };
    delete p.dataTypes.crash_data;
    expect(check(p).join('\n')).toMatch(/collects "crash_data", which has no label/);
  });

  it('fails when a new permission is declared or an old one dropped', () => {
    expect(
      check(privacy, dependencies, [...permissions, 'android:android.permission.RECORD_AUDIO']).join('\n'),
    ).toMatch(/permission android:android.permission.RECORD_AUDIO is not reviewed/);
    expect(check(privacy, dependencies, permissions.slice(1)).join('\n')).toMatch(
      /is no longer declared by app.config.ts/,
    );
  });

  it('fails on tracking and on an unknown store data type', () => {
    const p = clone(privacy) as { tracking: boolean; dataTypes: Record<string, { apple: string }> } & Privacy;
    p.tracking = true;
    const first = Object.values(p.dataTypes)[0];
    if (first) first.apple = 'Contacts / Everything';
    const errors = check(p).join('\n');
    expect(errors).toMatch(/tracking must be false/);
    expect(errors).toMatch(/is not an App Store data type/);
  });
});

describe('what each app declares (the labels follow the SDKs, not the other way round)', () => {
  it('the attendee app asks for coarse location, calendar write-only and notifications, never the camera', () => {
    const perms = declaredPermissions(
      productionConfig('mobile') as Parameters<typeof declaredPermissions>[0],
    );
    expect(perms).toEqual(
      expect.arrayContaining([
        'ios:NSLocationWhenInUseUsageDescription',
        'ios:NSCalendarsWriteOnlyAccessUsageDescription',
        'android:android.permission.ACCESS_COARSE_LOCATION',
        'android:android.permission.POST_NOTIFICATIONS',
      ]),
    );
    expect(perms.join()).not.toMatch(/CAMERA/);
  });

  it('the Staff app asks for the camera and nothing else', () => {
    expect(
      declaredPermissions(productionConfig('staff') as Parameters<typeof declaredPermissions>[0]),
    ).toEqual(['android:android.permission.CAMERA', 'ios:NSCameraUsageDescription']);
  });

  it('only the Staff app ships the camera and the encrypted database', () => {
    expect(shippedDependencies(REPO_ROOT, 'staff')).toEqual(
      expect.arrayContaining(['react-native-vision-camera', 'expo-sqlite', 'expo-battery']),
    );
    expect(shippedDependencies(REPO_ROOT, 'mobile')).not.toContain('react-native-vision-camera');
    expect(shippedDependencies(REPO_ROOT, 'mobile')).toContain('expo-location');
    expect(shippedDependencies(REPO_ROOT, 'staff')).not.toContain('expo-location');
  });

  it('follows workspace packages but not the web UI package (tokens only)', () => {
    const deps = shippedDependencies(REPO_ROOT, 'mobile');
    expect(deps).toContain('@sentry/react-native'); // from @yayatoh/mobile-core
    expect(deps).toContain('openapi-fetch'); // from @yayatoh/sdk
    expect(deps).not.toContain('tailwindcss');
    expect(deps.some((d) => d.startsWith('@yayatoh/'))).toBe(false);
  });
});

describe('privacy:check as the owner runs it', () => {
  // A copy of the repo's package.json files and store folders, so a test can edit a dependency list.
  const root = mkdtempSync(join(tmpdir(), 'store-kit-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  for (const parent of ['packages', 'apps', 'tools']) {
    for (const entry of readdirSync(join(REPO_ROOT, parent))) {
      const pkg = join(REPO_ROOT, parent, entry, 'package.json');
      if (!existsSync(pkg)) continue;
      mkdirSync(join(root, parent, entry), { recursive: true });
      cpSync(pkg, join(root, parent, entry, 'package.json'));
    }
  }
  for (const app of APPS)
    cpSync(join(REPO_ROOT, 'apps', app, 'store'), join(root, 'apps', app, 'store'), { recursive: true });

  const run = (app: string) => {
    try {
      const out = execFileSync('node', [join(REPO_ROOT, 'tools/store-kit/cli.ts'), 'privacy', '--app', app], {
        env: { ...process.env, STORE_KIT_ROOT: root },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (err) {
      const e = err as { status: number; stderr: string };
      return { code: e.status, out: e.stderr };
    }
  };

  it('passes on the repository as it is', () => {
    expect(run('mobile')).toEqual({ code: 0, out: 'ok   mobile privacy\n' });
    expect(run('staff').code).toBe(0);
  });

  it('exits 1 and names the library when a data-collecting dependency is added', () => {
    const file = join(root, 'apps/mobile/package.json');
    const original = readFileSync(file, 'utf8');
    const pkg = JSON.parse(original);
    pkg.dependencies['@segment/analytics-react-native'] = '2.0.0';
    writeFileSync(file, JSON.stringify(pkg));
    const result = run('mobile');
    writeFileSync(file, original);
    expect(result.code).toBe(1);
    expect(result.out).toContain('dependency @segment/analytics-react-native is not reviewed');
    expect(run('mobile').code).toBe(0);
  });

  it('exits 1 when a labelled dependency is removed', () => {
    const file = join(root, 'apps/staff/package.json');
    const original = readFileSync(file, 'utf8');
    const pkg = JSON.parse(original);
    delete pkg.dependencies['expo-battery'];
    writeFileSync(file, JSON.stringify(pkg));
    const result = run('staff');
    writeFileSync(file, original);
    expect(result.code).toBe(1);
    expect(result.out).toContain('dependencies.expo-battery is no longer a dependency');
  });
});
