import {
  addDays,
  applyUnpublishedWarehouseEvents,
  backfillStatusQuery,
  GRANULARITIES,
  type Granularity,
  type OrgDashboardDto,
  type OrgRevenueDto,
  orgDashboardQuery,
  orgRevenueQuery,
  warehouseFromEnv,
} from '@yayatoh/analytics';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery, isDomainError, requireOrg } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, StatusPill, Tabs, tabClass } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AnalyticsFilters,
  CountsOverTime,
  CountTiles,
  RevenueTiles,
  TopEvents,
} from '@/components/org-analytics.tsx';
import { RebuildAnalyticsForm } from '@/components/org-analytics-rebuild.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { startBackfillAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('warehouse');
  return { title: t('title') };
}

const RANGE_REASONS = new Set(['from_after_to', 'range_too_long']);
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/**
 * Org analytics (M6.2a): cross-event dashboards from the analytics warehouse — registrations,
 * tickets, check-ins, no-shows and top events by day, week or month in the org's time zone, with
 * an event filter. Revenue (per currency) only for members with `finance:read`. Needs the
 * `analytics_pro` module and `orders:read`. Owners and admins can rebuild the warehouse.
 */
export default async function OrgAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ view?: string; from?: string; to?: string; event?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  if (!data.modules.has('analytics_pro') || !roleCan(data.role, 'orders:read')) notFound();
  const t = await getTranslations('warehouse');
  const granularity: Granularity = (GRANULARITIES as readonly string[]).includes(sp.view ?? '')
    ? (sp.view as Granularity)
    : 'day';
  const canMoney = roleCan(data.role, 'finance:read');
  const canRebuild = roleCan(data.role, 'org:update');
  // Read-your-writes: what the worker has not ingested yet (about a second in production).
  await applyUnpublishedWarehouseEvents(requireOrg(data.ctx), warehouseFromEnv());

  let error: string | null = null;
  let input = { granularity, from: day(sp.from), to: day(sp.to), eventId: uuid(sp.event) };
  if ((sp.from && !input.from) || (sp.to && !input.to)) error = 'invalid_date';
  let dashboard: OrgDashboardDto;
  try {
    dashboard = await executeQuery(orgDashboardQuery, input, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = String(err.details?.reason ?? '');
    if (err.code === 'validation_failed' && RANGE_REASONS.has(reason)) error = reason;
    else if (err.code !== 'not_found') throw err;
    input = {
      granularity,
      from: undefined,
      to: undefined,
      eventId: err.code === 'not_found' ? undefined : input.eventId,
    };
    dashboard = await executeQuery(orgDashboardQuery, input, data.ctx, ports);
  }
  const revenue: OrgRevenueDto | null = canMoney
    ? await executeQuery(orgRevenueQuery, input, data.ctx, ports)
    : null;
  const events = await executeQuery(listEventsQuery, {}, data.ctx, ports);
  const run = canRebuild ? await executeQuery(backfillStatusQuery, {}, data.ctx, ports) : null;

  const base = `/o/${org}/analytics`;
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const range = error ? { from: sp.from ?? dashboard.from, to: sp.to ?? dashboard.to } : dashboard;
  const qs = (over: Record<string, string>) =>
    `?${new URLSearchParams({
      view: granularity,
      from: dashboard.from,
      to: dashboard.to,
      ...(dashboard.eventId ? { event: dashboard.eventId } : {}),
      ...over,
    }).toString()}`;
  const hasMoney = (revenue?.totals ?? []).some((m) => m.grossMinor !== 0 || m.refundsMinor !== 0);
  const empty = !dashboard.hasData && !hasMoney;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AnalyticsFilters
        action={`${prefix}${base}`}
        from={range.from}
        to={range.to}
        eventId={dashboard.eventId}
        granularity={granularity}
        events={events.map((e) => ({ id: e.id, name: e.name }))}
        timeZone={dashboard.timeZone}
        error={error}
      />
      <Tabs label={t('periodLabel')}>
        {GRANULARITIES.map((g) => (
          <Link
            key={g}
            href={`${base}${qs({ view: g })}`}
            aria-current={g === granularity ? 'page' : undefined}
            className={tabClass(g === granularity)}
            data-testid={`analytics-view-${g}`}
          >
            {t(`view.${g}`)}
          </Link>
        ))}
      </Tabs>
      {empty ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyBody')}
          action={
            <Link
              href={`${base}${qs({ from: addDays(dashboard.to, -364), view: 'month' })}`}
              className={buttonClass('secondary')}
            >
              {t('emptyAction')}
            </Link>
          }
        />
      ) : (
        <>
          <CountTiles totals={dashboard.totals} locale={locale} />
          {revenue ? <RevenueTiles revenue={revenue} locale={locale} /> : null}
          <CountsOverTime dashboard={dashboard} locale={locale} />
          <TopEvents rows={dashboard.topEvents} orgBase={`/o/${org}`} locale={locale} />
        </>
      )}
      <p className="m-0 text-caption text-ink-2">{canMoney ? t('definitionsFinance') : t('definitions')}</p>
      {canRebuild ? (
        <Card className="flex flex-col gap-3" data-testid="analytics-rebuild-card">
          <h2 className="text-section">{t('rebuildTitle')}</h2>
          <p className="m-0 text-body text-ink-2">{t('rebuildBody')}</p>
          {run ? (
            <p
              className="m-0 flex flex-wrap items-center gap-2 text-body"
              data-testid="analytics-rebuild-status"
            >
              <StatusPill
                tone={run.status === 'done' ? 'success' : run.status === 'running' ? 'info' : 'danger'}
                label={t(`runStatus.${run.status}`)}
                live={run.status === 'running'}
              />
              {t('runProgress', { events: run.eventsDone, written: run.eventsWritten })}
            </p>
          ) : null}
          <RebuildAnalyticsForm
            action={startBackfillAction.bind(null, org)}
            running={run?.status === 'running'}
          />
        </Card>
      ) : null}
    </>
  );
}
