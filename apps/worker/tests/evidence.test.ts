import { describe, expect, it } from 'vitest';
import { assertLocalDatabase, parseSampleArgs, SEEDED_ORG_SLUGS } from '../src/evidence.ts';

const LOCAL = {
  DATABASE_URL: 'postgres://app_user:x@localhost:5432/yayatoh',
  PLATFORM_READER_DATABASE_URL: 'postgres://platform_reader:x@127.0.0.1:5432/yayatoh',
};
const REMOTE = {
  ...LOCAL,
  PLATFORM_READER_DATABASE_URL: 'postgres://platform_reader:x@ep-prod.neon.tech/db',
};

describe('evidence audit sampler arguments (M5.11a)', () => {
  it('CI mode samples the seeded orgs of a local database', () => {
    expect(parseSampleArgs(['--', '--out', 'x.json'], LOCAL)).toEqual({
      out: 'x.json',
      production: false,
      slugs: [...SEEDED_ORG_SLUGS],
      perOrg: 25,
    });
  });

  it('refuses a non-local database without the owner production flag', () => {
    expect(() => parseSampleArgs(['--out', 'x.json'], REMOTE)).toThrow(/only against a local or CI database/);
    expect(() => assertLocalDatabase(['postgres://u:p@db.internal:5432/x'])).toThrow(/db\.internal/);
    expect(() => assertLocalDatabase(['postgres://u:p@postgres:5432/x', undefined])).not.toThrow();
  });

  it('refuses to pick orgs outside production mode', () => {
    expect(() => parseSampleArgs(['--out', 'x.json', '--orgs', 'acme'], LOCAL)).toThrow(
      /only for --production/,
    );
  });

  it('production mode needs the owner confirmation and an explicit org list', () => {
    expect(() => parseSampleArgs(['--out', 'x.json', '--production', '--orgs', 'acme'], REMOTE)).toThrow(
      /EVIDENCE_PRODUCTION_READ=owner-approved/,
    );
    const env = { ...REMOTE, EVIDENCE_PRODUCTION_READ: 'owner-approved' };
    expect(() => parseSampleArgs(['--out', 'x.json', '--production'], env)).toThrow(/needs --orgs/);
    expect(
      parseSampleArgs(['--out', 'x.json', '--production', '--orgs', 'acme, beta', '--per-org', '10'], env),
    ).toEqual({ out: 'x.json', production: true, slugs: ['acme', 'beta'], perOrg: 10 });
  });

  it('requires --out and bounds --per-org', () => {
    expect(() => parseSampleArgs([], LOCAL)).toThrow(/--out/);
    expect(() => parseSampleArgs(['--out', 'x', '--per-org', '500'], LOCAL)).toThrow(/1–100/);
  });
});
