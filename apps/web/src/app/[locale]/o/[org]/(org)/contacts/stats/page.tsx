import { orgContactStatsQuery, orgValueQuery } from '@yayatoh/crm';
import { ENGAGEMENT_BANDS, FREQUENCY_BANDS, NO_SHOW_BANDS } from '@yayatoh/crm/client';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { BarChart, Card, CardLabel, ChartTable, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatBps } from '@/components/contact-stats.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contactStats');
  return { title: t('insightsTitle') };
}

/**
 * Contact insights (M6.1b org stats): totals and distributions of the org's contact stats, and
 * lifetime value per currency for members who can read finance. Every chart has its table.
 */
export default async function ContactInsightsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'contacts:read')) notFound();
  const t = await getTranslations('contactStats');
  const o = await executeQuery(orgContactStatsQuery, {}, data.ctx, ports);
  const value = roleCan(data.role, 'finance:read')
    ? await executeQuery(orgValueQuery, {}, data.ctx, ports)
    : null;
  const nf = new Intl.NumberFormat(locale);
  const range = (bands: readonly number[], i: number, suffix = '') => {
    const from = bands[i] as number;
    const next = bands[i + 1];
    return next === undefined
      ? t('bandFrom', { from: `${nf.format(from)}${suffix}` })
      : t('bandRange', {
          from: `${nf.format(from)}${suffix}`,
          to: `${nf.format(next - (suffix ? 0 : 1))}${suffix}`,
        });
  };
  const distributions = [
    {
      key: 'engagement',
      bars: o.engagement.map((b, i) => ({ label: range(ENGAGEMENT_BANDS, i), value: b.count })),
    },
    {
      key: 'noShow',
      bars: o.noShow.map((b, i) => ({ label: range(NO_SHOW_BANDS, i, '%'), value: b.count })),
    },
    {
      key: 'frequency',
      bars: o.frequency.map((b, i) => ({ label: range(FREQUENCY_BANDS, i), value: b.count })),
    },
    {
      key: 'recency',
      bars: o.recency.map((b) => ({
        label: b.from < 0 ? t('recencyOlder') : t('recencyWithin', { days: b.from }),
        value: b.count,
      })),
    },
  ] as const;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/audiences`} className="underline underline-offset-2">
            {t('audiencesLink')}
          </Link>
        }
        title={t('insightsTitle')}
        description={t('insightsDescription')}
      />
      {o.withActivity === 0 ? (
        <EmptyState
          title={t('orgEmptyTitle')}
          description={t('orgEmptyDescription')}
          action={
            <Link href={`/o/${org}/events`} className="underline underline-offset-2">
              {t('orgEmptyAction')}
            </Link>
          }
        />
      ) : (
        <>
          <section aria-labelledby="totals-heading" className="flex flex-col gap-3">
            <h2 id="totals-heading" className="text-section">
              {t('totals')}
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(
                [
                  ['contacts', nf.format(o.contacts)],
                  ['participants', nf.format(o.participants)],
                  ['attendedAny', nf.format(o.attendedAny)],
                  ['averageEngagement', nf.format(o.averageEngagement)],
                  ['noShowRate', o.noShowRateBps === null ? t('never') : formatBps(o.noShowRateBps, locale)],
                ] as const
              ).map(([k, v]) => (
                <Card key={k}>
                  <div className="flex flex-col gap-1">
                    <CardLabel>{t(`total.${k}`)}</CardLabel>
                    <p className="text-[28px] font-light tracking-[-0.03em]" data-testid={`org-${k}`}>
                      {v}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          </section>
          <section aria-labelledby="distributions-heading" className="flex flex-col gap-3">
            <h2 id="distributions-heading" className="text-section">
              {t('distributions')}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {distributions.map((d) => (
                <Card key={d.key}>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-body font-medium">{t(`distribution.${d.key}`)}</h3>
                    <BarChart title={t(`distribution.${d.key}`)} bars={d.bars} height={160} />
                    <ChartTable
                      toggle={t('showData')}
                      caption={t(`distribution.${d.key}`)}
                      headers={[t('range'), t('people')]}
                      rows={d.bars.map((b) => [b.label, nf.format(b.value)])}
                    />
                  </div>
                </Card>
              ))}
            </div>
          </section>
          {value ? (
            <section aria-labelledby="org-value-heading" className="flex flex-col gap-3">
              <h2 id="org-value-heading" className="text-section">
                {t('lifetimeValue')}
              </h2>
              {value.currencies.length === 0 ? (
                <p className="text-body text-ink-2">{t('noSpendOrg')}</p>
              ) : (
                <Table
                  caption={t('lifetimeValue')}
                  rowKey={(r) => r.currency}
                  rows={value.currencies}
                  columns={[
                    { key: 'currency', header: t('value.currency'), cell: (r) => r.currency },
                    {
                      key: 'payers',
                      header: t('value.payers'),
                      align: 'end',
                      cell: (r) => <span className="font-mono">{nf.format(r.payers)}</span>,
                    },
                    {
                      key: 'total',
                      header: t('value.total'),
                      align: 'end',
                      cell: (r) => (
                        <span className="font-mono">
                          {formatMoney(money(r.totalMinor, r.currency), locale)}
                        </span>
                      ),
                    },
                    {
                      key: 'average',
                      header: t('value.average'),
                      align: 'end',
                      cell: (r) => (
                        <span className="font-mono">
                          {formatMoney(money(r.averageMinor, r.currency), locale)}
                        </span>
                      ),
                    },
                    {
                      key: 'top',
                      header: t('value.topFifth'),
                      align: 'end',
                      cell: (r) => (
                        <span className="font-mono">
                          {formatMoney(money(r.topFifthFromMinor, r.currency), locale)}
                        </span>
                      ),
                    },
                    {
                      key: 'max',
                      header: t('value.max'),
                      align: 'end',
                      cell: (r) => (
                        <span className="font-mono">
                          {formatMoney(money(r.maxMinor, r.currency), locale)}
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
