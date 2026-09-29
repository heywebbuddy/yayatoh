import { executeQuery } from '@yayatoh/kernel';
import { listReviewsQuery, REVIEW_FILTERS } from '@yayatoh/reviews';
import { buttonClass, Card, EmptyState, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ReviewModeration } from '@/components/reviews/review-moderation.tsx';
import { Stars } from '@/components/reviews/stars.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatDate, formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { dismissReportsAction, hideReviewAction, unhideReviewAction } from './actions.ts';

type Filter = (typeof REVIEW_FILTERS)[number];

/** M1.4g: reviews of this event by its ticket holders, with moderation (hide/unhide, reports). */
export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const raw = (await searchParams).filter;
  const filter: Filter = (REVIEW_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as Filter) : 'all';
  const { data, event: ev, can } = await loadEvent(org, event, 'reviews');
  const t = await getTranslations('reviews');
  // Moderation is an events:write power (event managers included, through the event's roles).
  const canModerate = can('events:write');
  const list = await executeQuery(listReviewsQuery, { eventId: ev.id, filter }, data.ctx, ports);
  const f = { locale, currency: ev.currency, timeZone: ev.timezone };
  const base = `/o/${org}/e/${event}/reviews`;
  return (
    <>
      <PageHeader title={t('console.title')} description={t('console.description')} />
      {canModerate ? null : (
        <p
          role="note"
          className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body text-zinc-600"
        >
          {t('console.readOnly')}
        </p>
      )}
      <Card className="flex flex-wrap items-center gap-6">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-label uppercase text-zinc-500">{t('console.average')}</span>
          {list.average === null ? (
            <span className="text-body text-zinc-600">{t('console.noRating')}</span>
          ) : (
            <span className="flex items-center gap-2 text-[28px] font-light">
              {formatNumber(list.average, locale)}
              <Stars rating={Math.round(list.average)} label={t('ratingLabel', { rating: list.average })} />
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-label uppercase text-zinc-500">{t('console.visible')}</span>
          <span className="text-[28px] font-light">{formatNumber(list.count, locale)}</span>
        </div>
      </Card>
      <nav aria-label={t('console.filterLabel')} className="flex flex-wrap gap-2">
        {REVIEW_FILTERS.map((k) => (
          <Link
            key={k}
            href={k === 'all' ? base : `${base}?filter=${k}`}
            aria-current={filter === k ? 'page' : undefined}
            className={buttonClass(filter === k ? 'primary' : 'secondary', 'sm')}
          >
            {t(`console.filters.${k}`)}
          </Link>
        ))}
      </nav>
      {list.reviews.length === 0 ? (
        <EmptyState
          title={t(filter === 'all' ? 'console.emptyTitle' : 'console.emptyFilteredTitle')}
          description={t('console.emptyDescription')}
        />
      ) : (
        <ul aria-label={t('console.listLabel')} className="flex list-none flex-col gap-3 p-0">
          {list.reviews.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-3">
                <article
                  aria-label={t('console.reviewBy', { name: r.author ?? t('anonymous') })}
                  className="flex flex-col gap-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Stars rating={r.rating} label={t('ratingLabel', { rating: r.rating })} />
                    <StatusDot
                      status={r.status === 'visible' ? 'success' : 'neutral'}
                      label={t(`console.status.${r.status}`)}
                    />
                  </div>
                  {r.body ? <p className="whitespace-pre-line text-body">{r.body}</p> : null}
                  <p className="text-caption text-zinc-500">
                    {r.author ?? t('anonymous')} ·{' '}
                    {formatDate(r.createdAt.toISOString(), f, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  {r.hiddenReason ? (
                    <p className="text-caption text-zinc-600">
                      {t('console.hiddenBecause', { reason: r.hiddenReason })}
                    </p>
                  ) : null}
                  {r.reports.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-caption font-medium">
                        {t('console.reports', { count: r.openReports })}
                      </p>
                      <ul className="flex list-none flex-col gap-1 p-0 text-caption text-zinc-600">
                        {r.reports.map((rep, i) => (
                          <li key={`${rep.createdAt.toISOString()}-${i}`}>
                            {t(`reportReasons.${rep.reason}`)}
                            {rep.note ? ` — ${rep.note}` : ''} · {t(`console.reportStatus.${rep.status}`)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
                {canModerate ? (
                  <ReviewModeration
                    id={r.id}
                    hidden={r.status === 'hidden'}
                    openReports={r.openReports}
                    hide={hideReviewAction.bind(null, org, event, r.id)}
                    unhide={unhideReviewAction.bind(null, org, event, r.id)}
                    dismiss={dismissReportsAction.bind(null, org, event, r.id)}
                  />
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
