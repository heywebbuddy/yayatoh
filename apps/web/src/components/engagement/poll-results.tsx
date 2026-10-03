import type { PollKind, PollResultsDto } from '@yayatoh/engagement/client';
import { percent, wordWeight } from '@yayatoh/engagement/client';
import { cx } from '@yayatoh/ui';

/**
 * A poll's results as text first (every count and share is read out), with bars or a word cloud
 * for the eye (M5.7a). No inline styles (strict CSP): bars are SVG with a width attribute, word
 * sizes are classes.
 */
const WORD_SIZE = {
  normal: ['text-body', 'text-section', 'text-[24px]', 'text-[32px]', 'text-[40px]'],
  large: ['text-[24px]', 'text-[32px]', 'text-[44px]', 'text-[56px]', 'text-[72px]'],
} as const;

export function PollResultsView({
  kind,
  results,
  labels,
  size = 'normal',
  contrast = false,
}: {
  kind: PollKind;
  results: PollResultsDto;
  labels: { votes: (n: number) => string; average: (n: string) => string; noWords: string };
  size?: 'normal' | 'large';
  contrast?: boolean;
}) {
  if (kind === 'word_cloud') {
    const max = Math.max(0, ...results.counts.map((c) => c.count));
    if (results.counts.length === 0) return <p className="text-body opacity-80">{labels.noWords}</p>;
    return (
      <ul className="flex list-none flex-wrap items-baseline gap-x-4 gap-y-2 p-0" data-testid="word-cloud">
        {results.counts.map((c) => (
          <li
            key={c.key}
            className={cx('font-medium leading-tight', WORD_SIZE[size][wordWeight(c.count, max) - 1])}
          >
            {c.label}
            <span className="sr-only"> — {labels.votes(c.count)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex list-none flex-col gap-3 p-0" data-testid="poll-results">
        {results.counts.map((c) => {
          const pct = percent(c.count, results.total);
          return (
            <li key={c.key} className="flex flex-col gap-1" data-result={c.label} data-count={c.count}>
              <span
                className={cx('flex justify-between gap-3', size === 'large' ? 'text-[28px]' : 'text-body')}
              >
                <span className="min-w-0 break-words">{c.label}</span>
                <span className="shrink-0 font-mono">
                  {pct}% · {labels.votes(c.count)}
                </span>
              </span>
              <svg
                viewBox="0 0 100 4"
                preserveAspectRatio="none"
                aria-hidden="true"
                className={cx('w-full', size === 'large' ? 'h-4' : 'h-2')}
              >
                <rect width="100" height="4" className={contrast ? 'fill-white/30' : 'fill-surface-3'} />
                <rect width={pct} height="4" className={contrast ? 'fill-warning-dot' : 'fill-primary'} />
              </svg>
            </li>
          );
        })}
      </ul>
      {results.average !== null ? (
        <p className={size === 'large' ? 'text-[28px]' : 'text-body'}>
          {labels.average(results.average.toFixed(1))}
        </p>
      ) : null}
    </div>
  );
}
