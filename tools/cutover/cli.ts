#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { closePools } from '@yayatoh/db';
import { checkTarget, TargetRefused } from '@yayatoh/legacy-migrate';
import { renderCutoverSet } from '@yayatoh/notifications';
import { localKeyVault, setKeyVault } from '@yayatoh/platform';
import { realDeps } from './src/deps.ts';
import { REHEARSALS, type RehearsalId, rehearse } from './src/rehearse.ts';
import { buildReport, newState, reportMarkdown, runTrack } from './src/runner.ts';
import { loadState, saveState } from './src/state.ts';
import { abortSteps, FORWARD_STEPS } from './src/steps.ts';
import {
  type Confirm,
  type CutoverContext,
  type CutoverDeps,
  INSTANCE_HOSTS,
  type Instance,
  type Mode,
} from './src/types.ts';

/**
 * The cutover orchestrator (M2.5a; roadmap §7.8 "make cutover"; runbook docs/runbooks/cutover.md).
 *
 *   pnpm cutover plan    --instance=yay|abc [--mode=rehearsal|cutover]     (dry run: prints every step)
 *   pnpm cutover run     --instance=… --mode=rehearsal|cutover --target=local|staging
 *                        [--state .cutover/yay.json] [--dump file] [--base-url http://…] [--hosts a,b]
 *                        [--operator name] [--yes (local only)]
 *   pnpm cutover abort   --instance=… --target=… [--state …]        (before the flip: back out;
 *                                                                      after it: rollback + reverse ETL)
 *   pnpm cutover report  --state .cutover/yay.json [--out dir]
 *   pnpm cutover rehearse --rehearsal=R2|R3|R4 --target=local|staging [--scale=…] [--out reports/…]
 *                        [--base-url …] [--yes]
 *   pnpm cutover comms   --out dir [--start ISO] [--end ISO] [--time-zone Area/City] [--status-url https://…]
 *
 * Safety: without --target every command is a dry run (nothing runs, nothing is written). A real run
 * needs --target=local or --target=staging and every database URL on that target's host allowlist
 * (never production); each step waits for the operator to type its id (or "go" at a go/no-go),
 * unless --yes on a local target. Fake payment provider only; nothing is ever sent to anyone.
 * Exit codes: 0 done (or planned), 1 a step failed or a verdict failed, 2 usage or refusal, 3 paused.
 */
const [command, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
const args = new Map<string, string>();
for (let i = 0; i < rest.length; i++) {
  const a = rest[i] as string;
  if (!a.startsWith('--')) fail(`unexpected argument "${a}"`);
  const eq = a.indexOf('=');
  if (eq > 0) args.set(a.slice(2, eq), a.slice(eq + 1));
  else if (rest[i + 1] && !(rest[i + 1] as string).startsWith('--'))
    args.set(a.slice(2), rest[++i] as string);
  else args.set(a.slice(2), 'true');
}

function fail(message: string): never {
  console.error(`cutover: ${message}`);
  process.exit(2);
}

const log = (m: string) => console.info(m);

function instanceArg(): Instance {
  const i = args.get('instance');
  if (i !== 'yay' && i !== 'abc') fail('--instance=yay|abc is required');
  return i;
}

function modeArg(): Mode {
  const m = args.get('mode') ?? 'rehearsal';
  if (m !== 'rehearsal' && m !== 'cutover') fail('--mode=rehearsal|cutover');
  return m;
}

/** null: dry run. Otherwise the allowlisted target (or the refusal, exit 2). */
function targetArg(): ReturnType<typeof checkTarget> | null {
  if (!args.has('target')) return null;
  try {
    const d = checkTarget(args.get('target'), process.env, { yes: args.has('yes') });
    log(
      `target ${d.target}: database host(s) ${d.hosts.join(', ')}${d.autoConfirm ? ' (--yes: no typed confirmations)' : ''}`,
    );
    return d;
  } catch (err) {
    if (err instanceof TargetRefused) fail(err.message);
    throw err;
  }
}

function keyVault() {
  const key = process.env.LOCAL_KMS_KEY;
  if (!key) fail('LOCAL_KMS_KEY is not set (ticket signing keys and manage tokens)');
  setKeyVault(localKeyVault(key));
}

/** Typed confirmation: the step id to run it ("go" at a go/no-go); anything else pauses. */
function typedConfirm(auto: boolean): Confirm {
  return async (step) => {
    if (auto) return 'run';
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const want = step.kind === 'decision' ? 'go' : step.id;
      const answer = (
        await rl.question(
          `Type "${want}" to ${step.kind === 'manual' ? 'confirm it is done' : 'run it'}, anything else pauses: `,
        )
      ).trim();
      return answer === want ? 'run' : 'stop';
    } finally {
      rl.close();
    }
  };
}

/** Deps for a dry run: planning only; any call means a bug (a dry run writes nothing). */
const planOnlyDeps = new Proxy({} as CutoverDeps, {
  get: (_t, name) =>
    name === 'now'
      ? () => new Date()
      : () => {
          throw new Error(`dry run must not call ${String(name)}`);
        },
});

function contextFor(
  instance: Instance,
  mode: Mode,
  deps: CutoverDeps,
  statePath: string | null,
): CutoverContext {
  const state =
    (statePath ? loadState(statePath) : null) ??
    newState(instance, mode, args.get('label') ?? mode, new Date());
  if (state.instance !== instance || state.mode !== mode)
    fail(`the state file is for ${state.instance} ${state.mode}, not ${instance} ${mode}`);
  const hosts = args.get('hosts')?.split(',').filter(Boolean) ?? [...INSTANCE_HOSTS[instance]];
  return {
    instance,
    mode,
    state,
    deps,
    options: {
      hosts,
      baseUrl: args.get('base-url') ?? null,
      dump: args.get('dump') ?? null,
      operator: args.get('operator') ?? process.env.USER ?? 'operator',
      reportDir: resolve(args.get('out') ?? join('.cutover', `${instance}-report`)),
    },
    log,
  };
}

async function writeReport(ctx: CutoverContext) {
  const report = buildReport(ctx.state, FORWARD_STEPS, abortSteps(ctx));
  const dir = ctx.options.reportDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, 'report.md'), reportMarkdown(report));
  log(reportMarkdown(report));
  log(`report written to ${dir}`);
  return report;
}

async function main(): Promise<number> {
  switch (command) {
    case 'plan': {
      const instance = instanceArg();
      const ctx = contextFor(instance, modeArg(), planOnlyDeps, args.get('state') ?? null);
      await runTrack({
        steps: FORWARD_STEPS,
        ctx,
        track: 'forward',
        dryRun: true,
        confirm: async () => 'stop',
        save: async () => {},
      });
      await runTrack({
        steps: abortSteps(ctx),
        ctx,
        track: 'abort',
        dryRun: true,
        confirm: async () => 'stop',
        save: async () => {},
      });
      return 0;
    }
    case 'run':
    case 'abort': {
      const instance = instanceArg();
      const mode = modeArg();
      const target = targetArg();
      const statePath = resolve(args.get('state') ?? join('.cutover', `${instance}-${mode}.json`));
      if (!target) {
        const ctx = contextFor(instance, mode, planOnlyDeps, statePath);
        const steps = command === 'run' ? FORWARD_STEPS : abortSteps(ctx);
        await runTrack({
          steps,
          ctx,
          track: command === 'run' ? 'forward' : 'abort',
          dryRun: true,
          confirm: async () => 'stop',
          save: async () => {},
        });
        log('dry run: add --target=local|staging to run it');
        return 0;
      }
      keyVault();
      const deps = realDeps({ scale: (args.get('scale') as 'small' | 'demo' | 'large') ?? 'demo', log });
      const ctx = contextFor(instance, mode, deps, statePath);
      ctx.state.target = target.target;
      const steps = command === 'run' ? FORWARD_STEPS : abortSteps(ctx);
      const out = await runTrack({
        steps,
        ctx,
        track: command === 'run' ? 'forward' : 'abort',
        dryRun: false,
        confirm: typedConfirm(target.autoConfirm),
        save: async (s) => saveState(statePath, s),
      });
      log(`state: ${statePath}`);
      const report = await writeReport(ctx);
      if (out.status === 'paused') return 3;
      if (out.status === 'failed') {
        log(`step ${out.stoppedAt} failed: fix and run again (it resumes), or abort (pnpm cutover abort)`);
        return 1;
      }
      return report.pass ? 0 : 1;
    }
    case 'report': {
      const statePath = args.get('state') ?? fail('--state <file> is required');
      const state = loadState(resolve(statePath)) ?? fail(`no state file at ${statePath}`);
      const ctx = contextFor(state.instance, state.mode, planOnlyDeps, resolve(statePath));
      return (await writeReport(ctx)).pass ? 0 : 1;
    }
    case 'rehearse': {
      const id = args.get('rehearsal') ?? 'R2';
      if (!(id in REHEARSALS)) fail('--rehearsal=R2|R3|R4');
      const rehearsal = id as RehearsalId;
      const target = targetArg();
      if (!target) {
        log(`${REHEARSALS[rehearsal].title}: dry run (yay then abc; add --target=local|staging to run it)`);
        for (const instance of ['yay', 'abc'] as const) {
          const ctx = contextFor(instance, 'rehearsal', planOnlyDeps, null);
          await runTrack({
            steps: FORWARD_STEPS,
            ctx,
            track: 'forward',
            dryRun: true,
            confirm: async () => 'stop',
            save: async () => {},
          });
        }
        return 0;
      }
      keyVault();
      const scale =
        (args.get('scale') as 'small' | 'demo' | 'large' | undefined) ?? REHEARSALS[rehearsal].scale;
      const reportDir = resolve(args.get('out') ?? join('reports', `rehearsal-${rehearsal}-${Date.now()}`));
      const deps = realDeps({ scale, log });
      if (rehearsal === 'R3') {
        // The full runbook includes reviewing every message: rendered, never sent.
        await renderComms(join(reportDir, 'comms'));
      }
      const r = await rehearse({
        rehearsal,
        deps,
        target: target.target,
        confirm: typedConfirm(target.autoConfirm),
        reportDir,
        baseUrl: args.get('base-url') ?? null,
        log,
      });
      log(
        `${REHEARSALS[rehearsal].title}: ${r.pass ? 'PASS' : 'FAIL'} in ${(r.totalMs / 1000).toFixed(1)} s; reports in ${reportDir}`,
      );
      return r.pass ? 0 : 1;
    }
    case 'comms': {
      const out = resolve(args.get('out') ?? fail('--out <dir> is required'));
      const n = await renderComms(out);
      log(`${n} messages rendered to ${out} (for review; nothing is sent)`);
      return 0;
    }
    default:
      fail('commands: plan | run | abort | report | rehearse | comms');
  }
}

async function renderComms(out: string): Promise<number> {
  const start = new Date(args.get('start') ?? Date.now() + 14 * 86_400_000);
  const end = new Date(args.get('end') ?? start.getTime() + 45 * 60_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    fail('--start/--end must be ISO instants');
  const set = renderCutoverSet({
    start,
    end,
    timeZone: args.get('time-zone') ?? 'America/New_York',
    statusUrl: args.get('status-url') ?? 'https://status.yayatoh.com/',
  });
  for (const m of set) {
    const base = join(out, m.moment, m.audience, m.locale);
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(`${base}.html`, m.message.html);
    writeFileSync(`${base}.txt`, m.message.text);
  }
  return set.length;
}

main()
  .then(async (code) => {
    await closePools();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    await closePools().catch(() => {});
    process.exit(2);
  });
