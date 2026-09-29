import type { Target } from '@yayatoh/legacy-migrate';

export type Instance = 'yay' | 'abc';
export type Mode = 'rehearsal' | 'cutover';

/** Roadmap §7.8: freeze target 45 min, abort at 90 min; rollback rehearsed in ≤ 15 min. */
export const FREEZE_TARGET_MS = 45 * 60_000;
export const FREEZE_ABORT_MS = 90 * 60_000;
export const ROLLBACK_TARGET_MS = 15 * 60_000;
/** The last timed rehearsal must take ≤ 70 % of the window (roadmap §7.5 "Rehearsals"). */
export const REHEARSAL_WINDOW_SHARE = 0.7;

/** The hosts each instance's front door serves (overridable with --hosts). */
export const INSTANCE_HOSTS: Readonly<Record<Instance, readonly string[]>> = {
  yay: ['yayatoh.com', 'www.yayatoh.com'],
  abc: ['abc.yayatoh.com'],
};

export interface StepResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly details?: Record<string, unknown>;
  /** Warnings that do not fail the step (shown in the report). */
  readonly warnings?: readonly string[];
}

export type StepKind = 'auto' | 'manual' | 'decision';

export interface Step {
  readonly id: string;
  readonly title: string;
  readonly kind: StepKind;
  /** Where it sits in roadmap §7.8 (for the report). */
  readonly when: string;
  /**
   * Manual and decision steps: the time the owner's team is budgeted for it (a rehearsal simulates
   * them in 0 ms, so its projected window counts the budget instead; pending owner confirmation).
   */
  readonly budgetMs?: number;
  /** What the step will do: printed by the dry run and before each confirmation. */
  plan(ctx: CutoverContext): readonly string[];
  run(ctx: CutoverContext): Promise<StepResult>;
}

export type StepStatus = 'pending' | 'done' | 'failed' | 'skipped';

export interface StepState {
  status: StepStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  ms?: number;
  summary?: string;
  details?: Record<string, unknown>;
  warnings?: string[];
  error?: string;
}

export type Track = 'forward' | 'abort';

export interface CutoverState {
  readonly version: 1;
  readonly instance: Instance;
  readonly mode: Mode;
  readonly label: string;
  readonly createdAt: string;
  target: Target | null;
  /** T−0: when the legacy app went read-only (set by the freeze step). */
  freezeAt: string | null;
  /** When the route flipped to the new platform (the rollback needs a reverse ETL after this). */
  flippedAt: string | null;
  /** What the new app's freeze covers (restored by the abort path). */
  newAppFreeze: { scope: 'platform' | 'orgs'; orgIds: string[] } | null;
  tracks: Record<Track, Record<string, StepState>>;
  /** Free-form facts steps hand to later steps (dump path, simulated order ids, …). */
  facts: Record<string, unknown>;
}

/** Everything the steps need from the outside world (real: src/deps.ts; tests: fakes). */
export interface CutoverDeps {
  now(): Date;
  migrationStatus(): Promise<{ files: number; applied: number; pending: number }>;
  latestRun(instance: Instance): Promise<{ id: number; pass: boolean; mode: string } | null>;
  eventsNearWindow(
    at: Date,
    hours: number,
    scope: { instance: Instance; allOrgs: boolean },
  ): Promise<unknown[]>;
  hostRoutes(): Promise<Record<string, string>>;
  commsReady(): Promise<{ kinds: number; locales: number; missing: string[] }>;
  prepareDump(instance: Instance, facts: Record<string, unknown>): Promise<string | null>;
  runElt(opts: {
    instance: Instance;
    mode: Mode;
    dump: string | null;
    freezeAt: Date;
  }): Promise<{ pass: boolean; summary: string; runId: number; totalMs: number }>;
  revalidate(instance: Instance): Promise<{ pass: boolean; summary: string }>;
  freezeProbe(
    instance: Instance,
    freezeAt: Date,
  ): Promise<{ pass: boolean; tables: Record<string, unknown> }>;
  instanceOrgIds(instance: Instance): Promise<string[]>;
  setFreeze(
    value: { scope: 'platform' } | { scope: 'orgs'; orgIds: string[] } | null,
    expectedEndAt: Date | null,
    reason: string,
    actor: string,
  ): Promise<void>;
  setHostRoute(host: string, target: 'next' | 'legacy' | null, reason: string, actor: string): Promise<void>;
  smoke(
    baseUrl: string | null,
    instance: Instance,
  ): Promise<{ checks: { name: string; ok: boolean; detail: string }[] }>;
  reverseEtl(
    instance: Instance,
    cutoverAt: Date,
  ): Promise<{ pass: boolean; summary: string; report: unknown }>;
  rollbackSql(instance: Instance): Promise<string>;
  rollbackRefunds(
    instance: Instance,
    cutoverAt: Date,
    orderIds: readonly string[] | null,
  ): Promise<{ items: readonly { orderId: string; status: string; amountMinor: number }[] }>;
  /** Rehearsals only: sell (platform_mor, fake provider) and scan after the flip. */
  simulatePostCutover(instance: Instance): Promise<{ orderIds: string[]; scans: number } | null>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface CutoverOptions {
  readonly hosts: readonly string[];
  readonly baseUrl: string | null;
  readonly dump: string | null;
  readonly operator: string;
  readonly reportDir: string;
}

export interface CutoverContext {
  readonly instance: Instance;
  readonly mode: Mode;
  readonly state: CutoverState;
  readonly deps: CutoverDeps;
  readonly options: CutoverOptions;
  readonly log: (message: string) => void;
}

/** Typed confirmation per step (the CLI asks the operator; `--yes` on a local target says yes). */
export type Confirm = (step: Step, ctx: CutoverContext) => Promise<'run' | 'stop'>;
