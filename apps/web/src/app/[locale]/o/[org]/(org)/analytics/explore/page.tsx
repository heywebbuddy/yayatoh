import {
  addDays,
  applyUnpublishedWarehouseEvents,
  COUNT_MEASURES,
  EXPLORER_DIMENSIONS,
  type ExploreDto,
  GRANULARITIES,
  isAttributionMeasure,
  listSavedViewsQuery,
  MONEY_MEASURES,
  RANGE_PRESETS,
  warehouseFromEnv,
} from '@yayatoh/analytics';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery, requireOrg } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, EmptyState, Input, PageHeader, Select, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RowActionForm, SaveViewForm } from '@/components/analytics-pro-forms.tsx';
import { AnalyticsTabs } from '@/components/analytics-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import {
  type ExplorerChoice,
  explorerProblem,
  explorerQuery,
  parseExplorer,
  rowLabels,
  runExplorer,
  valueText,
} from '@/server/explorer.ts';
import { ports } from '@/server/ports.ts';
import { deleteViewAction, saveViewAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('analyticsPro.explore');
  return { title: t('title') };
}

/** Problems worded next to the dates; the touch-dimension one next to "Break down by". */
const DATE_PROBLEMS = new Set(['custom_needs_dates', 'from_after_to', 'range_too_long', 'invalid_date']);

/**
 * The curated explorer (M6.2b): one measure by one dimension over a period, from the warehouse,
 * in the org's time zone. A plain GET form (keyboard and no-script friendly, shareable URLs);
 * money measures and the money query only for members with `finance:read`; saved views per member;
 * CSV export of exactly what is shown.
 */
export default async function ExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  if (!data.modules.has('analytics_pro') || !roleCan(data.role, 'orders:read')) notFound();
  const t = await getTranslations('analyticsPro.explore');
  const canMoney = roleCan(data.role, 'finance:read');
  await applyUnpublishedWarehouseEvents(requireOrg(data.ctx), warehouseFromEnv());

  const parsed = parseExplorer(sp, canMoney);
  let choice: ExplorerChoice = parsed.choice;
  let problem: string | null = parsed.badDate ? 'invalid_date' : null;
  let dto: ExploreDto;
  try {
    if (problem) throw Object.assign(new Error('bad date'), { skip: true });
    dto = await runExplorer(data, choice);
  } catch (err) {
    problem ??= explorerProblem(err);
    if (!problem) throw err;
    // Show the default view of the same measure under the inline message.
    choice = {
      ...choice,
      range: '30d',
      dimension: problem === 'touch_dimension' ? 'period' : choice.dimension,
      ...(problem === 'not_found' ? { eventId: undefined } : {}),
    };
    dto = await runExplorer(data, choice);
    if (problem === 'not_found') problem = null;
  }
  const events = await executeQuery(listEventsQuery, {}, data.ctx, ports);
  const views = await executeQuery(listSavedViewsQuery, {}, data.ctx, ports);
  const labels = await rowLabels(data, dto, locale, {
    none: t('none'),
    unnamedCampaign: t('unnamedCampaign'),
    weekOf: (d) => t('weekOf', { day: d }),
  });
  const base = `/o/${org}/analytics/explore`;
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const attribution = isAttributionMeasure(dto.measure);
  const empty = dto.rows.every((r) => r.value === 0);
  const fmtDay = (d: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium' }).format(
      new Date(`${d}T12:00:00Z`),
    );
  const dateError =
    problem && DATE_PROBLEMS.has(problem) ? t(`errors.${problem}` as 'errors.invalid_date') : undefined;
  const dimError = problem === 'touch_dimension' ? t('errors.touch_dimension') : undefined;
  const shown = parsed.choice;
  const done = sp.done === 'saved' ? t('saved') : sp.done === 'deleted' ? t('deleted') : null;
  const viewHref = (v: (typeof views)[number]) =>
    `${base}?${explorerQuery({
      measure: v.measure,
      dimension: v.dimension,
      model: v.model ?? 'linear',
      range: v.range,
      granularity: v.granularity,
      ...(v.from ? { from: v.from } : {}),
      ...(v.to ? { to: v.to } : {}),
      ...(v.eventId ? { eventId: v.eventId } : {}),
    })}`;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AnalyticsTabs org={org} current="explore" />
      {done ? (
        <div role="status">
          <Alert tone="success" title={done} />
        </div>
      ) : null}
      <Card className="flex flex-col gap-4">
        <form
          method="get"
          action={`${prefix}${base}`}
          className="flex flex-col gap-4"
          aria-labelledby="explore-form-heading"
          data-testid="explore-form"
        >
          <h2 id="explore-form-heading" className="text-section">
            {t('form')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select id="explore-measure" name="measure" label={t('measure')} defaultValue={shown.measure}>
              <optgroup label={t('groupCounts')}>
                {COUNT_MEASURES.filter((m) => m !== 'attributed_orders').map((m) => (
                  <option key={m} value={m}>
                    {t(`measures.${m}`)}
                  </option>
                ))}
              </optgroup>
              {canMoney ? (
                <optgroup label={t('groupMoney')}>
                  {MONEY_MEASURES.filter((m) => m !== 'attributed_revenue').map((m) => (
                    <option key={m} value={m}>
                      {t(`measures.${m}`)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label={t('groupAttribution')}>
                <option value="attributed_orders">{t('measures.attributed_orders')}</option>
                {canMoney ? (
                  <option value="attributed_revenue">{t('measures.attributed_revenue')}</option>
                ) : null}
              </optgroup>
            </Select>
            <Select
              id="explore-dimension"
              name="dim"
              label={t('dimension')}
              defaultValue={shown.dimension}
              error={dimError}
            >
              {EXPLORER_DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`dimensions.${d}`)}
                </option>
              ))}
            </Select>
            <Select
              id="explore-model"
              name="model"
              label={t('model')}
              hint={t('modelHint')}
              defaultValue={shown.model}
            >
              {(['first', 'last', 'linear'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`models.${m}`)}
                </option>
              ))}
            </Select>
            <Select id="explore-range" name="range" label={t('range')} defaultValue={shown.range}>
              {RANGE_PRESETS.map((r) => (
                <option key={r} value={r}>
                  {t(`ranges.${r}`)}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              id="explore-from"
              name="from"
              label={t('from')}
              hint={dateError ? undefined : t('customHint')}
              defaultValue={sp.from ?? (shown.range === 'custom' ? shown.from : undefined)}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? 'explore-to-error' : 'explore-from-hint'}
            />
            <Input
              type="date"
              id="explore-to"
              name="to"
              label={t('to')}
              defaultValue={sp.to ?? (shown.range === 'custom' ? shown.to : undefined)}
              error={dateError}
            />
            <Select id="explore-view" name="view" label={t('granularity')} defaultValue={shown.granularity}>
              {GRANULARITIES.map((g) => (
                <option key={g} value={g}>
                  {t(`granularities.${g}`)}
                </option>
              ))}
            </Select>
            <Select id="explore-event" name="event" label={t('event')} defaultValue={shown.eventId ?? ''}>
              <option value="">{t('allEvents')}</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" data-testid="explore-apply">
              {t('apply')}
            </Button>
            <a
              href={`${prefix}${base}/export?${explorerQuery(choice)}`}
              className={buttonClass('secondary')}
              aria-label={t('exportLabel')}
              data-testid="explore-export"
              download
            >
              {t('export')}
            </a>
          </div>
          <p className="m-0 text-caption text-ink-2">{t('timeZoneNote', { timeZone: dto.timeZone })}</p>
        </form>
      </Card>
      {empty ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyBody')}
          action={
            <Link
              href={`${base}?${explorerQuery({ ...choice, range: 'custom', from: addDays(dto.to, -364), to: dto.to, granularity: 'month' })}`}
              className={buttonClass('secondary')}
            >
              {t('emptyAction')}
            </Link>
          }
        />
      ) : (
        <div data-testid="explore-results">
          <Table
            caption={t('resultsCaption', {
              measure: t(`measures.${dto.measure}`),
              dimension: t(`dimensions.${dto.dimension}`),
              from: fmtDay(dto.from),
              to: fmtDay(dto.to),
            })}
            captionHidden={false}
            density="compact"
            stackOnPhone
            rowKey={(r) => `${r.key}|${r.currency ?? ''}`}
            rows={[...dto.rows, ...dto.totals.map((x) => ({ key: '__total', label: null, ...x }))]}
            columns={[
              {
                key: 'dimension',
                header: t(`dimensions.${dto.dimension}`),
                cell: (r) =>
                  r.key === '__total' ? <strong>{t('total')}</strong> : (labels.get(r.key) ?? r.key),
              },
              ...(dto.unit === 'minor'
                ? [
                    {
                      key: 'currency',
                      header: t('currency'),
                      cell: (r: (typeof dto.rows)[number]) => r.currency ?? '',
                    },
                  ]
                : []),
              {
                key: 'value',
                header: t(`measures.${dto.measure}`),
                align: 'end' as const,
                cell: (r) => {
                  const v = valueText(dto, r.value, r.currency, locale);
                  return r.key === '__total' ? <strong>{v}</strong> : v;
                },
              },
            ]}
          />
          {dto.truncated ? <p className="m-0 mt-2 text-caption text-ink-2">{t('truncated')}</p> : null}
        </div>
      )}
      {attribution ? <p className="m-0 text-caption text-ink-2">{t('attributionNote')}</p> : null}
      <Card className="flex flex-col gap-4">
        <SaveViewForm
          action={saveViewAction.bind(null, org)}
          view={Object.fromEntries(new URLSearchParams(explorerQuery(choice)))}
        />
        <section aria-labelledby="views-heading" className="flex flex-col gap-2">
          <h2 id="views-heading" className="text-section">
            {t('views')}
          </h2>
          {views.length === 0 ? (
            <p className="m-0 text-body text-ink-2">{t('noViews')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="saved-views">
              {views.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={viewHref(v)}
                    className="min-h-6 font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {v.name}
                  </Link>
                  <RowActionForm
                    action={deleteViewAction.bind(null, org)}
                    fields={{ viewId: v.id }}
                    label={t('deleteView')}
                    ariaLabel={t('deleteViewLabel', { name: v.name })}
                    variant="ghost"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>
    </>
  );
}
