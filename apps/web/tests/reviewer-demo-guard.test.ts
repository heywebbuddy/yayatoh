import { describe, expect, it } from 'vitest';
import { checkDemoTarget, DemoRefused } from '../scripts/reviewer-demo-guard.ts';

const local = { DATABASE_URL: 'postgres://app_user:x@localhost:5432/yayatoh' };

describe('reviewer demo guard (M7.5a)', () => {
  it('accepts a local database', () => {
    expect(checkDemoTarget('local', local)).toEqual({ target: 'local', hosts: ['localhost'] });
    expect(
      checkDemoTarget('local', {
        DATABASE_URL: 'postgres://u:p@127.0.0.1/db',
        ADMIN_DATABASE_URL: 'postgres://u:p@postgres/db',
      }).hosts,
    ).toEqual(['127.0.0.1', 'postgres']);
  });

  it('refuses without an explicit target', () => {
    expect(() => checkDemoTarget(undefined, local)).toThrow(/--target=local or --target=staging/);
    expect(() => checkDemoTarget('production', local)).toThrow(DemoRefused);
  });

  it('refuses every way of saying production', () => {
    for (const env of [
      { YAYATOH_ENV: 'production' },
      { VERCEL_ENV: 'production' },
      { NODE_ENV: 'production' },
    ]) {
      expect(() => checkDemoTarget('local', { ...local, ...env })).toThrow(/production environment/);
      expect(() =>
        checkDemoTarget('staging', { ...local, ...env, REVIEWER_DEMO_HOSTS: 'localhost' }),
      ).toThrow(/production environment/);
    }
  });

  it('refuses a real payment provider', () => {
    expect(() => checkDemoTarget('local', { ...local, PAYMENTS_PROVIDER: 'stripe' })).toThrow(
      /fake provider only/,
    );
    expect(checkDemoTarget('local', { ...local, PAYMENTS_PROVIDER: 'fake' }).target).toBe('local');
  });

  it('refuses a remote database for --target=local, and names only the host', () => {
    const env = { DATABASE_URL: 'postgres://app_user:secret@db.example.com:5432/yayatoh' };
    expect(() => checkDemoTarget('local', env)).toThrow(/db\.example\.com/);
    try {
      checkDemoTarget('local', env);
    } catch (err) {
      expect((err as Error).message).not.toMatch(/secret|app_user|postgres:\/\//);
    }
  });

  it('refuses one remote host among local ones', () => {
    expect(() =>
      checkDemoTarget('local', {
        ...local,
        MIGRATOR_DATABASE_URL: 'postgres://m:p@prod-db.internal/yayatoh',
      }),
    ).toThrow(/prod-db\.internal/);
  });

  it('accepts a listed review-server database for --target=staging, and only that', () => {
    const env = {
      DATABASE_URL: 'postgres://u:p@review-db.internal:5432/yayatoh',
      REVIEWER_DEMO_HOSTS: 'review-db.internal, other.internal',
      YAYATOH_ENV: 'review',
    };
    expect(checkDemoTarget('staging', env).hosts).toEqual(['review-db.internal']);
    expect(() => checkDemoTarget('staging', { ...env, REVIEWER_DEMO_HOSTS: '' })).toThrow(
      /not listed in REVIEWER_DEMO_HOSTS/,
    );
    expect(() =>
      checkDemoTarget('staging', { ...env, DATABASE_URL: 'postgres://u:p@prod-db.internal/y' }),
    ).toThrow(/prod-db\.internal/);
    expect(() => checkDemoTarget('staging', { ...env, YAYATOH_ENV: undefined })).toThrow(/YAYATOH_ENV/);
  });

  it('refuses when no database is configured, or a URL cannot be read', () => {
    expect(() => checkDemoTarget('local', {})).toThrow(/no database URL/);
    expect(() => checkDemoTarget('local', { DATABASE_URL: 'not a url' })).toThrow(/cannot be read/);
  });
});
