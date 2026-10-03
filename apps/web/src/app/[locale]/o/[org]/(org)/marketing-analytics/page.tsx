import { executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  type AnalyticsReportDto,
  analyticsReportQuery,
  DIMENSIONS,
  type Dimension,
} from '@yayatoh/marketing';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, PageHeader, SectionHeader, Tabs, tabClass } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AnalyticsRows, FigureTiles, RangeForm } from '@/components/marketing-analytics.tsx';
import { Link } from '@/i18n/navigation.ts';
import { nameCampaignRows } from '@/server/campaign-names.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketingAnalytics');
  return { title: t('title') };
}

const RANGE_REASONS = new Set(['invalid_date', 'from_after_to', 'range_too_long']);
const day = (v: string | undefined) => (v && v.length <= 10 ? v : undefined);

/**
 * Marketing analytics (M3.8b): campaign → registrations and revenue per campaign, channel and
 * link over a date range in the org's time zone, first and last touch, with the CSV export and a
 * link to email deliverability. Needs the marketing module and `marketing:read`.
 */
export default async function MarketingAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ view?: string; from?: string; to?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read')) notFound();
  const t = await getTranslations('marketingAnalytics');
  const view: Dimension = (DIMENSIONS as readonly string[]).includes(sp.view ?? '')
    ? (sp.view as Dimension)
    : 'campaign';
  let error: string | null = null;
  let report: AnalyticsReportDto;
  try {
    report = await executeQuery(
      analyticsReportQuery,
      { dimension: view, from: day(sp.from), to: day(sp.to) },
      data.ctx,
      ports,
    );
  } catch (err) {
    const reason = isDomainError(err) ? String(err.details?.reason ?? '') : '';
    if (!isDomainError(err) || err.code !== 'validation_failed' || !RANGE_REASONS.has(reason)) throw err;
    error = reason;
    report = await executeQuery(analyticsReportQuery, { dimension: view }, data.ctx, ports);
  }
  // Batch 3g merge: messaging campaigns by their M3.6b name.
  report = { ...report, rows: await nameCampaignRows(data.ctx, report.rows) };
  const base = `/o/${org}/marketing-analytics`;
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const range = error
    ? { from: sp.from ?? report.fromDay, to: sp.to ?? report.toDay }
    : { from: report.fromDay, to: report.toDay };
  const qs = (v: Dimension) =>
    `?${new URLSearchParams({ view: v, from: report.fromDay, to: report.toDay }).toString()}`;
  const canDeliverability = roleCan(data.role, 'messages:read');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <a
            href={`${prefix}${base}/export${qs(view)}`}
            download
            className={buttonClass('secondary')}
            data-testid="analytics-export"
          >
            {t('export')}
          </a>
        }
      />
      <RangeForm
        action={`${prefix}${base}`}
        from={range.from}
        to={range.to}
        timeZone={report.timeZone}
        currency={report.currency}
        error={error}
        hidden={{ view }}
      />
      <FigureTiles
        figures={report.totals}
        currency={report.currency}
        locale={locale}
        label={t('summaryLabel')}
      />
      {report.totals.otherCurrencyOrders > 0 ? (
        <p className="text-caption text-ink-2">
          {t('otherCurrency', { count: report.totals.otherCurrencyOrders })}
        </p>
      ) : null}
      <Tabs label={t('viewLabel')} className="self-start">
        {DIMENSIONS.map((v) => (
          <Link
            key={v}
            href={`${base}${qs(v)}`}
            aria-current={v === view ? 'page' : undefined}
            className={tabClass(v === view)}
          >
            {t(`view.${v}`)}
          </Link>
        ))}
      </Tabs>
      <section aria-labelledby="rows-heading" className="flex flex-col gap-3">
        <SectionHeader id="rows-heading" title={t(`view.${view}`)} count={report.rows.length} />
        <AnalyticsRows
          view={view}
          rows={report.rows}
          currency={report.currency}
          locale={locale}
          href={(r) =>
            r.kind === 'campaign' || r.kind === 'utm'
              ? `${base}/campaign?${new URLSearchParams({ key: r.key, from: report.fromDay, to: report.toDay }).toString()}`
              : null
          }
        />
        <p className="text-caption text-ink-2">{t('creditNote')}</p>
      </section>
      {canDeliverability ? (
        <Card tone="feature" className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="m-0 text-card text-ink">{t('deliverabilityLink')}</h2>
            <p className="m-0 text-body text-ink-2">{t('deliverabilityTeaser')}</p>
          </div>
          <Link href={`${base}/deliverability`} className={buttonClass('secondary')}>
            {t('openDeliverability')}
          </Link>
        </Card>
      ) : null}
    </>
  );
}
