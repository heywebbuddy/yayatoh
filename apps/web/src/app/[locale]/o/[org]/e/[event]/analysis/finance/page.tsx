import { executeQuery } from '@yayatoh/kernel';
import { eventFinanceQuery } from '@yayatoh/reports';
import { buttonClass, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FinanceWaterfall } from '@/components/finance-waterfall.tsx';
import { AsOf, ReportTabs } from '@/components/reports.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** From gross to net for one event: finance roles only (owner, admin, finance). */
export default async function FinancePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'analysis');
  const t = await getTranslations();
  const base = `/o/${org}/e/${event}/analysis`;
  const finance = can('finance:read');
  if (!data.modules.has('reports') || !finance) {
    return (
      <>
        <PageHeader title={t('reports.tabs.finance')} description={ev.name} />
        {can('orders:read') ? <ReportTabs base={base} current="finance" finance={false} /> : null}
        <EmptyState
          title={t('reports.financeNoAccessTitle')}
          description={t('reports.financeNoAccessDescription')}
          action={
            can('orders:read') ? (
              <Link href={base} className={buttonClass('primary', 'md')}>
                {t('reports.toSalesReport')}
              </Link>
            ) : (
              <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
                {t('reports.backToEvent')}
              </Link>
            )
          }
        />
      </>
    );
  }
  const r = await executeQuery(eventFinanceQuery, { eventId: ev.id }, data.ctx, ports);
  return (
    <>
      <PageHeader
        title={t('reports.tabs.finance')}
        description={ev.name}
        actions={<AsOf asOf={r.asOf} locale={locale} />}
      />
      <ReportTabs base={base} current="finance" finance />
      <FinanceWaterfall report={r} locale={locale} />
    </>
  );
}
