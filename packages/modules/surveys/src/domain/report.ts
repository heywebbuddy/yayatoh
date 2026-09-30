/**
 * Survey report math (M3.9a), pure: NPS, response rate and per-question summaries. Numbers are
 * computed from integer counts; percentages round half away from zero so +12.5 and −12.5 are
 * shown as 13 and −13.
 */

/** Net Promoter Score buckets: 9–10 promoters, 7–8 passives, 0–6 detractors. */
export const PROMOTER_MIN = 9;
export const PASSIVE_MIN = 7;
/** Text answers a report lists per question (newest first); the CSV export has them all. */
export const TEXT_SAMPLE = 20;

export const roundHalfAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));

export interface NpsSummary {
  readonly answered: number;
  readonly promoters: number;
  readonly passives: number;
  readonly detractors: number;
  /** −100…100, or null with no answers. */
  readonly score: number | null;
  /** How many answered 0, 1, … 10. */
  readonly distribution: readonly number[];
}

export function npsOf(scores: readonly number[]): NpsSummary {
  const distribution = Array.from({ length: 11 }, () => 0);
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const s of scores) {
    if (!Number.isInteger(s) || s < 0 || s > 10) continue;
    distribution[s] = (distribution[s] ?? 0) + 1;
    if (s >= PROMOTER_MIN) promoters += 1;
    else if (s >= PASSIVE_MIN) passives += 1;
    else detractors += 1;
  }
  const answered = promoters + passives + detractors;
  return {
    answered,
    promoters,
    passives,
    detractors,
    score: answered === 0 ? null : roundHalfAway((100 * (promoters - detractors)) / answered),
    distribution,
  };
}

/** Whole-percent response rate, or null when nobody was asked. */
export function responseRate(responded: number, invited: number): number | null {
  if (invited <= 0) return null;
  return roundHalfAway((100 * Math.min(responded, invited)) / invited);
}

/** One decimal, e.g. 4.25 → 4.3 (averages of ratings and numbers). */
const oneDecimal = (x: number) => roundHalfAway(x * 10) / 10;

export type QuestionReport =
  | ({ readonly kind: 'nps' } & NpsSummary)
  | {
      readonly kind: 'rating';
      readonly answered: number;
      readonly average: number | null;
      /** How many chose 1 … 5. */
      readonly distribution: readonly number[];
    }
  | {
      readonly kind: 'choice';
      readonly answered: number;
      readonly options: readonly { value: string; label: string; count: number }[];
    }
  | { readonly kind: 'checkbox'; readonly answered: number; readonly yes: number }
  | {
      readonly kind: 'number';
      readonly answered: number;
      readonly average: number | null;
      readonly min: number | null;
      readonly max: number | null;
    }
  | { readonly kind: 'text'; readonly answered: number; readonly latest: readonly string[] };

export interface QuestionInput {
  readonly key: string;
  readonly type: string;
  readonly options: Readonly<Record<string, string>>;
}

/**
 * Summarize one question over the responses (oldest first). Answers of the wrong shape (an
 * older version asked differently) are skipped rather than miscounted.
 */
export function summarizeQuestion(
  q: QuestionInput,
  answers: readonly Readonly<Record<string, unknown>>[],
): QuestionReport {
  const given = answers.map((a) => a[q.key]).filter((v) => v !== undefined && v !== null && v !== '');
  switch (q.type) {
    case 'nps':
      return { kind: 'nps', ...npsOf(given.filter((v): v is number => typeof v === 'number')) };
    case 'rating': {
      const vals = given.filter(
        (v): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5,
      );
      const distribution = [1, 2, 3, 4, 5].map((n) => vals.filter((v) => v === n).length);
      return {
        kind: 'rating',
        answered: vals.length,
        average: vals.length ? oneDecimal(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        distribution,
      };
    }
    case 'select':
    case 'multi_select': {
      const counts = new Map<string, number>(Object.keys(q.options).map((k) => [k, 0]));
      let answered = 0;
      for (const v of given) {
        const picked = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string');
        if (picked.length === 0) continue;
        answered += 1;
        for (const p of new Set(picked)) counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      return {
        kind: 'choice',
        answered,
        options: [...counts].map(([value, count]) => ({ value, label: q.options[value] ?? value, count })),
      };
    }
    case 'checkbox': {
      const vals = given.filter((v): v is boolean => typeof v === 'boolean');
      return { kind: 'checkbox', answered: vals.length, yes: vals.filter(Boolean).length };
    }
    case 'number':
    case 'count': {
      const vals = given.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      return {
        kind: 'number',
        answered: vals.length,
        average: vals.length ? oneDecimal(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
      };
    }
    default: {
      const vals = given.filter((v): v is string => typeof v === 'string');
      return { kind: 'text', answered: vals.length, latest: vals.slice(-TEXT_SAMPLE).reverse() };
    }
  }
}

/** How a CSV cell shows one answer: choice labels, yes/no words, numbers as they are. */
export function answerCell(
  q: QuestionInput,
  value: unknown,
  words: { readonly yes: string; readonly no: string },
): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((v) => q.options[String(v)] ?? String(v)).join('; ');
  if (typeof value === 'boolean') return value ? words.yes : words.no;
  if (q.type === 'select') return q.options[String(value)] ?? String(value);
  return String(value);
}
