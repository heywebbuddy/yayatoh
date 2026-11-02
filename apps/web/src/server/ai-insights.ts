import 'server-only';
import {
  INSIGHTS_MAX_ANSWERS,
  type InsightAnswer,
  insightInputHash,
  type SavedInsightDto,
} from '@yayatoh/ai';
import type { InsightView } from '@/components/ai/ai-insights-panel.tsx';

/** Written answers as a summary reads them: numbered, newest first, with no one's name. */
export function insightAnswers(
  written: readonly { readonly text: string | null; readonly rating?: number | null }[],
): InsightAnswer[] {
  return written
    .flatMap((w) =>
      w.text?.trim() ? [{ text: w.text.trim().slice(0, 1000), rating: w.rating ?? null }] : [],
    )
    .slice(0, INSIGHTS_MAX_ANSWERS)
    .map((a, i) => ({ id: `a${i + 1}`, ...a }));
}

/** A survey's written answers, each with its question and without who wrote it. */
export function surveyAnswers(
  questions: readonly {
    readonly label: string;
    readonly report: { readonly kind: string; readonly latest?: readonly string[] };
  }[],
): InsightAnswer[] {
  return insightAnswers(
    questions.flatMap((q) =>
      q.report.kind === 'text' ? (q.report.latest ?? []).map((a) => ({ text: `${q.label}: ${a}` })) : [],
    ),
  );
}

/** A saved summary for the panel, and whether the answers have changed since. */
export function insightView(
  saved: SavedInsightDto | null,
  locale: string,
  answers: readonly InsightAnswer[],
): InsightView | null {
  if (!saved) return null;
  return {
    result: saved.result,
    basedOn: saved.basedOn,
    total: saved.total,
    stale: saved.inputHash !== insightInputHash(locale, answers),
  };
}
