import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPS, productionConfig, REPO_ROOT } from '../src/app.ts';
import type { Doc } from './doc.ts';

const eas = (app: string): Doc => JSON.parse(readFileSync(join(REPO_ROOT, 'apps', app, 'eas.json'), 'utf8'));

describe.each(APPS)('%s eas.json (P7-9)', (app) => {
  const file = eas(app);

  it('has development, preview and production builds, each with its own channel and environment name', () => {
    for (const name of ['development', 'preview', 'production']) {
      const b = file.build[name];
      expect(b, name).toBeDefined();
      expect(b.channel).toBe(name);
      expect(b.environment).toBe(name);
      expect(b.env.APP_ENV).toBe(name);
    }
  });

  it('builds production for the stores with an automatic build number', () => {
    expect(file.build.production.distribution).toBe('store');
    expect(file.build.production.autoIncrement).toBe(true);
    expect(file.cli.appVersionSource).toBe('remote');
  });

  it('keeps the over-the-air runtime version a fingerprint, so an update only reaches builds it fits', () => {
    expect(productionConfig(app).runtimeVersion).toEqual({ policy: 'fingerprint' });
  });

  it('has the four submit profiles: TestFlight, Play internal, Play closed, production', () => {
    expect(Object.keys(file.submit).sort()).toEqual([
      'play-closed',
      'play-internal',
      'production',
      'testflight',
    ]);
    expect(file.submit.testflight.ios).toBeDefined();
    expect(file.submit['play-internal'].android).toMatchObject({ track: 'internal' });
    expect(file.submit['play-closed'].android).toMatchObject({ track: 'alpha' });
  });

  it('releases to production in stages on Play, never at 100% at once', () => {
    const android = file.submit.production.android;
    expect(android.track).toBe('production');
    expect(android.releaseStatus).toBe('inProgress');
    expect(android.rollout).toBeGreaterThan(0);
    expect(android.rollout).toBeLessThanOrEqual(0.1);
  });

  it('points the iOS metadata at the rendered listing, which store:render writes', () => {
    expect(file.submit.production.ios.metadataPath).toBe('./store/dist/store.config.json');
    expect(file.submit.testflight.ios.metadataPath).toBe('./store/dist/store.config.json');
  });

  it('holds no account value: no app id, team id, key path, password or token', () => {
    const text = JSON.stringify(file);
    expect(text).not.toMatch(
      /ascAppId|appleId|appleTeamId|serviceAccountKeyPath|ascApiKey|password|secret|token|\.p8|\.json"?\s*:\s*"[^"]*api-/i,
    );
    expect(text).not.toMatch(/[A-Z0-9]{10}\b.*teamId/);
  });
});

describe('the two apps release the same way', () => {
  it('have the same eas.json', () => {
    expect(eas('staff')).toEqual(eas('mobile'));
  });
});
