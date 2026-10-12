import { searchEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, Label, PageHeader, Pagination, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { eventPhase } from '@/lib/event-status.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { loadConsoleBase } from '@/server/console.ts';
import { categoryLabels } from '@/server/event-categories.ts';
import { ports } from '@/server/ports.ts';

const STATUS_DOT = {
  draft: 'neutral',
  published: 'success',
  postponed: 'warning',
  cancelled: 'danger',
  completed: 'info',
  archived: 'info',
} as const;

const EVENTS_PER_PAGE = 24;

export default async function OrgEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsoleBase(org);
  if (!roleCan(data.role, 'events:read')) notFound();

  const q = sp.q?.trim().slice(0, 80) || undefined;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const [all, t, tp] = await Promise.all([
    executeQuery(searchEventsQuery, { q }, data.ctx, ports),
    getTranslations(),
    getTranslations('market.pagination'),
  ]);
  const platformLabel = await categoryLabels((key) => t(`categories.${key}`));
  const listed = all;
  const now = Date.now();
  const current = listed.filter((event) => event.endsAt.getTime() >= now);
  const past = listed.filter((event) => event.endsAt.getTime() < now).reverse();
  const ordered = [...current, ...past];
  const pageCount = Math.max(1, Math.ceil(ordered.length / EVENTS_PER_PAGE));
  const at = Math.min(page, pageCount);
  const events = ordered.slice((at - 1) * EVENTS_PER_PAGE, at * EVENTS_PER_PAGE);
  const create = roleCan(data.role, 'events:write') ? (
    <Link href={`/o/${org}/events/new/guided`} className={buttonClass('primary')}>
      {t('orgHome.create')}
    </Link>
  ) : undefined;
  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (nextPage > 1) query.set('page', String(nextPage));
    const suffix = query.toString();
    return `/o/${org}/events${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <>
      <PageHeader
        title={t('nav.events')}
        description={t('orgHome.subtitle', { org: data.org.name, count: ordered.length })}
        actions={create}
      />
      <search aria-label={t('eventFilters.label')}>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 grow flex-col gap-1.5 sm:max-w-80">
            <label htmlFor="events-search" className="text-[13px] font-bold text-ink">
              {t('eventFilters.search')}
            </label>
            <input
              id="events-search"
              name="q"
              type="search"
              maxLength={80}
              defaultValue={q ?? ''}
              className="field"
            />
          </div>
          <button type="submit" className={buttonClass('secondary')}>
            {t('eventFilters.apply')}
          </button>
          {q ? (
            <Link
              href={`/o/${org}/events`}
              className="inline-flex min-h-10 items-center text-caption underline"
            >
              {t('eventFilters.clear')}
            </Link>
          ) : null}
        </form>
      </search>
      {events.length === 0 ? (
        <EmptyState
          title={q ? t('eventFilters.noneTitle') : t('orgHome.emptyTitle')}
          description={q ? t('eventFilters.noneDescription') : t('orgHome.emptyDescription')}
          action={
            q ? (
              <Link href={`/o/${org}/events`} className={buttonClass('secondary', 'md')}>
                {t('eventFilters.clear')}
              </Link>
            ) : (
              create
            )
          }
        />
      ) : (
        <>
          <p className="m-0 text-caption text-ink-2 tabular-nums" data-testid="org-events-count">
            {t('eventFilters.showing', {
              from: (at - 1) * EVENTS_PER_PAGE + 1,
              to: (at - 1) * EVENTS_PER_PAGE + events.length,
              total: ordered.length,
            })}
          </p>
          <ul className="grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2 xl:grid-cols-3">
            {events.map((event) => {
              const phase = eventPhase(event.startsAt.toISOString(), event.endsAt.toISOString());
              return (
                <li key={event.id}>
                  <Card className="flex h-full flex-col gap-3">
                    <Label>
                      {t(`profiles.${event.profile}`)}
                      {event.categoryName
                        ? ` · ${event.categoryName}`
                        : event.category
                          ? ` · ${platformLabel(event.category)}`
                          : ''}
                    </Label>
                    <h2 className="text-[22px] leading-tight font-extrabold tracking-[-0.03em]">
                      {event.name}
                    </h2>
                    <p className="text-body text-ink-2">
                      {formatEventDateRange(event.startsAt.toISOString(), event.endsAt.toISOString(), {
                        locale,
                        currency: event.currency,
                        timeZone: event.timezone,
                      })}
                      {event.venueName ? ` · ${event.venueName}` : ''}
                    </p>
                    <StatusDot
                      status={STATUS_DOT[event.status]}
                      label={`${t(`eventStatus.${event.status}`)} · ${t(`phase.${phase.phase}`, { days: phase.days })}`}
                    />
                    <Link
                      href={`/o/${org}/e/${event.slug}`}
                      className={buttonClass('secondary', 'md', 'mt-auto self-start')}
                    >
                      {t('orgHome.open')}
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
          {pageCount > 1 ? (
            <Pagination
              label={tp('label')}
              link={Link}
              previous={{ href: at > 1 ? pageHref(at - 1) : null, label: tp('previous') }}
              next={{ href: at < pageCount ? pageHref(at + 1) : null, label: tp('next') }}
              status={tp('status', { page: at, count: pageCount })}
            />
          ) : null}
        </>
      )}
    </>
  );
}
