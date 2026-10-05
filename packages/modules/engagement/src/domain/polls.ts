import type { PollKind } from '../schema.ts';

/**
 * Pure poll rules (M5.7a): what a ballot may contain, how it turns into tally keys, and the
 * results as counts. The server is authoritative: the browser only proposes a choice.
 */
export const MAX_OPTIONS = 10;
export const MIN_OPTIONS = 2;
/** Distinct words a word cloud keeps; later new words still count as a ballot, not as a word. */
export const MAX_WORDS = 300;
/** Words shown in results (the most frequent first). */
export const WORDS_SHOWN = 50;
export const WORD_MAX_LENGTH = 40;

export interface PollOption {
  readonly id: string;
  readonly label: string;
}

export interface PollShape {
  readonly kind: PollKind;
  readonly options: readonly PollOption[];
  readonly maxChoices: number;
  readonly ratingScale: number | null;
}

export interface Choice {
  readonly optionIds?: readonly string[] | undefined;
  readonly rating?: number | undefined;
  readonly word?: string | undefined;
}

export type BallotProblem = 'choose_one' | 'too_many' | 'unknown_option' | 'rating' | 'word';

/** Option ids are stable short keys (`o1`…`o10`) in the order the organizer entered them. */
export function optionsFrom(labels: readonly string[]): PollOption[] {
  return labels.map((label, i) => ({ id: `o${i + 1}`, label: label.trim() }));
}

/**
 * A word-cloud entry as it is counted: Unicode-normalized, lower-cased, inner whitespace collapsed,
 * punctuation trimmed from both ends. Empty after that means "no word".
 */
export function normalizeWord(raw: string): string {
  const s = raw
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
  return [...s].slice(0, WORD_MAX_LENGTH).join('').trim();
}

/** The tally keys a ballot adds one to, or the problem with it. */
export function ballotKeys(poll: PollShape, choice: Choice): { keys: string[] } | { problem: BallotProblem } {
  switch (poll.kind) {
    case 'single':
    case 'multi': {
      const ids = [...new Set(choice.optionIds ?? [])];
      if (ids.length === 0) return { problem: 'choose_one' };
      const max = poll.kind === 'single' ? 1 : poll.maxChoices;
      if (ids.length > max) return { problem: 'too_many' };
      const known = new Set(poll.options.map((o) => o.id));
      if (!ids.every((id) => known.has(id))) return { problem: 'unknown_option' };
      return { keys: ids };
    }
    case 'rating': {
      const r = choice.rating;
      const scale = poll.ratingScale ?? 5;
      if (r === undefined || !Number.isInteger(r) || r < 1 || r > scale) return { problem: 'rating' };
      return { keys: [String(r)] };
    }
    case 'word_cloud': {
      const w = normalizeWord(choice.word ?? '');
      if (!w) return { problem: 'word' };
      return { keys: [w] };
    }
  }
}

export interface ResultCount {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface PollResults {
  readonly total: number;
  readonly counts: ResultCount[];
  /** Rating polls: the mean rating (two decimals), null without ballots. */
  readonly average: number | null;
}

/**
 * Results from the tallies: every option (zeros included) in the organizer's order, every rating
 * value from 1 up, or the most frequent words (ties alphabetically).
 */
export function pollResults(
  poll: PollShape,
  ballots: number,
  tallies: readonly { key: string; count: number }[],
): PollResults {
  const by = new Map(tallies.map((t) => [t.key, t.count]));
  if (poll.kind === 'single' || poll.kind === 'multi')
    return {
      total: ballots,
      counts: poll.options.map((o) => ({ key: o.id, label: o.label, count: by.get(o.id) ?? 0 })),
      average: null,
    };
  if (poll.kind === 'rating') {
    const scale = poll.ratingScale ?? 5;
    const counts = Array.from({ length: scale }, (_, i) => {
      const key = String(i + 1);
      return { key, label: key, count: by.get(key) ?? 0 };
    });
    const n = counts.reduce((s, c) => s + c.count, 0);
    const sum = counts.reduce((s, c) => s + Number(c.key) * c.count, 0);
    return { total: ballots, counts, average: n ? Math.round((sum / n) * 100) / 100 : null };
  }
  const counts = [...tallies]
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, WORDS_SHOWN)
    .map((t) => ({ key: t.key, label: t.key, count: t.count }));
  return { total: ballots, counts, average: null };
}

/** Relative size class 1–5 of a word in a cloud (largest = most frequent). */
export function wordWeight(count: number, max: number): 1 | 2 | 3 | 4 | 5 {
  if (max <= 0) return 1;
  return Math.max(1, Math.min(5, Math.ceil((count / max) * 5))) as 1 | 2 | 3 | 4 | 5;
}

/** Share of `count` in `total` as a whole percentage (0 without ballots). */
export const percent = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0);
