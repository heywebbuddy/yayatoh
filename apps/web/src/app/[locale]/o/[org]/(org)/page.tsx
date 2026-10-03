import {
  EVENT_CATEGORIES,
  type EventCategory,
  listEventsQuery,
  listSeriesQuery,
  orgTagsQuery,
  searchEventsQuery,
} from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { payoutAccountQuery } from '@yayatoh/payments';
import {
  legalPagesQuery,
  listInvitationsQuery,
  listMembersQuery,
  onboardingQuery,
  roleCan,
  suspensionsQuery,
} from '@yayatoh/tenancy';
import { sellsPaidTicketsQuery } from '@yayatoh/ticketing';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  EmptyState,
  Label,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  StatusDot,
} from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { MyTeamEvents } from '@/components/my-team-events.tsx';
import { OrgSales } from '@/components/org-sales.tsx';
import { Link } from '@/i18n/navigation.ts';
import { eventPhase, greetingKey } from '@/lib/event-status.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { resolvePeriod } from '@/lib/period.ts';
import { loadConsole, loadConsoleBase } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { completeOnboardingAction } from './onboarding-actions.ts';

const STATUS_DOT = {
  draft: 'neutral',
  published: 'success',
  postponed: 'warning',
  cancelled: 'danger',
  completed: 'info',
  archived: 'info',
} as const;

export default async function OrgHome({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    series?: string;
    category?: string;
    tag?: string;
    /** Design v2: the events list's name search and page. */
    q?: string;
    page?: string;
    /** M3.11a: the outcome of "Finish setup". */
    onboarding?: string;
  }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsoleBase(org);
  // M4.2a: someone invited to specific events lands on a console listing just those events.
  if (data.role === 'collaborator') return <MyTeamEvents data={data} org={org} locale={locale} />;
  const t = await getTranslations();
  const firstName = data.session.name.split(' ')[0] ?? data.session.name;
  const canWrite = roleCan(data.role, 'events:write');
  const paused = await executeQuery(suspensionsQuery, {}, data.ctx, ports);
  const create = canWrite ? (
    <Link href={`/o/${org}/events/new/guided`} className={buttonClass('primary')}>
      {t('orgHome.create')}
    </Link>
  ) : undefined;
  return (
    <>
      <PageHeader
        title={t(`greeting.${greetingKey(data.org.timezone)}`, { name: firstName })}
        description={data.org.name}
        actions={create}
      />
      {paused.length > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-card border border-primary bg-primary-soft px-4 py-3 text-body text-primary-ink"
        >
          {paused.map((p) => (
            <p key={p.kind}>{t(`suspensions.${p.kind}`)}</p>
          ))}
          <p className="text-caption">{t('suspensions.contact')}</p>
        </div>
      ) : null}
      {roleCan(data.role, 'org:update') ? <SetupChecklist org={org} outcome={sp.onboarding ?? null} /> : null}
      {data.modules.has('reports') && roleCan(data.role, 'orders:read') ? (
        <OrgSales
          data={data}
          org={org}
          locale={locale}
          period={resolvePeriod(sp, data.org.timezone, new Date())}
        />
      ) : null}
      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <h2 id="events-heading" className="text-section">
          {t('orgHome.events')}
        </h2>
        <Suspense fallback={<EventsSkeleton label={t('common.loading')} />}>
          <EventList
            org={org}
            locale={locale}
            create={create}
            seriesSlug={sp.series ?? null}
            filters={{
              category: (EVENT_CATEGORIES as readonly string[]).includes(sp.category ?? '')
                ? (sp.category as EventCategory)
                : undefined,
              tag: sp.tag?.trim().slice(0, 40) || undefined,
              q: sp.q?.trim().slice(0, 80) || undefined,
            }}
            page={Math.max(1, Math.floor(Number(sp.page)) || 1)}
            keep={{ period: sp.period, from: sp.from, to: sp.to }}
          />
        </Suspense>
      </section>
    </>
  );
}

function EventsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
    </div>
  );
}

/** Events cards per page on the org home (design v2: the page stays light with hundreds of events). */
const EVENTS_PER_PAGE = 24;

async function EventList({
  org,
  locale,
  create,
  seriesSlug,
  filters,
  page,
  keep,
}: {
  org: string;
  locale: string;
  create: ReactNode;
  /** M1.4b: show only this series' events. */
  seriesSlug: string | null;
  filters: { category?: EventCategory; tag?: string; q?: string };
  page: number;
  /** Other parameters of the page (the sales period) that the list's links keep. */
  keep: Record<string, string | undefined>;
}) {
  const data = await loadConsole(org);
  const t = await getTranslations();
  const filtered = Boolean(filters.category || filters.tag || filters.q);
  const [all, series, tags] = await Promise.all([
    executeQuery(searchEventsQuery, filters, data.ctx, ports),
    executeQuery(listSeriesQuery, {}, data.ctx, ports),
    executeQuery(orgTagsQuery, {}, data.ctx, ports),
  ]);
  const active = series.find((s) => s.slug === seriesSlug) ?? null;
  const listed = all.filter((e) => e.status !== 'archived' && (!active || active.eventIds.includes(e.id)));
  // Design v2: what is on now and next first (soonest start), then past events (latest first),
  // a page at a time: an org with hundreds of events renders 24 cards, not all of them.
  const now = Date.now();
  const current = listed.filter((e) => e.endsAt.getTime() >= now);
  const past = listed.filter((e) => e.endsAt.getTime() < now).reverse();
  const ordered = [...current, ...past];
  const pageCount = Math.max(1, Math.ceil(ordered.length / EVENTS_PER_PAGE));
  const at = Math.min(page, pageCount);
  const events = ordered.slice((at - 1) * EVENTS_PER_PAGE, at * EVENTS_PER_PAGE);
  const tp = await getTranslations('market.pagination');
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    const params = {
      ...keep,
      series: active?.slug,
      category: filters.category,
      tag: filters.tag,
      q: filters.q,
    };
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return qs ? `/o/${org}?${qs}` : `/o/${org}`;
  };
  const chip = (current: boolean) =>
    `inline-flex min-h-8 items-center rounded-pill border px-3 text-caption ${current ? 'border-ink bg-tag text-white' : 'border-line bg-surface text-ink-2'}`;
  const selectClass = 'field';
  return (
    <>
      {series.length > 0 ? (
        <nav aria-label={t('orgHome.seriesFilter')}>
          <ul className="flex list-none flex-wrap gap-2 p-0">
            <li>
              <Link href={`/o/${org}`} aria-current={active ? undefined : 'page'} className={chip(!active)}>
                {t('orgHome.allEvents')}
              </Link>
            </li>
            {series.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/o/${org}?series=${s.slug}`}
                  aria-current={active?.id === s.id ? 'page' : undefined}
                  className={chip(active?.id === s.id)}
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <search aria-label={t('eventFilters.label')}>
        {/* Keyed by the filters: after "Clear filters" (a client navigation) the fields show the new values. */}
        <form
          key={`${active?.slug ?? ''}|${filters.category ?? ''}|${filters.tag ?? ''}|${filters.q ?? ''}`}
          method="get"
          className="flex flex-wrap items-end gap-3"
        >
          {active ? <input type="hidden" name="series" value={active.slug} /> : null}
          <div className="flex min-w-0 grow flex-col gap-1.5 sm:max-w-80">
            <label htmlFor="filter-q" className="text-[13px] font-bold text-ink">
              {t('eventFilters.search')}
            </label>
            <input
              id="filter-q"
              name="q"
              type="search"
              maxLength={80}
              defaultValue={filters.q ?? ''}
              className={selectClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-category" className="text-[13px] font-bold text-ink">
              {t('eventFilters.category')}
            </label>
            <Select
              id="filter-category"
              name="category"
              defaultValue={filters.category ?? ''}
              className={selectClass}
            >
              <option value="">{t('eventFilters.anyCategory')}</option>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-tag" className="text-[13px] font-bold text-ink">
              {t('eventFilters.tag')}
            </label>
            <Select
              id="filter-tag"
              name="tag"
              defaultValue={filters.tag?.toLowerCase() ?? ''}
              className={selectClass}
            >
              <option value="">{t('eventFilters.anyTag')}</option>
              {tags.map((tag) => (
                <option key={tag.key} value={tag.key}>
                  {tag.tag}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonClass('secondary')}>
            {t('eventFilters.apply')}
          </button>
          {filtered ? (
            <Link
              href={active ? `/o/${org}?series=${active.slug}` : `/o/${org}`}
              className="inline-flex min-h-10 items-center text-caption underline underline-offset-2"
            >
              {t('eventFilters.clear')}
            </Link>
          ) : null}
        </form>
      </search>
      {events.length === 0 && filtered ? (
        <EmptyState title={t('eventFilters.noneTitle')} description={t('eventFilters.noneDescription')} />
      ) : events.length === 0 && active ? (
        <EmptyState
          title={t('orgHome.seriesEmptyTitle', { name: active.name })}
          description={t('orgHome.seriesEmptyDescription')}
        />
      ) : events.length === 0 ? (
        <EmptyState
          title={t('orgHome.emptyTitle')}
          description={t('orgHome.emptyDescription')}
          action={create}
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
            {events.map((e) => {
              const phase = eventPhase(e.startsAt.toISOString(), e.endsAt.toISOString());
              return (
                <li key={e.id}>
                  <Card className="flex h-full flex-col gap-3">
                    <Label>
                      {t(`profiles.${e.profile}`)}
                      {e.category ? ` · ${t(`categories.${e.category as EventCategory}`)}` : ''}
                    </Label>
                    <h3 className="text-[22px] leading-tight font-extrabold tracking-[-0.03em]">{e.name}</h3>
                    <p className="text-body text-ink-2">
                      {formatEventDateRange(e.startsAt.toISOString(), e.endsAt.toISOString(), {
                        locale,
                        currency: e.currency,
                        timeZone: e.timezone,
                      })}
                      {e.venueName ? ` · ${e.venueName}` : ''}
                    </p>
                    {e.tags.length > 0 ? (
                      <ul
                        aria-label={t('eventFilters.tags')}
                        className="flex list-none flex-wrap gap-1.5 p-0"
                      >
                        {e.tags.map((tag) => (
                          <li
                            key={tag}
                            className="rounded-pill bg-surface-3 px-2.5 py-0.5 text-caption text-ink-2"
                          >
                            {tag}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <StatusDot
                      status={STATUS_DOT[e.status]}
                      label={`${t(`eventStatus.${e.status}`)} · ${t(`phase.${phase.phase}`, { days: phase.days })}`}
                    />
                    <Link
                      href={`/o/${org}/e/${e.slug}`}
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

/**
 * Setup checklist (M1.3; onboarding M3.11a): what an organizer still needs before selling, each
 * item linking to where it is done. Progress persists: a step once done stays done (recorded by
 * the command that did it), whatever changes later; the terms follow the current version.
 * Payouts join the list once the org sells paid tickets. A self-serve org in setup mode
 * (`limited`) also sees the required steps and "Finish setup". Hidden once everything is done.
 */
async function SetupChecklist({ org, outcome }: { org: string; outcome: string | null }) {
  const data = await loadConsole(org);
  const t = await getTranslations('setup');
  const [onboarding, legal, events, members, invitations, sells, payouts] = await Promise.all([
    executeQuery(onboardingQuery, {}, data.ctx, ports),
    executeQuery(legalPagesQuery, {}, data.ctx, ports),
    executeQuery(listEventsQuery, {}, data.ctx, ports),
    executeQuery(listMembersQuery, {}, data.ctx, ports),
    roleCan(data.role, 'members:manage') ? executeQuery(listInvitationsQuery, {}, data.ctx, ports) : [],
    data.modules.has('ticketing')
      ? executeQuery(sellsPaidTicketsQuery, {}, data.ctx, ports)
      : { paid: false },
    executeQuery(payoutAccountQuery, {}, data.ctx, ports),
  ]);
  const step = onboarding.steps;
  const settings = `/o/${org}/settings`;
  const items = [
    { key: 'terms', done: onboarding.termsCurrent, href: `${settings}#agreements-heading` },
    {
      key: 'legal',
      done: ['privacy', 'refund'].every((k) => legal.some((p) => p.kind === k)),
      href: `${settings}#legal-heading`,
    },
    {
      key: 'brand',
      done: step.brand !== null || data.org.brandColor !== null,
      href: `${settings}#brand-heading`,
    },
    { key: 'event', done: step.event !== null || events.length > 0, href: `/o/${org}/events/new/guided` },
    {
      key: 'team',
      done: step.team !== null || members.length > 1 || invitations.length > 0,
      href: `/o/${org}/team`,
    },
    ...(sells.paid
      ? [
          {
            key: 'payouts',
            done: step.payouts !== null || payouts.state === 'active',
            href: `/o/${org}/payouts`,
          },
        ]
      : []),
  ];
  const setupMode = onboarding.tracked && onboarding.status === 'limited' && !onboarding.completedAt;
  const doneCount = items.filter((i) => i.done).length;
  const notice =
    outcome === 'done' && !setupMode ? (
      <Alert tone="info" title={t('finished')} />
    ) : outcome === 'incomplete' || outcome === 'failed' ? (
      <Alert title={t(outcome === 'incomplete' ? 'incomplete' : 'finishFailed')} />
    ) : null;
  if (doneCount === items.length && !setupMode) return notice ? <div aria-live="polite">{notice}</div> : null;
  const requiredHref: Record<string, string> = {
    terms: `${settings}#agreements-heading`,
    privacy: `${settings}#legal-privacy`,
    event: `/o/${org}/events/new/guided`,
  };
  return (
    <section aria-labelledby="setup-heading" className="flex flex-col gap-3">
      <h2 id="setup-heading" className="text-section">
        {t('title', { done: doneCount, total: items.length })}
      </h2>
      <div aria-live="polite">{notice}</div>
      {setupMode ? (
        <Card className="flex flex-col gap-3">
          <h3 className="text-body font-semibold">{t('setupMode')}</h3>
          <p className="text-body text-ink-2">{t('setupModeBody')}</p>
          <ul aria-label={t('requiredList')} className="flex list-none flex-col gap-1 p-0">
            {onboarding.required.map((k) => {
              const done = !onboarding.missing.includes(k);
              return (
                <li key={k} className="flex min-h-11 items-center gap-3">
                  <StatusDot status={done ? 'success' : 'neutral'} label={done ? t('done') : t('todo')} />
                  {done ? (
                    <span className="text-ink-2 line-through">{t(`required.${k}`)}</span>
                  ) : (
                    <Link href={requiredHref[k] ?? settings} className="underline underline-offset-2">
                      {t(`required.${k}`)}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {onboarding.missing.length === 0 ? (
            <form action={completeOnboardingAction.bind(null, org)}>
              <Button type="submit">{t('finish')}</Button>
            </form>
          ) : (
            <p className="text-caption text-ink-2">{t('finishLater')}</p>
          )}
        </Card>
      ) : null}
      <Card className="flex flex-col">
        <ul className="flex list-none flex-col divide-y divide-line p-0">
          {items.map((i) => (
            <li key={i.key} className="flex min-h-11 items-center gap-3 py-2">
              <StatusDot status={i.done ? 'success' : 'neutral'} label={i.done ? t('done') : t('todo')} />
              {i.done ? (
                <span className="text-ink-2 line-through">{t(`item.${i.key}`)}</span>
              ) : (
                <Link href={i.href} className="underline underline-offset-2">
                  {t(`item.${i.key}`)}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
