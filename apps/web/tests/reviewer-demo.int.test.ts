import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePools } from '@yayatoh/db/testing';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The reviewer demo script (M7.5a) as the owner runs it: a real process against the test database.
 * It must create the demo once, change nothing the second time, and refuse production.
 */
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const REMOVED = new Set(['PAYMENTS_PROVIDER', 'YAYATOH_ENV', 'VERCEL_ENV', 'NODE_ENV']);
const env: Record<string, string> = {
  ...(Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && !REMOVED.has(k)),
  ) as Record<string, string>),
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? randomBytes(32).toString('hex'),
  LOCAL_KMS_KEY: process.env.LOCAL_KMS_KEY ?? randomBytes(32).toString('hex'),
  APP_TOKEN_SECRET: process.env.APP_TOKEN_SECRET ?? randomBytes(32).toString('hex'),
  BETTER_AUTH_URL: 'http://localhost:3100',
  REVIEWER_DEMO_EMAIL: 'app-review@yayatoh.test',
  REVIEWER_DEMO_CODE: '424242',
};

const run = (args: string[], extra: Record<string, string> = {}): SpawnSyncReturns<string> =>
  spawnSync('node', ['--conditions=react-server', 'scripts/reviewer-demo.ts', ...args], {
    cwd: web,
    env: { ...env, ...extra } as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 120_000,
  });
const json = (r: SpawnSyncReturns<string>) => JSON.parse(r.stdout);

afterAll(closePools);

describe('pnpm reviewer-demo', () => {
  it('creates the demo, and a second run changes nothing', () => {
    const first = run(['--target=local']);
    expect(first.status, first.stderr).toBe(0);
    const a = json(first);
    expect(a.organization).toBe('app-review-demo');
    expect(a.event.slug).toBe('app-review-concert');
    expect(a.attendee.ticketShortCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(a.attendee.codeIsFixedOnThisServer).toBe(true);
    expect(a.staff.doorTickets).toHaveLength(3);

    const second = run(['--target=local']);
    expect(second.status, second.stderr).toBe(0);
    const b = json(second);
    // The same event, the same tickets, and nothing issued, created or enrolled again.
    expect(b.event).toEqual(a.event);
    expect(b.attendee.ticketShortCode).toBe(a.attendee.ticketShortCode);
    expect(b.staff.doorTickets).toEqual(a.staff.doorTickets);
    expect(second.stderr).not.toMatch(/created|issued|enrolled|rotated/);
    // The door's enrolment token is shown once; the second run keeps the device and prints no link.
    if (a.staff.enrolLink) {
      expect(a.staff.enrolLink).toMatch(/\/scan#e=[0-9a-f-]{36}&k=yyd_[A-Za-z0-9_-]{43}$/);
      expect(b.staff.enrolLink).toBeNull();
    }
  }, 240_000);

  it('rotates the door device on request: a new link, the same tickets', () => {
    const before = json(run(['--target=local']));
    const rotated = run(['--target=local', '--rotate-door']);
    expect(rotated.status, rotated.stderr).toBe(0);
    const after = json(rotated);
    expect(after.staff.enrolLink).toMatch(/k=yyd_/);
    expect(after.staff.doorTickets).toEqual(before.staff.doorTickets);
    expect(json(run(['--target=local'])).staff.enrolLink).toBeNull();
  }, 240_000);

  it('refuses production, a real payment provider, a remote database and a missing target', () => {
    const cases: [string[], Record<string, string>, RegExp][] = [
      [['--target=local'], { YAYATOH_ENV: 'production' }, /production environment/],
      [['--target=local'], { VERCEL_ENV: 'production' }, /production environment/],
      [['--target=local'], { PAYMENTS_PROVIDER: 'stripe' }, /fake provider only/],
      [['--target=local'], { DATABASE_URL: 'postgres://u:p@db.example.com/yayatoh' }, /db\.example\.com/],
      [['--target=staging'], { YAYATOH_ENV: 'review' }, /not listed in REVIEWER_DEMO_HOSTS/],
      [[], {}, /--target=local or --target=staging/],
    ];
    for (const [args, extra, message] of cases) {
      const r = run(args, extra);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr).toMatch(message);
      expect(r.stdout).toBe('');
    }
  }, 120_000);
});
