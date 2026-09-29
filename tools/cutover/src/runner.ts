import {
  type Confirm,
  type CutoverContext,
  type CutoverState,
  FREEZE_ABORT_MS,
  FREEZE_TARGET_MS,
  type Instance,
  type Mode,
  REHEARSAL_WINDOW_SHARE,
  ROLLBACK_TARGET_MS,
  type Step,
  type StepState,
  type Track,
} from './types.ts';

export function newState(instance: Instance, mode: Mode, label: string, now: Date): CutoverState {
  return {
    version: 1,
    instance,
    mode,
    label,
    createdAt: now.toISOString(),
    target: null,
    freezeAt: null,
    flippedAt: null,
    newAppFreeze: null,
    tracks: { forward: {}, abort: {} },
    facts: {},
  };
}

export interface RunOutcome {
  readonly status: 'completed' | 'paused' | 'failed' | 'planned';
  readonly stoppedAt?: string;
}

/**
 * Run one track in order. Steps already done (a previous run of the same state file) are skipped,
 * so a failed or paused run resumes where it stopped; a failed step runs again. Before each step the
 * operator confirms (typed); after each the state is saved with its timing. A dry run only prints
 * each step's plan: it runs nothing, confirms nothing and saves nothing.
 */
export async function runTrack(opts: {
  readonly steps: readonly Step[];
  readonly ctx: CutoverContext;
  readonly track: Track;
  readonly dryRun: boolean;
  readonly confirm: Confirm;
  readonly save: (state: CutoverState) => Promise<void>;
}): Promise<RunOutcome> {
  const { steps, ctx, track } = opts;
  if (opts.dryRun) {
    ctx.log(
      `${track === 'forward' ? 'cutover' : 'abort'} plan for ${ctx.instance} (dry run: nothing runs, nothing is written)`,
    );
    steps.forEach((s, i) => {
      const done = ctx.state.tracks[track][s.id]?.status === 'done';
      ctx.log(`${String(i + 1).padStart(2)}. [${s.kind}] ${s.id}: ${s.title}${done ? ' (done)' : ''}`);
      for (const line of s.plan(ctx)) ctx.log(`      ${line}`);
    });
    return { status: 'planned' };
  }
  const states = ctx.state.tracks[track];
  for (const [i, step] of steps.entries()) {
    const st: StepState = states[step.id] ?? { status: 'pending', attempts: 0 };
    states[step.id] = st;
    if (st.status === 'done') {
      ctx.log(`${String(i + 1).padStart(2)}. ${step.id}: done earlier (${st.summary ?? ''})`);
      continue;
    }
    ctx.log(`${String(i + 1).padStart(2)}. [${step.kind}] ${step.id}: ${step.title}`);
    for (const line of step.plan(ctx)) ctx.log(`      ${line}`);
    if ((await opts.confirm(step, ctx)) === 'stop') {
      await opts.save(ctx.state);
      ctx.log(`paused before ${step.id}; resume with the same state file`);
      return { status: 'paused', stoppedAt: step.id };
    }
    const started = ctx.deps.now();
    st.attempts += 1;
    st.startedAt = started.toISOString();
    delete st.error;
    let result: Awaited<ReturnType<Step['run']>>;
    try {
      result = await step.run(ctx);
    } catch (err) {
      result = { ok: false, summary: err instanceof Error ? err.message : String(err) };
      st.error = result.summary;
    }
    const finished = ctx.deps.now();
    st.finishedAt = finished.toISOString();
    st.ms = finished.getTime() - started.getTime();
    st.summary = result.summary;
    if (result.details) st.details = result.details;
    if (result.warnings?.length) st.warnings = [...result.warnings];
    st.status = result.ok ? 'done' : 'failed';
    ctx.log(`    ${result.ok ? 'ok' : 'FAILED'} in ${st.ms} ms: ${result.summary}`);
    for (const w of result.warnings ?? []) ctx.log(`    warning: ${w}`);
    await opts.save(ctx.state);
    if (!result.ok) return { status: 'failed', stoppedAt: step.id };
  }
  return { status: 'completed' };
}

export interface CutoverReport {
  readonly instance: Instance;
  readonly mode: Mode;
  readonly label: string;
  readonly target: string | null;
  readonly freezeAt: string | null;
  readonly flippedAt: string | null;
  readonly steps: readonly {
    track: Track;
    id: string;
    status: string;
    ms: number | null;
    budgetMs: number | null;
    attempts: number;
    summary: string;
    warnings: readonly string[];
  }[];
  /** Legacy freeze start → new app unfreeze (roadmap: target 45 min, abort at 90). */
  readonly freezeWindowMs: number | null;
  /** First abort step start → last abort step end (roadmap: rollback ≤ 15 min). */
  readonly rollbackMs: number | null;
  /**
   * Rehearsals: the same windows with each manual or decision step counted at its budget when the
   * rehearsal simulated it faster (the owner's team does those by hand). Judged against the targets.
   */
  readonly projectedFreezeWindowMs: number | null;
  readonly projectedRollbackMs: number | null;
  readonly verdicts: readonly { id: string; pass: boolean; detail: string }[];
  readonly pass: boolean;
}

const span = (a?: string, b?: string) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);

export function buildReport(
  state: CutoverState,
  forward: readonly Step[],
  abort: readonly Step[],
): CutoverReport {
  const rows = (track: Track, steps: readonly Step[]) =>
    steps.map((s) => {
      const st = state.tracks[track][s.id];
      return {
        track,
        id: s.id,
        status: st?.status ?? 'pending',
        ms: st?.ms ?? null,
        budgetMs: s.budgetMs ?? null,
        attempts: st?.attempts ?? 0,
        summary: st?.summary ?? '',
        warnings: st?.warnings ?? [],
      };
    });
  const f = state.tracks.forward;
  const freezeWindowMs = span(f.freeze_legacy?.startedAt, f.unfreeze_new_app?.finishedAt);
  const abortStates = abort.map((s) => state.tracks.abort[s.id]).filter((s): s is StepState => Boolean(s));
  const rollbackMs =
    abortStates.length && abortStates.every((s) => s.status === 'done')
      ? span(abortStates[0]?.startedAt, abortStates.at(-1)?.finishedAt)
      : null;
  const forwardDone = forward.every((s) => f[s.id]?.status === 'done');
  // Projection: measured time, with every budgeted step counted at max(measured, budget).
  const project = (track: Track, steps: readonly Step[], measured: number | null) => {
    if (measured === null) return null;
    let extra = 0;
    for (const s of steps) {
      const st = state.tracks[track][s.id];
      if (s.budgetMs && st?.ms !== undefined) extra += Math.max(0, s.budgetMs - st.ms);
    }
    return state.mode === 'rehearsal' ? measured + extra : measured;
  };
  const from = forward.findIndex((s) => s.id === 'freeze_legacy');
  const to = forward.findIndex((s) => s.id === 'unfreeze_new_app');
  const projectedFreezeWindowMs = project('forward', forward.slice(from, to + 1), freezeWindowMs);
  const projectedRollbackMs = project('abort', abort, rollbackMs);
  const verdicts: { id: string; pass: boolean; detail: string }[] = [
    {
      id: 'forward',
      pass: forwardDone,
      detail: forwardDone ? 'every step done' : 'not every step done',
    },
  ];
  if (freezeWindowMs !== null && projectedFreezeWindowMs !== null) {
    const measured = `measured ${(freezeWindowMs / 60_000).toFixed(2)} min`;
    verdicts.push({
      id: 'freeze_window',
      pass: projectedFreezeWindowMs <= FREEZE_TARGET_MS,
      detail:
        state.mode === 'rehearsal'
          ? `${(projectedFreezeWindowMs / 60_000).toFixed(2)} min with the manual steps at their budgets (${measured}; target ≤ 45, abort at 90)`
          : `${measured} (target ≤ 45, abort at 90)`,
    });
    if (state.mode === 'rehearsal')
      verdicts.push({
        id: 'rehearsal_share',
        pass: projectedFreezeWindowMs <= FREEZE_TARGET_MS * REHEARSAL_WINDOW_SHARE,
        detail: `${Math.round((projectedFreezeWindowMs / FREEZE_TARGET_MS) * 100)} % of the 45 min window (≤ 70 %)`,
      });
    if (projectedFreezeWindowMs >= FREEZE_ABORT_MS)
      verdicts.push({
        id: 'abort_threshold',
        pass: false,
        detail: 'the freeze reached the 90 min abort threshold',
      });
  }
  if (abortStates.length)
    verdicts.push({
      id: 'rollback',
      pass: projectedRollbackMs !== null && projectedRollbackMs <= ROLLBACK_TARGET_MS,
      detail:
        rollbackMs === null || projectedRollbackMs === null
          ? 'rollback not finished'
          : `${(projectedRollbackMs / 60_000).toFixed(2)} min${state.mode === 'rehearsal' ? ` with the manual steps at their budgets (measured ${(rollbackMs / 60_000).toFixed(2)} min)` : ''} (target ≤ 15, including the SCT refund)`,
    });
  return {
    instance: state.instance,
    mode: state.mode,
    label: state.label,
    target: state.target,
    freezeAt: state.freezeAt,
    flippedAt: state.flippedAt,
    steps: [...rows('forward', forward), ...rows('abort', abort)].filter(
      (r) => r.track === 'forward' || r.status !== 'pending',
    ),
    freezeWindowMs,
    rollbackMs,
    projectedFreezeWindowMs,
    projectedRollbackMs,
    verdicts,
    pass: verdicts.every((v) => v.pass),
  };
}

export function reportMarkdown(r: CutoverReport): string {
  const ms = (v: number | null) => (v === null ? '—' : v < 10_000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);
  const lines = [
    `# ${r.mode === 'rehearsal' ? `Rehearsal ${r.label}` : 'Cutover'} — ${r.instance}: ${r.pass ? 'PASS' : 'FAIL'}`,
    '',
    `- Target: ${r.target ?? 'dry run'}`,
    `- Freeze (T−0): ${r.freezeAt ?? '—'}; flipped: ${r.flippedAt ?? '—'}`,
    `- Freeze window: ${ms(r.freezeWindowMs)} measured${r.mode === 'rehearsal' ? `, ${ms(r.projectedFreezeWindowMs)} with manual steps at their budgets` : ''}`,
    `- Rollback: ${ms(r.rollbackMs)} measured${r.mode === 'rehearsal' && r.rollbackMs !== null ? `, ${ms(r.projectedRollbackMs)} with manual steps at their budgets` : ''}`,
    '',
    '| Verdict | Pass | Detail |',
    '|---|---|---|',
    ...r.verdicts.map((v) => `| ${v.id} | ${v.pass ? 'yes' : '**no**'} | ${v.detail} |`),
    '',
    '| Track | Step | Status | Time | Budget | Tries | Summary |',
    '|---|---|---|---|---|---|---|',
    ...r.steps.map(
      (s) =>
        `| ${s.track} | ${s.id} | ${s.status} | ${ms(s.ms)} | ${s.budgetMs ? ms(s.budgetMs) : '—'} | ${s.attempts} | ${s.summary.replace(/\|/g, '\\|')}${
          s.warnings.length ? ` (warnings: ${s.warnings.join('; ').replace(/\|/g, '\\|')})` : ''
        } |`,
    ),
    '',
  ];
  return lines.join('\n');
}
