import { METERS, type Meter, usageSummaryQuery } from '@yayatoh/billing';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import {
  Alert,
  Breadcrumb,
  EmptyState,
  PageHeader,
  SectionHeader,
  StatCard,
  Table,
  Tabs,
  tabClass,
} from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const isMeter = (m: string | undefined): m is Meter => (METERS as readonly string[]).includes(m ?? '');

/**
 * Usage (M6.6b): what the org's meters counted (messages per channel, AI credits, scan devices)
 * this month and in the months before, in the org's time zone. Owners, admins and finance. While
 * billing is dormant usage is still counted; nothing is charged.
 */
export default async function UsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ meter?: string }>;
}) {
  const { locale, org } = await params;
  const { meter } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('billingUsage');
  const tp = await getTranslations('billingPlan');
  const breadcrumb = (
    <Breadcrumb
      label={t('breadcrumb')}
      items={[{ label: tp('title'), href: `/${locale}/o/${org}/plan` }, { label: t('title') }]}
    />
  );
  if (!roleCan(data.role, 'billing:read')) {
    return (
      <>
        <PageHeader breadcrumb={breadcrumb} title={t('title')} description={t('subtitle')} />
        <EmptyState title={tp('noAccessTitle')} description={tp('noAccessDescription')} />
      </>
    );
  }
  const selected = isMeter(meter) ? meter : undefined;
  const u = await executeQuery(
    usageSummaryQuery,
    { timeZone: data.org.timezone, ...(selected ? { meter: selected } : {}) },
    data.ctx,
    ports,
  );
  const n = new Intl.NumberFormat(locale);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const monthName = (ym: string) =>
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${ym}-15T00:00:00Z`),
    );
  const lastDay = new Date(u.period.end.getTime() - 1);
  const meters = selected ? [selected] : [...METERS];
  const empty = u.current.every((c) => c.records === 0) && u.history.length === 0;
  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={t('title')}
        description={t('subtitle')}
        meta={
          <span data-testid="usage-period">
            {t('period', { start: day.format(u.period.start), end: day.format(lastDay), zone: u.timeZone })}
          </span>
        }
      />
      <Tabs label={t('filterLabel')}>
        <Link
          href={`/o/${org}/plan/usage`}
          className={tabClass(!selected)}
          aria-current={!selected ? 'page' : undefined}
        >
          {t('allMeters')}
        </Link>
        {METERS.map((m) => (
          <Link
            key={m}
            href={`/o/${org}/plan/usage?meter=${m}`}
            className={tabClass(selected === m)}
            aria-current={selected === m ? 'page' : undefined}
          >
            {t(`meter.${m}`)}
          </Link>
        ))}
      </Tabs>
      {u.reporting ? (
        <Alert tone="info" title={t('reportingTitle')}>
          {t('reportingBody', { count: u.pendingReport })}
        </Alert>
      ) : (
        <Alert tone="info" title={t('countingTitle')}>
          {t('countingBody')}
        </Alert>
      )}
      <section aria-labelledby="current-heading" className="flex flex-col gap-3">
        <SectionHeader id="current-heading" title={t('currentTitle')} description={t('currentDescription')} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="usage-current">
          {u.current.map((c) => (
            <StatCard
              key={c.meter}
              testId={`usage-${c.meter}`}
              label={t(`meter.${c.meter}`)}
              value={n.format(c.quantity)}
              sub={t(`unit.${c.meter}`, { count: c.quantity })}
            />
          ))}
        </div>
      </section>
      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <SectionHeader id="history-heading" title={t('historyTitle')} description={t('historyDescription')} />
        {empty ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
        ) : (
          <Table
            caption={t('historyTitle')}
            rowKey={(r) => r.month}
            rows={u.history}
            empty={t('historyEmpty')}
            columns={[
              { key: 'month', header: t('month'), cell: (r) => monthName(r.month) },
              ...meters.map((m) => ({
                key: m,
                header: t(`meter.${m}`),
                cell: (r: (typeof u.history)[number]) =>
                  n.format(r.totals.find((x) => x.meter === m)?.quantity ?? 0),
              })),
            ]}
          />
        )}
      </section>
    </>
  );
}
