import { describe, expect, it } from 'vitest';
import { checkTarget, TargetRefused } from '../src/target.ts';

const LOCAL = {
  MIGRATOR_DATABASE_URL: 'postgres://migrator:x@localhost:5432/yayatoh',
  DATABASE_URL: 'postgres://app_user:x@127.0.0.1:5432/yayatoh',
};

describe('cutover target guard (M2.5a)', () => {
  it('refuses anything but local or staging, and says a dry run needs no target', () => {
    for (const t of [undefined, 'production', 'prod', 'LOCAL', '', 'staging2']) {
      expect(() => checkTarget(t, LOCAL)).toThrow(TargetRefused);
    }
    expect(() => checkTarget(undefined, LOCAL)).toThrow(/dry run/);
  });

  it('local: only local database hosts; --yes allowed', () => {
    expect(checkTarget('local', LOCAL, { yes: true })).toEqual({
      target: 'local',
      hosts: ['localhost', '127.0.0.1'],
      autoConfirm: true,
    });
    expect(checkTarget('local', { DATABASE_URL: 'postgres://u:p@postgres:5432/db' }).hosts).toEqual([
      'postgres',
    ]);
    expect(() =>
      checkTarget('local', { ...LOCAL, ADMIN_DATABASE_URL: 'postgres://u:p@db.prod.example.com:5432/y' }),
    ).toThrow(/db\.prod\.example\.com/);
  });

  it('staging: only hosts listed in CUTOVER_STAGING_HOSTS; never --yes; never localhost unless listed', () => {
    const env = {
      MIGRATOR_DATABASE_URL: 'postgres://m:p@staging-db.example.test:5432/y',
      CUTOVER_STAGING_HOSTS: 'staging-db.example.test, other.example.test',
    };
    expect(checkTarget('staging', env)).toMatchObject({
      target: 'staging',
      hosts: ['staging-db.example.test'],
    });
    expect(() => checkTarget('staging', env, { yes: true })).toThrow(
      /--yes is allowed for --target=local only/,
    );
    expect(() => checkTarget('staging', { ...env, CUTOVER_STAGING_HOSTS: '' })).toThrow(/not listed/);
    expect(() => checkTarget('staging', LOCAL)).toThrow(/not listed/);
  });

  it('refuses production markers, a live payment provider, and no database at all', () => {
    expect(() => checkTarget('local', { ...LOCAL, VERCEL_ENV: 'production' })).toThrow(/production/);
    expect(() => checkTarget('local', { ...LOCAL, NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => checkTarget('local', { ...LOCAL, PAYMENTS_PROVIDER: 'stripe' })).toThrow(
      /fake provider only/,
    );
    expect(() => checkTarget('local', {})).toThrow(/no database URL/);
  });

  it('never echoes a password', () => {
    try {
      checkTarget('local', { DATABASE_URL: 'postgres://u:supersecret@evil.example:5432/y' });
    } catch (err) {
      expect(String(err)).not.toContain('supersecret');
    }
  });
});
