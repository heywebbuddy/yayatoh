import { orgCategoriesQuery, orgTagsQuery, searchEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, Label, PageHeader, Pagination, Select, StatusDot } from '@yayatoh/ui';
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

type EventStatus = keyof typeof STATUS_DOT;
const STATUSES = Object.keys(STATUS_DOT) as EventStatus[];
const isStatus = (v: string | undefined): v is EventStatus => STATUSES.includes(v as EventStatus);

const EVENTS_PER_PAGE = 24;

/**
 * The org's events (QA #35): searched by name and filtered by status, category and tag, with the
 * same fields and "Filter" / "Clear filters" as the org home's list; the count follows the filters.
 */
export default async function OrgEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ q?: string; status?: string; category?: string; tag?: string; page?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsoleBase(org);
  if (!roleCan(data.role, 'events:read')) notFound();

  const q = sp.q?.trim().slice(0, 80) || undefined;
  const status = isStatus(sp.status) ? sp.status : undefined;
  // U8: an org category ref (platform key of an unchanged default, else its id).
  const category = sp.category?.trim().slice(0, 80) || undefined;
  const tag = sp.tag?.trim().slice(0, 40) || undefined;
  const filtered = Boolean(q || status || category || tag);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const [all, categories, tags, t, tp] = await Promise.all([
    executeQuery(searchEventsQuery, { q, categoryRef: category, tag }, data.ctx, ports),
    executeQuery(orgCategoriesQuery, {}, data.ctx, ports),
    executeQuery(orgTagsQuery, {}, data.ctx, ports),
    getTranslations(),
    getTranslations('market.pagination'),
  ]);
  const platformLabel = await categoryLabels((key) => t(`categories.${key}`));
  const listed = status ? all.filter((event) => event.status === status) : all;
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
    for (const [k, v] of Object.entries({ q, status, category, tag })) if (v) query.set(k, v);
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
        {/* Keyed by the filters: after "Clear filters" (a client navigation) the fields show the new values. */}
        <form
          key={`${q ?? ''}|${status ?? ''}|${category ?? ''}|${tag ?? ''}`}
          method="get"
          className="flex flex-wrap items-end gap-3"
        >
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="events-status" className="text-[13px] font-bold text-ink">
              {t('eventFilters.status')}
            </label>
            <Select id="events-status" name="status" defaultValue={status ?? ''} className="field">
              <option value="">{t('eventFilters.anyStatus')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`eventStatus.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="events-category" className="text-[13px] font-bold text-ink">
              {t('eventFilters.category')}
            </label>
            <Select id="events-category" name="category" defaultValue={category ?? ''} className="field">
              <option value="">{t('eventFilters.anyCategory')}</option>
              {categories.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.name ?? platformLabel(c.platformKey)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="events-tag" className="text-[13px] font-bold text-ink">
              {t('eventFilters.tag')}
            </label>
            <Select id="events-tag" name="tag" defaultValue={tag?.toLowerCase() ?? ''} className="field">
              <option value="">{t('eventFilters.anyTag')}</option>
              {tags.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.tag}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonClass('secondary')}>
            {t('eventFilters.apply')}
          </button>
          {filtered ? (
            <Link
              href={`/o/${org}/events`}
              className="inline-flex min-h-10 items-center text-caption underline underline-offset-2"
            >
              {t('eventFilters.clear')}
            </Link>
          ) : null}
        </form>
      </search>
      {events.length === 0 ? (
        <EmptyState
          title={filtered ? t('eventFilters.noneTitle') : t('orgHome.emptyTitle')}
          description={filtered ? t('eventFilters.noneDescription') : t('orgHome.emptyDescription')}
          action={
            filtered ? (
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
