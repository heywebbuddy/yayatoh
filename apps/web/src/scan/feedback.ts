/**
 * Scan feedback timing (M3.4a acceptance: feedback within 300 ms). Every scan marks its start
 * when the code is submitted and its feedback when the verdict is on screen; the measure
 * `yy-scan-feedback` is what Playwright reads (the real-device check is the owner's drill).
 */
export const FEEDBACK_BUDGET_MS = 300;
export const FEEDBACK_MEASURE = 'yy-scan-feedback';

type Perf = Pick<Performance, 'mark' | 'measure' | 'getEntriesByName' | 'clearMarks'>;

const startMark = (id: string) => `yy-scan-start:${id}`;

export function markScanStart(id: string, perf: Perf | undefined = globalThis.performance): void {
  perf?.mark(startMark(id));
}

/** Call once the verdict is painted; returns the duration (ms) or null without a start mark. */
export function markScanFeedback(id: string, perf: Perf | undefined = globalThis.performance): number | null {
  if (!perf || perf.getEntriesByName(startMark(id)).length === 0) return null;
  const m = perf.measure(FEEDBACK_MEASURE, { start: startMark(id), detail: { scanId: id } });
  perf.clearMarks(startMark(id));
  return m?.duration ?? null;
}

/** Summary of measured feedback times: count, worst, 95th percentile, and whether all met the budget. */
export function feedbackSummary(durations: readonly number[], budgetMs = FEEDBACK_BUDGET_MS) {
  if (durations.length === 0) return { count: 0, max: 0, p95: 0, withinBudget: true };
  const sorted = [...durations].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number;
  const max = sorted.at(-1) as number;
  return { count: sorted.length, max, p95, withinBudget: max <= budgetMs };
}
