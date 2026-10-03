import { type AlertRuleDto, isRuleMoney, listAlertRulesQuery, RULE_MEASURES } from '@yayatoh/analytics';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, buttonClass, EmptyState, PageHeader, StatusPill, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AlertRuleForm, RowActionForm } from '@/components/analytics-pro-forms.tsx';
import { AnalyticsTabs } from '@/components/analytics-tabs.tsx';
import { moneyText } from '@/components/marketing-analytics.tsx';
import { Link } from '@/i18n/navigation.ts';
import { ruleCurrencies } from '@/server/analytics-pro.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createRuleAction, deleteRuleAction, toggleRuleAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('analyticsPro.rules');
  return { title: t('title') };
}

const DONE = ['created', 'saved', 'on', 'off', 'deleted'] as const;

/**
 * Organizer-authored alert rules (M6.2b) on the M3.2b engine: create, edit, switch off and on,
 * delete. Everyone who reads orders sees the count rules (money rules only with finance); writing
 * needs `alerts:manage`. A rule's alert appears in Alerts and goes out through its routing.
 */
export default async function AlertRulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  if (!data.modules.has('analytics_pro') || !roleCan(data.role, 'orders:read')) notFound();
  const t = await getTranslations('analyticsPro.rules');
  const canWrite = roleCan(data.role, 'alerts:manage');
  const canMoney = roleCan(data.role, 'finance:read');
  const rules = await executeQuery(listAlertRulesQuery, {}, data.ctx, ports);
  const events = await executeQuery(listEventsQuery, {}, data.ctx, ports);
  const measures = RULE_MEASURES.filter((m) => canMoney || !isRuleMoney(m));
  const done = DONE.find((d) => d === sp.done);
  const doneText = done
    ? {
        created: t('created'),
        saved: t('saved'),
        on: t('turnedOn'),
        off: t('turnedOff'),
        deleted: t('deleted'),
      }[done]
    : null;
  const reading = (r: AlertRuleDto, v: number) =>
    isRuleMoney(r.measure)
      ? moneyText(v, r.currency || 'USD', locale)
      : new Intl.NumberFormat(locale).format(v);
  const thresholdShown = (r: AlertRuleDto) =>
    r.condition === 'rise' || r.condition === 'drop'
      ? `${new Intl.NumberFormat(locale).format(r.threshold)} %`
      : reading(r, r.threshold);
  const summary = (r: AlertRuleDto) =>
    t('summary', {
      measure: t(`measures.${r.measure}`),
      condition: t(`conditions.${r.condition}`),
      threshold: thresholdShown(r),
      window: t(`windows.d${r.windowDays}` as 'windows.d1').toLowerCase(),
    });
  const status = (r: AlertRuleDto) =>
    !r.enabled ? 'off' : r.state === 'firing' ? 'firing' : r.state === 'ok' ? 'ok' : 'new';

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AnalyticsTabs org={org} current="alerts" />
      {doneText ? (
        <div role="status">
          <Alert tone="success" title={doneText} />
        </div>
      ) : null}
      {canWrite ? (
        <AlertRuleForm
          action={createRuleAction.bind(null, org)}
          measures={measures}
          moneyMeasures={measures.filter((m) => isRuleMoney(m))}
          events={events.map((e) => ({ id: e.id, name: e.name }))}
          currencies={ruleCurrencies(data, events)}
          mode="create"
        />
      ) : (
        <p className="m-0 text-body text-ink-2">{t('readOnly')}</p>
      )}
      {rules.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <Table
          caption={t('list')}
          captionHidden={false}
          density="compact"
          stackOnPhone
          rowKey={(r) => r.id}
          rows={rules}
          columns={[
            {
              key: 'name',
              header: t('columns.name'),
              cell: (r) => <span className="font-semibold">{r.name}</span>,
            },
            { key: 'condition', header: t('columns.condition'), cell: summary },
            {
              key: 'status',
              header: t('columns.status'),
              cell: (r) => {
                const s = status(r);
                return (
                  <span data-testid={`rule-status-${r.id}`}>
                    <StatusPill
                      tone={s === 'firing' ? 'danger' : s === 'ok' ? 'success' : 'neutral'}
                      label={t(`status.${s}`)}
                    />
                  </span>
                );
              },
            },
            {
              key: 'last',
              header: t('columns.lastValue'),
              align: 'end',
              cell: (r) => (r.lastValue === null ? '—' : reading(r, r.lastValue)),
            },
            ...(canWrite
              ? [
                  {
                    key: 'actions',
                    header: t('columns.actions'),
                    cell: (r: AlertRuleDto) => (
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/o/${org}/analytics/alerts/${r.id}`}
                          className={buttonClass('secondary', 'sm')}
                          aria-label={t('editLabel', { name: r.name })}
                        >
                          {t('edit')}
                        </Link>
                        <RowActionForm
                          action={toggleRuleAction.bind(null, org)}
                          fields={{ ruleId: r.id, enabled: r.enabled ? '0' : '1' }}
                          label={r.enabled ? t('turnOff') : t('turnOn')}
                          ariaLabel={
                            r.enabled
                              ? t('turnOffLabel', { name: r.name })
                              : t('turnOnLabel', { name: r.name })
                          }
                        />
                        <RowActionForm
                          action={deleteRuleAction.bind(null, org)}
                          fields={{ ruleId: r.id }}
                          label={t('delete')}
                          ariaLabel={t('deleteLabel', { name: r.name })}
                          variant="ghost"
                        />
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}
