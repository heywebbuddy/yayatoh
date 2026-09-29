import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closePools, withoutTenant } from '@yayatoh/db';
import { localKeyVault, readOnlyFreeze, setKeyVault } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { realDeps } from '../src/deps.ts';
import { rehearse } from '../src/rehearse.ts';

/**
 * M2.5a rehearsal R2 end to end on the synthetic legacy dataset, against the real database: both
 * instances (yay then abc) through every cutover step, then the yay rollback after a post-cutover
 * SCT sale and scan, with the refund through the fake provider. Timed reports; flags cleared after.
 */
const dir = mkdtempSync(join(tmpdir(), 'cutover-rehearsal-'));
// The legacy suites share the synthetic orgs in the test database: one fixed test vault for all of
// them (as tools/legacy-migrate/tests/migrate.int.test.ts; batch 3c merge).
setKeyVault(localKeyVault('5e'.repeat(32)));

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePools();
});

describe('rehearsal R2 (M2.5a)', () => {
  it('passes for both instances within the windows, rolls yay back with the SCT refund, and leaves no flag set', async () => {
    const lines: string[] = [];
    const r = await rehearse({
      rehearsal: 'R2',
      deps: realDeps({ scale: 'small', log: () => {} }),
      target: 'local',
      confirm: async () => 'run',
      reportDir: dir,
      baseUrl: null,
      log: (m) => void lines.push(m),
    });
    const failed = r.reports.flatMap((x) =>
      x.steps.filter((s) => s.status !== 'done').map((s) => `${x.instance} ${s.id}: ${s.summary}`),
    );
    expect(failed).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.reports.map((x) => x.instance)).toEqual(['yay', 'abc']);
    const yay = r.reports[0];
    expect(yay?.flippedAt).not.toBeNull();
    expect(yay?.verdicts.map((v) => [v.id, v.pass])).toEqual([
      ['forward', true],
      ['freeze_window', true],
      ['rehearsal_share', true],
      ['rollback', true],
    ]);
    expect(yay?.steps.find((s) => s.id === 'refund_sct')?.summary).toBe('1 refunded, 0 planned');
    expect(yay?.projectedRollbackMs).toBeLessThanOrEqual(15 * 60_000);
    expect(r.reports[1]?.steps.some((s) => s.track === 'abort')).toBe(false);

    // Timed reports on disk, the MySQL rollback script too.
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toMatch(
      /^# R2 — at parity, timed, with rollback: PASS/,
    );
    expect(readFileSync(join(dir, 'yay.md'), 'utf8')).toContain('| abort | refund_sct | done |');
    expect(readFileSync(join(dir, 'yay-rollback.sql'), 'utf8')).toContain('INSERT INTO `bookings`');

    // Nothing left switched on.
    expect(await readOnlyFreeze()).toBeNull();
    const routes = await withoutTenant((tx) =>
      tx.execute<{ r: string | null }>(
        sql`select platform.host_route('yayatoh.com') as r union all select platform.host_route('abc.yayatoh.com')`,
      ),
    );
    expect(routes.map((x) => x.r)).toEqual([null, null]);
  }, 600_000);
});
