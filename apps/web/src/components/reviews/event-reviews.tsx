import type { PublicReviewSummaryDto } from '@yayatoh/reviews';
import { getTranslations } from 'next-intl/server';
import { reportReviewAction } from '@/app/[locale]/events/[slug]/actions.ts';
import { formatNumber } from '@/lib/format.ts';
import { ReportForm } from './report-form.tsx';
import { Stars } from './stars.tsx';

/** Public event page (M1.4g): the aggregate rating and the latest visible reviews. */
export async function EventReviews({
  slug,
  summary,
  locale,
  timeZone,
}: {
  slug: string;
  summary: PublicReviewSummaryDto;
  locale: string;
  timeZone: string;
}) {
  if (summary.count === 0 || summary.average === null) return null;
  const t = await getTranslations('reviews');
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone });
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="flex scroll-mt-4 flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card glass md:p-6"
    >
      <h2 id="reviews-heading" className="text-section">
        {t('public.title')}
      </h2>
      <p className="flex flex-wrap items-center gap-3 text-body">
        <Stars rating={Math.round(summary.average)} label={t('ratingLabel', { rating: summary.average })} />
        <span>
          {t('public.summary', { average: formatNumber(summary.average, locale), count: summary.count })}
        </span>
      </p>
      <ul aria-label={t('public.recent')} className="flex list-none flex-col gap-3 p-0">
        {summary.recent.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-card border border-line p-4">
            <Stars rating={r.rating} label={t('ratingLabel', { rating: r.rating })} />
            {r.body ? <p className="whitespace-pre-line text-body">{r.body}</p> : null}
            <p className="text-caption text-ink-2">
              {r.author ?? t('anonymous')} · {day.format(r.createdAt)}
            </p>
            <ReportForm
              action={reportReviewAction.bind(null, slug, r.id)}
              author={r.author ?? t('anonymous')}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
