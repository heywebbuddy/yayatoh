import { executeQuery } from '@yayatoh/kernel';
import { apiUsageQuery, roleCan } from '@yayatoh/tenancy';
import { BarChart, Card, ChartTable, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatDate } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const RANGES = [7, 30, 90] as const;

/**
 * API usage (M6.3a): requests, errors and rate-limited requests per day (the org's timezone) and
 * per key, for the last 7, 30 or 90 days. Owners and admins, like the keys themselves.
 */
export default async function ApiUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const back = (
    <Link href={`/o/${org}/api-keys`} className="underline underline-offset-2">
      {t('apiUsage.back')}
    </Link>
  );
  if (!roleCan(data.role, 'api_keys:manage')) {
    return (
      <>
        <PageHeader title={t('apiUsage.title')} description={t('apiUsage.subtitle')} />
        <EmptyState
          title={t('apiKeys.noAccessTitle')}
          description={t('apiKeys.noAccessDescription')}
          action={back}
        />
      </>
    );
  }
  const asked = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(asked) ? asked : 30;
  const u = await executeQuery(apiUsageQuery, { days }, data.ctx, ports);
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const f = { locale, currency: data.org.currency, timeZone: 'UTC' };
  // Days are calendar days of the org's timezone already: format them as dates, not instants.
  const dayLabel = (d: string, long = false) =>
    formatDate(
      `${d}T12:00:00Z`,
      f,
      long ? { year: 'numeric', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' },
    );
  const lastUsed = (d: Date | null) =>
    d
      ? formatDate(d.toISOString(), { ...f, timeZone: data.org.timezone }, { month: 'short', day: 'numeric' })
      : t('apiKeys.never');
  return (
    <>
      <PageHeader title={t('apiUsage.title')} description={t('apiUsage.subtitle')} />
      <nav aria-label={t('apiUsage.range')} className="flex flex-wrap items-center gap-2 text-body">
        {back}
        <span aria-hidden="true" className="text-ink-3">
          ·
        </span>
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/o/${org}/api-keys/usage?days=${r}`}
            aria-current={r === days ? 'page' : undefined}
            className="inline-flex min-h-10 items-center rounded-pill border border-line px-4 aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium"
          >
            {t('apiUsage.lastDays', { days: r })}
          </Link>
        ))}
      </nav>
      <section aria-labelledby="usage-totals" className="grid gap-3 sm:grid-cols-3">
        <h2 id="usage-totals" className="sr-only">
          {t('apiUsage.totalsTitle')}
        </h2>
        {(
          [
            ['requests', u.totals.requests],
            ['errors', u.totals.errors],
            ['rateLimited', u.totals.rateLimited],
          ] as const
        ).map(([k, v]) => (
          <Card key={k} className="flex flex-col gap-1">
            <p className="text-caption text-ink-2">{t(`apiUsage.${k}`)}</p>
            <p className="text-section font-medium" data-testid={`usage-total-${k}`}>
              {num(v)}
            </p>
          </Card>
        ))}
      </section>
      {u.totals.requests === 0 ? (
        <EmptyState
          title={t('apiUsage.emptyTitle')}
          description={t('apiUsage.emptyDescription')}
          action={back}
        />
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="text-section">{t('apiUsage.perDayTitle')}</h2>
            <BarChart
              title={t('apiUsage.perDayTitle')}
              bars={u.days.map((d) => ({ label: dayLabel(d.day), value: d.requests }))}
              height={180}
              formatValue={num}
            />
            <ChartTable
              toggle={t('apiUsage.showData')}
              caption={t('apiUsage.perDayTitle')}
              headers={[
                t('apiUsage.day'),
                t('apiUsage.requests'),
                t('apiUsage.errors'),
                t('apiUsage.rateLimited'),
              ]}
              rows={u.days.map((d) => [
                dayLabel(d.day, true),
                num(d.requests),
                num(d.errors),
                num(d.rateLimited),
              ])}
            />
          </Card>
          <Table
            caption={t('apiUsage.perKeyTitle')}
            captionHidden={false}
            rowKey={(k) => k.apiKeyId}
            rows={u.keys}
            empty={t('apiUsage.emptyTitle')}
            columns={[
              { key: 'name', header: t('apiKeys.name'), cell: (k) => k.name },
              { key: 'prefix', header: t('apiKeys.key'), cell: (k) => `${k.prefix}…`, mono: true },
              {
                key: 'requests',
                header: t('apiUsage.requests'),
                cell: (k) => num(k.requests),
                align: 'end',
                mono: true,
              },
              {
                key: 'errors',
                header: t('apiUsage.errors'),
                cell: (k) => num(k.errors),
                align: 'end',
                mono: true,
              },
              {
                key: 'limited',
                header: t('apiUsage.rateLimited'),
                cell: (k) => num(k.rateLimited),
                align: 'end',
                mono: true,
              },
              { key: 'used', header: t('apiKeys.lastUsed'), cell: (k) => lastUsed(k.lastUsedAt), mono: true },
            ]}
          />
        </>
      )}
    </>
  );
}
