/**
 * Connector-free builds (M7.x security review, `docs/ops/security-review-phase7.md` §7): with no
 * owner account behind them (no Sentry project, Google client ids, Firebase file, EAS project or
 * store keys) both apps still configure, build and run, and each connector is simply off. And the
 * repository carries no credential for any of them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildExpoConfig } from '../src/app-config';
import { initSentry, sentryEnabled } from '../src/platform/sentry';

const root = join(__dirname, '..', '..', '..');
const base = {
  splash: { light: 'l', dark: 'd' },
  adaptiveBackground: 'a',
  assets: { icon: './i.png', adaptiveForeground: './a.png', splash: './s.png' },
};
const build = (app: 'mobile' | 'staff', appEnv: string) =>
  buildExpoConfig({ ...base, app, env: { APP_ENV: appEnv } });

describe.each(['mobile', 'staff'] as const)('%s app with no connector configured', (app) => {
  it.each(['development', 'preview', 'production'])('%s: every connector is off, nothing throws', (appEnv) => {
    const c = build(app, appEnv);
    expect(c.extra).not.toHaveProperty('sentryDsn');
    expect(c.extra).not.toHaveProperty('googleIosClientId');
    expect(c.extra).not.toHaveProperty('googleAndroidClientId');
    expect(c.extra).not.toHaveProperty('eas');
    expect(c.owner).toBeUndefined();
    // No Firebase client file, so no Android push; no EAS project, so no over-the-air updates.
    expect(c.android).not.toHaveProperty('googleServicesFile');
    expect(c.updates).toEqual({ enabled: false });
    // One scheme: no Google redirect scheme without a Google client id.
    expect(typeof c.scheme).toBe('string');
  });

  it('keeps Sentry off without a DSN, and an invalid one', () => {
    const init = jest.fn();
    for (const dsn of [undefined, null, '', '   ', 'not-a-dsn', 'http://key@host/1']) {
      expect(initSentry({ dsn, environment: 'production' }, { init })).toBe(false);
      expect(sentryEnabled()).toBe(false);
    }
    expect(init).not.toHaveBeenCalled();
  });
});

describe('the repository holds no credential for a connector', () => {
  const CREDENTIAL_KEY = /pass(word|phrase)?|secret|token|private[-_]?key|keystore|api[-_]?key/i;
  const KEY_FILE = /\.(p8|p12|pem|jks|keystore|mobileprovision)$|service[-_]?account|google-services\.json/i;
  const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

  const walk = (value: unknown, visit: (key: string, v: unknown) => void, key = ''): void => {
    visit(key, value);
    if (Array.isArray(value)) for (const v of value) walk(v, visit, key);
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) walk(v, visit, k);
  };

  it.each(['apps/mobile/eas.json', 'apps/staff/eas.json'])('%s names profiles, never an account', (file) => {
    const json = JSON.parse(readFileSync(join(root, file), 'utf8')) as unknown;
    const found: string[] = [];
    walk(json, (key, v) => {
      if (CREDENTIAL_KEY.test(key)) found.push(`${file}: key ${key}`);
      if (typeof v === 'string' && (KEY_FILE.test(v) || PEM.test(v))) found.push(`${file}: value of ${key}`);
    });
    expect(found).toEqual([]);
  });

  it('the .env.example files list names only (commented, or the development environment)', () => {
    for (const app of ['mobile', 'staff']) {
      const file = join(root, 'apps', app, '.env.example');
      const lines = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#'));
      // The only live assignment is the build environment; every connector value stays commented.
      expect({ file, lines }).toEqual({ file, lines: ['APP_ENV=development'] });
    }
  });

  it('no app source file embeds a key, a DSN or a token', () => {
    const SECRETISH = [
      PEM,
      /https:\/\/[0-9a-f]{16,}@[^/\s]*sentry[^/\s]*\/\d+/i,
      /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/,
      /\bAIza[0-9A-Za-z_-]{30,}/,
      /\bexp[ot]_[A-Za-z0-9]{30,}/i,
    ];
    const files: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(tsx?|json|js|cjs|mjs)$/.test(name)) files.push(p);
      }
    };
    for (const dir of ['apps/mobile/src', 'apps/staff/src', 'packages/mobile-core/src'])
      if (existsSync(join(root, dir))) scan(join(root, dir));
    expect(files.length).toBeGreaterThan(50);
    const found = files.filter((f) => SECRETISH.some((re) => re.test(readFileSync(f, 'utf8'))));
    expect(found).toEqual([]);
  });
});
