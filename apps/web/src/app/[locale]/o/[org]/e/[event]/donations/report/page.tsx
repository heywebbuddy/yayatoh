import {
  CRM_LAYOUTS,
  catchUpGiftRefunds,
  catchUpGifts,
  type DonationReportDto,
  donationReportQuery,
  donorCsvExportBulk,
  donorXlsxExportBulk,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import type { BulkOperationDto } from '@yayatoh/platform';
import {
  Alert,
  Badge,
  Button,
  buttonClass,
  Card,
  CardHeader,
  cardClass,
  cx,
  EmptyState,
  PageHeader,
  SectionHeader,
  Select,
  StatCard,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import { ChartNoAxesColumn } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { exportDonorsAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.report');
  return { title: t('title') };
}

type Totals = DonationReportDto['totals'][number];

/**
 * The donations report of an event (M4.8g): what was raised and how (card, offline, ticket
 * donations, sponsors' matches), pledged vs collected vs written off, the ledger check (memo
 * entries against the provider as last reconciled), totals per source, level, match and donor, and
 * the donor CRM export. Finance roles and co-hosts (`finance:read`): it names donors.
 */
export default async function DonationsReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ op?: string; format?: string; exportError?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('donations.report');
  const tf = await getTranslations('donations.report.file');
  const tn = await getTranslations('nav');
  const tb = await getTranslations('bulk');
  const te = await getTranslations();
  const base = `/o/${org}/e/${event}/donations`;
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tn('donations'), href: base },
        { label: t('title') },
      ]}
    />
  );
  if (!can('finance:read'))
    return (
      <>
        <PageHeader breadcrumb={crumbs} title={t('title')} />
        <EmptyState title={t('noAccessTitle')} description={t('noAccessDescription')} />
      </>
    );
  // Gift outcomes and refunds from the outbox (the worker relays them; dev and e2e have none).
  await catchUpGifts(data.org.id);
  await catchUpGiftRefunds(data.org.id);
  const r = await executeQuery(donationReportQuery, { eventId: ev.id }, data.ctx, ports);
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const n = new Intl.NumberFormat(locale);
  const xlsx = sp.format === 'xlsx';
  let op: BulkOperationDto | null = null;
  if (sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    const bulk = xlsx ? donorXlsxExportBulk : donorCsvExportBulk;
    op = await executeQuery(bulk.status, { operationId: sp.op }, data.ctx, ports).catch((err) => {
      if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) return null;
      throw err;
    });
    if (op && op.eventId !== ev.id) op = null;
  }
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;
  const reconcileLink = (
    <Link href={`${base}/reconciliation`} className={buttonClass('secondary', 'md')}>
      {t('reconcileLink')}
    </Link>
  );
  const header = (
    <PageHeader breadcrumb={crumbs} title={t('title')} description={t('subtitle')} actions={reconcileLink} />
  );
  if (r.totals.length === 0)
    return (
      <>
        {header}
        <EmptyState
          icon={<ChartNoAxesColumn strokeWidth={2} />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            <Link href={base} className={buttonClass('primary', 'md')}>
              {t('backToDonations')}
            </Link>
          }
        />
      </>
    );

  const check = (x: Totals) => {
    if (x.providerMinor === null) return { tone: 'waiting' as const, label: t('check.notReconciled') };
    if (x.providerMinor === x.ledgerMinor) return { tone: 'success' as const, label: t('check.matches') };
    return {
      tone: 'danger' as const,
      label: t('check.differs', { amount: fmt(x.providerMinor - x.ledgerMinor, x.currency) }),
    };
  };

  return (
    <>
      {header}
      <p className="m-0 text-caption text-ink-2">{t('asOf', { zone: r.timeZone })}</p>

      {r.totals.map((x) => {
        const c = check(x);
        return (
          <section
            key={x.currency}
            aria-labelledby={`totals-${x.currency}`}
            className="flex flex-col gap-4"
            data-testid={`totals-${x.currency}`}
          >
            <SectionHeader
              id={`totals-${x.currency}`}
              title={r.totals.length > 1 ? t('totalsIn', { currency: x.currency }) : t('totalsTitle')}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                testId="stat-raised"
                label={t('stats.raised')}
                value={fmt(x.raisedMinor, x.currency)}
                sub={t('stats.raisedSub', { count: x.lineCount, donors: x.donorCount })}
              />
              <StatCard
                testId="stat-online"
                label={t('stats.online')}
                value={fmt(x.onlineNetMinor, x.currency)}
                sub={t('stats.onlineSub', {
                  cover: fmt(x.feeCoverMinor, x.currency),
                  refunded: fmt(x.refundedMinor, x.currency),
                })}
              />
              <StatCard
                testId="stat-offline"
                label={t('stats.offline')}
                value={fmt(x.offlineMinor, x.currency)}
                sub={t('stats.ticketSub', { amount: fmt(x.ticketMinor, x.currency) })}
              />
              <StatCard
                testId="stat-pledged"
                label={t('stats.pledged')}
                value={fmt(x.pledgedMinor, x.currency)}
                progress={
                  x.pledgedMinor > 0
                    ? {
                        value: x.pledgeCollectedMinor,
                        max: x.pledgedMinor,
                        label: t('stats.collectedLabel'),
                        tone: 'success',
                      }
                    : undefined
                }
                sub={t('stats.pledgedSub', {
                  collected: fmt(x.pledgeCollectedMinor, x.currency),
                  writtenOff: fmt(x.writtenOffMinor, x.currency),
                  open: fmt(x.pledgeOpenMinor, x.currency),
                })}
              />
              <StatCard
                testId="stat-matched"
                label={t('stats.matched')}
                value={fmt(x.matchedMinor, x.currency)}
                sub={t('stats.matchedSub')}
              />
              <Card className="flex flex-col gap-2.5" data-testid="ledger-check">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-body font-semibold text-ink-2">{t('check.title')}</h3>
                  <StatusPill tone={c.tone} label={c.label} />
                </div>
                <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
                  <dt className="text-ink-2">{t('check.ledger')}</dt>
                  <dd className="m-0 text-end font-bold text-ink tabular-nums">
                    {fmt(x.ledgerMinor, x.currency)}
                  </dd>
                  <dt className="text-ink-2">{t('check.provider')}</dt>
                  <dd className="m-0 text-end font-bold text-ink tabular-nums">
                    {x.providerMinor === null ? t('check.none') : fmt(x.providerMinor, x.currency)}
                  </dd>
                  {x.providerFeeMinor !== null ? (
                    <>
                      <dt className="text-ink-2">{t('check.fees')}</dt>
                      <dd className="m-0 text-end text-ink tabular-nums">
                        {fmt(x.providerFeeMinor, x.currency)}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </Card>
            </div>
          </section>
        );
      })}

      <section aria-labelledby="by-source" className="flex flex-col gap-3">
        <SectionHeader id="by-source" title={t('bySource.title')} />
        <Table
          caption={t('bySource.title')}
          stackOnPhone
          rows={r.bySource}
          rowKey={(row) => `${row.source}-${row.currency}`}
          columns={[
            { key: 'source', header: t('bySource.source'), cell: (row) => t(`sources.${row.source}`) },
            { key: 'count', header: t('bySource.count'), cell: (row) => n.format(row.count), align: 'end' },
            {
              key: 'net',
              header: t('bySource.net'),
              cell: (row) => fmt(row.netMinor, row.currency),
              align: 'end',
            },
          ]}
        />
      </section>

      <section aria-labelledby="by-level" className="flex flex-col gap-3">
        <SectionHeader id="by-level" title={t('byLevel.title')} />
        <Table
          caption={t('byLevel.title')}
          stackOnPhone
          rows={r.byLevel}
          rowKey={(row) => `${row.levelId ?? 'own'}-${row.currency}`}
          empty={t('byLevel.empty')}
          columns={[
            { key: 'level', header: t('byLevel.level'), cell: (row) => row.name ?? t('byLevel.own') },
            {
              key: 'gifts',
              header: t('byLevel.gifts'),
              cell: (row) =>
                t('byLevel.giftsCell', { count: row.giftCount, amount: fmt(row.giftNetMinor, row.currency) }),
              align: 'end',
            },
            {
              key: 'pledges',
              header: t('byLevel.pledges'),
              cell: (row) =>
                t('byLevel.pledgesCell', {
                  count: row.pledgeCount,
                  amount: fmt(row.pledgedMinor, row.currency),
                }),
              align: 'end',
            },
          ]}
        />
      </section>

      {r.byMatch.length > 0 ? (
        <section aria-labelledby="by-match" className="flex flex-col gap-3">
          <SectionHeader id="by-match" title={t('byMatch.title')} />
          <Table
            caption={t('byMatch.title')}
            stackOnPhone
            rows={r.byMatch}
            rowKey={(row) => row.id}
            columns={[
              { key: 'sponsor', header: t('byMatch.sponsor'), cell: (row) => row.sponsorName },
              { key: 'campaign', header: t('byMatch.campaign'), cell: (row) => row.campaignName },
              { key: 'status', header: t('byMatch.status'), cell: (row) => t(`matchStatus.${row.status}`) },
              {
                key: 'matched',
                header: t('byMatch.matched'),
                cell: (row) =>
                  t('byMatch.matchedCell', {
                    matched: fmt(row.matchedMinor, row.currency),
                    cap: fmt(row.capMinor, row.currency),
                  }),
                align: 'end',
              },
            ]}
          />
        </section>
      ) : null}

      <section aria-labelledby="by-donor" className="flex flex-col gap-3">
        <SectionHeader id="by-donor" title={t('byDonor.title')} description={t('byDonor.note')} />
        <Table
          caption={t('byDonor.title')}
          stackOnPhone
          rows={r.byDonor}
          rowKey={(row) => `${row.key}-${row.currency}`}
          empty={t('byDonor.empty')}
          columns={[
            {
              key: 'donor',
              header: t('byDonor.donor'),
              cell: (row) => (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span>{row.name}</span>
                  {row.anonymous ? <Badge tone="neutral">{t('byDonor.anonymous')}</Badge> : null}
                </span>
              ),
            },
            { key: 'email', header: t('byDonor.email'), cell: (row) => row.email ?? '—' },
            { key: 'count', header: t('byDonor.count'), cell: (row) => n.format(row.count), align: 'end' },
            {
              key: 'net',
              header: t('byDonor.net'),
              cell: (row) => fmt(row.netMinor, row.currency),
              align: 'end',
            },
          ]}
        />
        {r.donorsTruncated ? <p className="m-0 text-caption text-ink-2">{t('byDonor.truncated')}</p> : null}
      </section>

      <section aria-labelledby="export-heading" className="flex flex-col gap-4">
        <SectionHeader id="export-heading" title={t('export.title')} description={t('export.body')} />
        {sp.exportError ? (
          <Alert title={t('export.error', { reason: te(errorMessageKey(sp.exportError)) })} />
        ) : null}
        <Card size="panel" className="flex flex-col gap-4">
          <StepUpForm action={exportDonorsAction.bind(null, org, event)} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                id="export-layout"
                name="layout"
                label={t('export.layout')}
                hint={t('export.layoutHint')}
                defaultValue="generic"
              >
                {CRM_LAYOUTS.map((l) => (
                  <option key={l} value={l}>
                    {t(`layouts.${l}`)}
                  </option>
                ))}
              </Select>
              <Select id="export-format" name="format" label={t('export.format')} defaultValue="csv">
                <option value="csv">{t('export.csv')}</option>
                <option value="xlsx">{t('export.xlsx')}</option>
              </Select>
            </div>
            <Button type="submit" variant="primary" className="self-start">
              {t('export.submit')}
            </Button>
          </StepUpForm>
        </Card>
        {op ? (
          <section aria-labelledby="donor-export-heading" className={cx(cardClass(), 'flex flex-col gap-3')}>
            {opActive ? <AutoRefresh seconds={2} /> : null}
            <h3 id="donor-export-heading" className="m-0 text-card text-ink">
              {xlsx ? t('export.statusXlsx') : t('export.statusCsv')}
            </h3>
            <p className="m-0 text-body text-ink" role="status">
              {op.status === 'done'
                ? tb('exportDone', { succeeded: n.format(op.succeeded) })
                : tb(`status.${op.status}`, {
                    processed: n.format(op.processed),
                    total: n.format(op.total),
                    succeeded: n.format(op.succeeded),
                    failed: n.format(op.failed),
                    undone: n.format(op.undone),
                  })}
            </p>
            {op.status === 'done' && op.hasFile ? (
              <a
                href={`${locale === 'en' ? '' : `/${locale}`}${base}/report/exports/${op.id}${xlsx ? '?format=xlsx' : ''}`}
                className={buttonClass('primary', 'sm', 'self-start')}
                download
              >
                {tb('download')}
              </a>
            ) : null}
          </section>
        ) : null}
        <CardHeader as="h3" title={tf('privacyTitle')} />
        <p className="m-0 -mt-2 text-caption text-ink-2">{tf('privacy')}</p>
      </section>
    </>
  );
}
