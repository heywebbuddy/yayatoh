import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const CLI = new URL('../cli.ts', import.meta.url).pathname;
const FIXTURE = new URL('./fixtures/legacy-synthetic.sql', import.meta.url).pathname;
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('legacy-mask CLI (what the owner runs next to the dump)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-mask-'));
  const key = join(dir, 'mask.key');

  it('keygen writes a private 32-byte key and never overwrites one', () => {
    expect(run('keygen', '--out', key).status).toBe(0);
    expect(readFileSync(key, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(key).mode & 0o777).toBe(0o600);
    const again = run('keygen', '--out', key);
    expect(again.status).not.toBe(0);
    expect(again.stderr).toMatch(/refusing to overwrite/);
  });

  it('mask → verify on a plain dump: OK, report written, output private', () => {
    const out = join(dir, 'masked.sql');
    const report = join(dir, 'report.json');
    const m = run('mask', '--in', FIXTURE, '--out', out, '--key-file', key, '--report', report);
    expect(m.status, m.stderr).toBe(0);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(report, 'utf8')).tables.users.rowsOut).toBe(4);
    const v = run('verify', '--original', FIXTURE, '--masked', out);
    expect(v.status, v.stderr).toBe(0);
    expect(v.stdout).toMatch(/verify: OK/);
  });

  it('reads and writes .sql.gz (dumps are usually compressed)', () => {
    const gzIn = join(dir, 'dump.sql.gz');
    writeFileSync(gzIn, gzipSync(readFileSync(FIXTURE)));
    const gzOut = join(dir, 'masked.sql.gz');
    expect(run('mask', '--in', gzIn, '--out', gzOut, '--key-file', key).status).toBe(0);
    const text = gunzipSync(readFileSync(gzOut)).toString('utf8');
    expect(text).toContain('CREATE TABLE `users`');
    expect(text).not.toContain('priya.fictional@example.org');
    expect(run('verify', '--original', gzIn, '--masked', gzOut).status).toBe(0);
  });

  it('refuses to overwrite the output or the input, and fails verify on a leak', () => {
    const out = join(dir, 'masked.sql');
    expect(run('mask', '--in', FIXTURE, '--out', out, '--key-file', key).stderr).toMatch(
      /refusing to overwrite/,
    );
    expect(run('mask', '--in', FIXTURE, '--out', FIXTURE, '--key-file', key).stderr).toMatch(/must differ/);
    const leaky = join(dir, 'leaky.sql');
    writeFileSync(
      leaky,
      readFileSync(out, 'utf8').replace(/u\.[0-9a-f]{12}@masked\.yayatoh\.test/, 'omar@example.net'),
    );
    const v = run('verify', '--original', FIXTURE, '--masked', leaky);
    expect(v.status).toBe(1);
    expect(v.stderr).toMatch(/FAILED/);
  });
});
