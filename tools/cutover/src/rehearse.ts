import { buildReport, type CutoverReport, newState, reportMarkdown, runTrack } from './runner.ts';
import { abortSteps, FORWARD_STEPS } from './steps.ts';
import {
  type Confirm,
  type CutoverContext,
  type CutoverDeps,
  INSTANCE_HOSTS,
  type Instance,
} from './types.ts';

export const REHEARSALS = {
  /** At parity, timed; rehearses the rollback including an SCT refund (roadmap §7.5). */
  R2: { scale: 'demo', title: 'R2 — at parity, timed, with rollback' },
  /** T−14 with the full runbook (comms rendered for review). */
  R3: { scale: 'large', title: 'R3 — T−14, full runbook' },
  /** T−5 on a fresh snapshot: must take ≤ 70 % of the window. */
  R4: { scale: 'large', title: 'R4 — T−5, fresh snapshot, ≤ 70 % of the window' },
} as const;
export type RehearsalId = keyof typeof REHEARSALS;

export interface RehearsalResult {
  readonly rehearsal: RehearsalId;
  readonly pass: boolean;
  readonly reports: readonly CutoverReport[];
  readonly totalMs: number;
}

/**
 * One rehearsal on the synthetic legacy dataset: both instances in order (yayatoh.com, then abc;
 * decision D8), each through every cutover step with the manual steps simulated. Then, on yay, the
 * new platform takes a sale (platform_mor, fake provider) and a scan, and the rollback runs:
 * freeze, reverse ETL, route back, refund that SCT order. Each instance gets a timed report
 * (freeze window ≤ 45 min, abort at 90; rollback ≤ 15 min). Flags are always cleared at the end.
 */
export async function rehearse(opts: {
  readonly rehearsal: RehearsalId;
  readonly deps: CutoverDeps;
  readonly target: 'local' | 'staging';
  readonly confirm: Confirm;
  readonly reportDir: string;
  readonly baseUrl: string | null;
  readonly log: (message: string) => void;
  readonly instances?: readonly Instance[];
}): Promise<RehearsalResult> {
  const started = Date.now();
  const label = opts.rehearsal;
  const runs: { ctx: CutoverContext; abort: ReturnType<typeof abortSteps>; save: () => Promise<void> }[] = [];
  const instances = opts.instances ?? (['yay', 'abc'] as const);
  try {
    // 1. The cutover of each instance, in order (D8: yayatoh.com, then abc).
    for (const instance of instances) {
      const state = newState(instance, 'rehearsal', label, opts.deps.now());
      state.target = opts.target;
      const ctx: CutoverContext = {
        instance,
        mode: 'rehearsal',
        state,
        deps: opts.deps,
        options: {
          hosts: INSTANCE_HOSTS[instance],
          baseUrl: opts.baseUrl,
          dump: null,
          operator: `rehearsal-${label}`,
          reportDir: opts.reportDir,
        },
        log: (m) => opts.log(`[${label} ${instance}] ${m}`),
      };
      const save = async () => {
        await opts.deps.writeFile(
          `${opts.reportDir}/${instance}.state.json`,
          `${JSON.stringify(state, null, 2)}\n`,
        );
      };
      const run = { ctx, abort: [] as ReturnType<typeof abortSteps>, save };
      runs.push(run);
      const forward = await runTrack({
        steps: FORWARD_STEPS,
        ctx,
        track: 'forward',
        dryRun: false,
        confirm: opts.confirm,
        save,
      });
      if (forward.status !== 'completed' && state.freezeAt) {
        // Failed inside the freeze: rehearse the abort path too.
        run.abort = abortSteps(ctx);
        await runTrack({ steps: run.abort, ctx, track: 'abort', dryRun: false, confirm: opts.confirm, save });
      }
    }
    // 2. The rollback of yayatoh.com before the point of no return, after live traffic: a sale on
    //    the platform account (SCT) and a scan, then freeze, reverse ETL, route back, refund. Last,
    //    because its reverse rows belong to the next legacy dump (as in a real rollback).
    const yay = runs.find((r) => r.ctx.instance === 'yay');
    if (yay && yay.ctx.state.tracks.forward.unfreeze_new_app?.status === 'done') {
      const sim = await opts.deps.simulatePostCutover('yay');
      yay.ctx.state.facts.simulatedOrders = sim?.orderIds ?? [];
      yay.ctx.state.facts.simulatedScans = sim?.scans ?? 0;
      yay.ctx.log(`after the flip: ${sim?.orderIds.length ?? 0} SCT order(s), ${sim?.scans ?? 0} scan(s)`);
      yay.abort = abortSteps(yay.ctx);
      await runTrack({
        steps: yay.abort,
        ctx: yay.ctx,
        track: 'abort',
        dryRun: false,
        confirm: opts.confirm,
        save: yay.save,
      });
    }
  } finally {
    // A rehearsal never leaves the platform frozen or a host routed.
    try {
      for (const instance of instances)
        for (const h of INSTANCE_HOSTS[instance])
          await opts.deps.setHostRoute(h, null, `rehearsal ${label}: cleanup`, 'cutover:rehearsal');
      await opts.deps.setFreeze(null, null, `rehearsal ${label}: cleanup`, 'cutover:rehearsal');
    } catch (err) {
      opts.log(`[${label}] cleanup failed (clear the flags in the staff console): ${String(err)}`);
    }
  }
  const reports: CutoverReport[] = [];
  for (const { ctx, abort } of runs) {
    const report = buildReport(ctx.state, FORWARD_STEPS, abort);
    reports.push(report);
    await opts.deps.writeFile(
      `${opts.reportDir}/${ctx.instance}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await opts.deps.writeFile(`${opts.reportDir}/${ctx.instance}.md`, reportMarkdown(report));
    ctx.log(
      `${report.pass ? 'PASS' : 'FAIL'}: ${report.verdicts.map((v) => `${v.id} ${v.detail}`).join('; ')}`,
    );
  }
  const result: RehearsalResult = {
    rehearsal: opts.rehearsal,
    pass: reports.length > 0 && reports.every((r) => r.pass),
    reports,
    totalMs: Date.now() - started,
  };
  await opts.deps.writeFile(
    `${opts.reportDir}/README.md`,
    [
      `# ${REHEARSALS[opts.rehearsal].title}: ${result.pass ? 'PASS' : 'FAIL'}`,
      '',
      `Synthetic legacy dataset, target ${opts.target}, ${reports.length} instance(s), ${(result.totalMs / 1000).toFixed(1)} s in all.`,
      '',
      ...reports.map(
        (r) =>
          `- **${r.instance}**: ${r.pass ? 'pass' : 'FAIL'}; freeze window ${
            r.freezeWindowMs === null ? '—' : `${(r.freezeWindowMs / 60_000).toFixed(2)} min`
          }${r.rollbackMs === null ? '' : `; rollback ${(r.rollbackMs / 60_000).toFixed(2)} min`} ([report](${r.instance}.md))`,
      ),
      '',
    ].join('\n'),
  );
  return result;
}
