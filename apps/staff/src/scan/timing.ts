/**
 * Verdict timing (M7.4b). The door's budget is 300 ms from the code arriving to the verdict being
 * decided on a mid-range Android phone. The Node benchmark (`pnpm --filter @yayatoh/checkin-engine
 * bench`) and the engine test measure the same path on a server CPU; the device pass reads the
 * numbers this module logs from a real phone (durations only, never a code or a name).
 */
export const VERDICT_BUDGET_MS = 300;

export interface TimingSummary {
  readonly count: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
  readonly withinBudget: boolean;
}

export function summarize(durations: readonly number[], budgetMs = VERDICT_BUDGET_MS): TimingSummary {
  if (durations.length === 0) return { count: 0, mean: 0, p95: 0, max: 0, withinBudget: true };
  const sorted = [...durations].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number;
  const max = sorted.at(-1) as number;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { count: sorted.length, mean, p95, max, withinBudget: max <= budgetMs };
}

/** The last `size` verdict times, for the device pass. */
export class TimingLog {
  private readonly samples: number[] = [];
  constructor(private readonly size = 200) {}
  add(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.size) this.samples.shift();
  }
  summary(): TimingSummary {
    return summarize(this.samples);
  }
}
