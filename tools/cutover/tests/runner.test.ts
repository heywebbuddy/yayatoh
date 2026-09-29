import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReport, newState, runTrack } from '../src/runner.ts';
import { abortSteps, FORWARD_STEPS } from '../src/steps.ts';
import type { Confirm, CutoverContext, CutoverDeps, CutoverState, Instance } from '../src/types.ts';

/** A controllable world: a clock, call log, and failures to inject. */
function fakeWorld(opts: { failElt?: number; clockStepMs?: number } = {}) {
  const calls: string[] = [];
  let t = Date.parse('2026-11-04T07:00:00Z');
  let eltFailures = opts.failElt ?? 0;
  const flags: Record<string, unknown> = {};
  /** Log the call, answer the value. */
  const call = <T>(name: string, value: T): T => {
    calls.push(name);
    return value;
  };
  const deps: CutoverDeps = {
    now: () => {
      t += opts.clockStepMs ?? 1000;
      return new Date(t);
    },
    migrationStatus: async () => call('migrationStatus', { files: 70, applied: 70, pending: 0 }),
    latestRun: async () => call('latestRun', { id: 1, pass: true, mode: 'rehearsal' }),
    eventsNearWindow: async () => call('eventsNearWindow', []),
    hostRoutes: async () => call('hostRoutes', {}),
    commsReady: async () => call('commsReady', { kinds: 10, locales: 13, missing: [] }),
    prepareDump: async () => call('prepareDump', '/tmp/synthetic.sql.gz'),
    runElt: async () => {
      calls.push('runElt');
      if (eltFailures > 0) {
        eltFailures--;
        throw new Error('connection reset');
      }
      return { pass: true, summary: 'ok', runId: 7, totalMs: 1200 };
    },
    revalidate: async () => call('revalidate', { pass: true, summary: 'ok' }),
    freezeProbe: async () => call('freezeProbe', { pass: true, tables: {} }),
    instanceOrgIds: async () => call('instanceOrgIds', ['01900000-0000-7000-8000-000000000001']),
    setFreeze: async (value) => {
      calls.push(`setFreeze:${value ? value.scope : 'off'}`);
      flags.read_only_freeze = value;
    },
    setHostRoute: async (host, target) => {
      calls.push(`setHostRoute:${host}:${target}`);
      flags[`host_route:${host}`] = target;
    },
    smoke: async () => call('smoke', { checks: [{ name: 'x', ok: true, detail: '' }] }),
    reverseEtl: async () => call('reverseEtl', { pass: true, summary: 'ok', report: {} }),
    rollbackSql: async () => call('rollbackSql', '-- sql'),
    rollbackRefunds: async (_i, _c, orderIds) =>
      call(`rollbackRefunds:${orderIds?.join(',') ?? 'plan'}`, {
        items: (orderIds ?? []).map((orderId) => ({ orderId, status: 'succeeded', amountMinor: 100 })),
      }),
    simulatePostCutover: async () => call('simulate', { orderIds: ['o1'], scans: 1 }),
    writeFile: async (path) => void calls.push(`writeFile:${path}`),
  };
  return { deps, calls, flags };
}

function ctxFor(deps: CutoverDeps, instance: Instance = 'yay', state?: CutoverState): CutoverContext {
  return {
    instance,
    mode: 'rehearsal',
    state: state ?? newState(instance, 'rehearsal', 'T', new Date('2026-11-04T06:00:00Z')),
    deps,
    options: { hosts: ['yayatoh.com'], baseUrl: null, dump: null, operator: 'test', reportDir: '/tmp/r' },
    log: () => {},
  };
}
const yes: Confirm = async () => 'run';

describe('cutover orchestrator (M2.5a)', () => {
  it('follows roadmap §7.8 in order: freeze, final ELT, checks, go/no-go, smoke, flip, unfreeze', () => {
    expect(FORWARD_STEPS.map((s) => s.id)).toEqual([
      'preflight',
      'comms_freeze_start',
      'freeze_legacy',
      'freeze_new_app',
      'final_dump',
      'delta_elt',
      'verify_legacy_freeze',
      'golden_checks',
      'go_no_go_1',
      'media_delta',
      'smoke',
      'go_no_go_2',
      'switch_routing',
      'unfreeze_new_app',
      'comms_freeze_end',
    ]);
  });

  it('runs every step once in order, flips the route and records timings and a passing report', async () => {
    const w = fakeWorld();
    const ctx = ctxFor(w.deps);
    const saves: number[] = [];
    const out = await runTrack({
      steps: FORWARD_STEPS,
      ctx,
      track: 'forward',
      dryRun: false,
      confirm: yes,
      save: async (s) => void saves.push(Object.keys(s.tracks.forward).length),
    });
    expect(out).toEqual({ status: 'completed' });
    expect(saves).toHaveLength(FORWARD_STEPS.length);
    const order = w.calls.filter((c) =>
      /^(setFreeze|runElt|freezeProbe|revalidate|smoke|setHostRoute)/.test(c),
    );
    expect(order).toEqual([
      'setFreeze:platform',
      'runElt',
      'freezeProbe',
      'revalidate',
      'smoke',
      'setHostRoute:yayatoh.com:next',
      'setFreeze:off',
    ]);
    expect(w.flags).toEqual({ read_only_freeze: null, 'host_route:yayatoh.com': 'next' });
    expect(ctx.state.freezeAt).not.toBeNull();
    expect(ctx.state.flippedAt).not.toBeNull();
    for (const s of FORWARD_STEPS) expect(ctx.state.tracks.forward[s.id]?.ms).toBeGreaterThan(0);
    const report = buildReport(ctx.state, FORWARD_STEPS, []);
    expect(report.pass).toBe(true);
    // Manual and decision steps count at their budgets in a rehearsal: 21 min of the window.
    expect(report.projectedFreezeWindowMs).toBeGreaterThan(21 * 60_000);
    expect(report.verdicts.map((v) => v.id)).toEqual(['forward', 'freeze_window', 'rehearsal_share']);
    expect(report.verdicts.find((v) => v.id === 'freeze_window')?.detail).toMatch(
      /with the manual steps at their budgets \(measured/,
    );
  });

  it('resumes after a failure: done steps are skipped, the failed step runs again', async () => {
    const w = fakeWorld({ failElt: 1 });
    const ctx = ctxFor(w.deps);
    const run = () =>
      runTrack({
        steps: FORWARD_STEPS,
        ctx,
        track: 'forward',
        dryRun: false,
        confirm: yes,
        save: async () => {},
      });
    expect(await run()).toEqual({ status: 'failed', stoppedAt: 'delta_elt' });
    expect(ctx.state.tracks.forward.delta_elt).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'connection reset',
    });
    const freezeAt = ctx.state.freezeAt;
    expect(await run()).toEqual({ status: 'completed' });
    expect(w.calls.filter((c) => c === 'migrationStatus')).toHaveLength(1);
    expect(w.calls.filter((c) => c === 'setFreeze:platform')).toHaveLength(1);
    expect(w.calls.filter((c) => c === 'runElt')).toHaveLength(2);
    expect(ctx.state.tracks.forward.delta_elt).toMatchObject({ status: 'done', attempts: 2 });
    // T−0 is not moved by the resume.
    expect(ctx.state.freezeAt).toBe(freezeAt);
  });

  it('pauses when the operator does not type the confirmation, and resumes there', async () => {
    const w = fakeWorld();
    const ctx = ctxFor(w.deps);
    const stopAt: Confirm = async (step) => (step.id === 'switch_routing' ? 'stop' : 'run');
    const snapshots: CutoverState[] = [];
    const out = await runTrack({
      steps: FORWARD_STEPS,
      ctx,
      track: 'forward',
      dryRun: false,
      confirm: stopAt,
      save: async (s) => {
        snapshots.push(structuredClone(s));
      },
    });
    expect(out).toEqual({ status: 'paused', stoppedAt: 'switch_routing' });
    expect(w.calls.some((c) => c.startsWith('setHostRoute'))).toBe(false);
    const saved = snapshots.at(-1);
    expect(saved?.tracks.forward.go_no_go_2?.status).toBe('done');
    const resumed = ctxFor(w.deps, 'yay', saved);
    expect(
      await runTrack({
        steps: FORWARD_STEPS,
        ctx: resumed,
        track: 'forward',
        dryRun: false,
        confirm: yes,
        save: async () => {},
      }),
    ).toEqual({ status: 'completed' });
    expect(w.calls.filter((c) => c === 'runElt')).toHaveLength(1);
  });

  it('a dry run prints the plan and calls nothing, saves nothing', async () => {
    const w = fakeWorld();
    const lines: string[] = [];
    const ctx = { ...ctxFor(w.deps), log: (m: string) => void lines.push(m) };
    let saves = 0;
    const out = await runTrack({
      steps: [...FORWARD_STEPS],
      ctx,
      track: 'forward',
      dryRun: true,
      confirm: async () => {
        throw new Error('a dry run never asks');
      },
      save: async () => void saves++,
    });
    expect(out).toEqual({ status: 'planned' });
    expect(w.calls).toEqual([]);
    expect(saves).toBe(0);
    expect(ctx.state.tracks.forward).toEqual({});
    expect(lines.join('\n')).toContain('host_route:yayatoh.com → next');
    expect(lines.join('\n')).toContain('dry run');
  });

  it('go/no-go says no-go at the 90 min abort threshold', async () => {
    const w = fakeWorld({ clockStepMs: 8 * 60_000 });
    const ctx = ctxFor(w.deps);
    const out = await runTrack({
      steps: FORWARD_STEPS,
      ctx,
      track: 'forward',
      dryRun: false,
      confirm: yes,
      save: async () => {},
    });
    expect(out.status).toBe('failed');
    expect(['go_no_go_1', 'go_no_go_2']).toContain(out.stoppedAt);
    expect(ctx.state.tracks.forward[out.stoppedAt ?? '']?.summary).toMatch(/abort at 90/);
    expect(w.calls.some((c) => c.startsWith('setHostRoute'))).toBe(false);
  });

  it('B-A freezes only the imported orgs, never the platform', async () => {
    const w = fakeWorld();
    const ctx = ctxFor(w.deps, 'abc');
    await runTrack({
      steps: FORWARD_STEPS,
      ctx,
      track: 'forward',
      dryRun: false,
      confirm: yes,
      save: async () => {},
    });
    expect(w.calls).not.toContain('setFreeze:platform');
    expect(w.calls).toContain('setFreeze:orgs');
  });

  it('abort before the flip backs out; after the flip it rolls back with the reverse ETL and the SCT refund', async () => {
    const w = fakeWorld();
    const ctx = ctxFor(w.deps);
    expect(abortSteps(ctx).map((s) => s.id)).toEqual([
      'route_back',
      'lift_new_freeze',
      'unfreeze_legacy',
      'comms_rollback',
    ]);
    await runTrack({
      steps: FORWARD_STEPS,
      ctx,
      track: 'forward',
      dryRun: false,
      confirm: yes,
      save: async () => {},
    });
    ctx.state.facts.simulatedOrders = ['o1'];
    const steps = abortSteps(ctx);
    expect(steps.map((s) => s.id)).toEqual([
      'freeze_instance',
      'reverse_etl',
      'apply_mysql',
      'route_back',
      'unfreeze_legacy',
      'refund_sct',
      'comms_rollback',
    ]);
    expect(
      await runTrack({ steps, ctx, track: 'abort', dryRun: false, confirm: yes, save: async () => {} }),
    ).toEqual({
      status: 'completed',
    });
    expect(w.calls).toContain('rollbackRefunds:o1');
    expect(w.flags['host_route:yayatoh.com']).toBe('legacy');
    const report = buildReport(ctx.state, FORWARD_STEPS, steps);
    expect(report.verdicts.find((v) => v.id === 'rollback')).toMatchObject({ pass: true });
    expect(report.projectedRollbackMs).toBeLessThanOrEqual(15 * 60_000);
  });
});

describe('cutover CLI safety', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const cli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ['tools/cutover/cli.ts', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
      timeout: 60_000,
    });

  it('refuses a target that is not local or staging, and a non-local database for local', () => {
    const r = cli(['run', '--instance=yay', '--target=production']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--target=local or --target=staging');
    const remote = cli(['run', '--instance=yay', '--target=local'], {
      MIGRATOR_DATABASE_URL: 'postgres://m:secret@db.prod.example.com:5432/y',
    });
    expect(remote.status).toBe(2);
    expect(remote.stderr).toContain('db.prod.example.com');
    expect(remote.stderr).not.toContain('secret');
    const yesStaging = cli(['run', '--instance=yay', '--target=staging', '--yes'], {
      MIGRATOR_DATABASE_URL: 'postgres://m:p@staging.example.test:5432/y',
      CUTOVER_STAGING_HOSTS: 'staging.example.test',
    });
    expect(yesStaging.status).toBe(2);
    expect(yesStaging.stderr).toContain('--yes is allowed for --target=local only');
  });

  it('without a target it is a dry run: the plan, exit 0, no database needed', () => {
    const r = cli(['run', '--instance=abc']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('dry run');
    expect(r.stdout).toContain('host_route:abc.yayatoh.com → next');
  });
});
