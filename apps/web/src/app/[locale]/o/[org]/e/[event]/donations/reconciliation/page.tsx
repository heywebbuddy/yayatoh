import {
  catchUpGiftRefunds,
  catchUpGifts,
  donationReconciliationQuery,
  type ReconItemDto,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import {
  Alert,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  SectionHeader,
  StatCard,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import { Landmark, Scale } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { reconcileDonationsAction, resolveReconItemAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.recon');
  return { title: t('title') };
}

/**
 * Donations reconciliation of an event (M4.8g, like M1.6e for the platform): the event's gifts as
 * the ledger's memo entries remember them against the charity's connected account (its balance
 * transactions), each difference with what each side counted, and the payouts that carried the
 * gifts to the bank. Finance roles read it (`finance:read`); `finance:reconcile` runs it and
 * resolves differences with a note.
 */
export default async function DonationsReconciliationPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('donations.recon');
  const tn = await getTranslations('nav');
  const tb = await getTranslations('billingPlan');
  const te = await getTranslations('emptyActions');
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
        <EmptyState
          title={t('noAccessTitle')}
          description={t('noAccessDescription')}
          action={
            <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
              {tb('findOwner')}
            </Link>
          }
        />
      </>
    );
  await catchUpGifts(data.org.id);
  await catchUpGiftRefunds(data.org.id);
  const v = await executeQuery(donationReconciliationQuery, { eventId: ev.id }, data.ctx, ports);
  const canRun = can('finance:reconcile');
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const n = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const errors = {
    note: t('errors.note'),
    provider_unavailable: t('errors.provider'),
  };
  const run =
    canRun && v.connected ? (
      <ProgramForm
        action={reconcileDonationsAction.bind(null, org, event)}
        fields={[]}
        idPrefix="reconcile"
        submitLabel={t('run')}
        successLabel={t('ran')}
        errors={errors}
      />
    ) : null;
  const header = (
    <PageHeader
      breadcrumb={crumbs}
      title={t('title')}
      description={t('subtitle')}
      actions={
        <Link href={`${base}/report`} className={buttonClass('secondary', 'md')}>
          {t('reportLink')}
        </Link>
      }
    />
  );
  if (!v.connected)
    return (
      <>
        {header}
        <EmptyState
          icon={<Landmark strokeWidth={2} />}
          title={t('notConnectedTitle')}
          description={t('notConnectedDescription')}
          action={
            <Link href={`/o/${org}/payouts`} className={buttonClass('primary', 'md')}>
              {te('connectPayouts')}
            </Link>
          }
        />
      </>
    );
  const open = v.items.filter((i) => i.status === 'open');
  const statusOf = (i: ReconItemDto) =>
    i.status === 'open'
      ? { tone: 'danger' as const, label: t('status.open') }
      : i.status === 'resolved'
        ? { tone: 'success' as const, label: t('status.resolved') }
        : { tone: 'neutral' as const, label: t('status.cleared') };
  return (
    <>
      {header}
      {canRun ? null : <Alert tone="info" title={t('viewerNotice')} />}

      <section aria-labelledby="recon-run" className="flex flex-col gap-4">
        <SectionHeader id="recon-run" title={t('runTitle')} />
        <Card size="panel" className="flex flex-col gap-3">
          {v.lastRun ? (
            <p className="m-0 text-body text-ink" data-testid="last-run">
              {t('lastRun', {
                at: when.format(v.lastRun.ranAt),
                ledger: n.format(v.lastRun.ledgerCount),
                provider: n.format(v.lastRun.providerCount),
              })}
            </p>
          ) : (
            <p className="m-0 text-body text-ink-2">{t('neverRun')}</p>
          )}
          {run}
        </Card>
        {v.lastRun ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {v.lastRun.totals.flatMap((x) => [
              <StatCard
                key={`l-${x.currency}`}
                testId="recon-ledger"
                label={t('stats.ledger')}
                value={fmt(x.ledgerMinor, x.currency)}
              />,
              <StatCard
                key={`p-${x.currency}`}
                testId="recon-provider"
                label={t('stats.provider')}
                value={fmt(x.providerMinor, x.currency)}
              />,
              <StatCard
                key={`f-${x.currency}`}
                testId="recon-fees"
                label={t('stats.fees')}
                value={fmt(x.feeMinor, x.currency)}
              />,
              <StatCard
                key={`u-${x.currency}`}
                testId="recon-unpaid"
                label={t('stats.unpaidOut')}
                value={fmt(x.unpaidOutMinor, x.currency)}
                sub={t('stats.unpaidOutSub', { count: x.unpaidOutCount })}
              />,
            ])}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="recon-diffs" className="flex flex-col gap-4">
        <SectionHeader id="recon-diffs" title={t('diffsTitle')} count={n.format(open.length)} />
        {!v.lastRun ? null : v.items.length === 0 ? (
          <EmptyState
            icon={<Scale strokeWidth={2} />}
            title={t('cleanTitle')}
            description={t('cleanDescription')}
            action={
              <Link href="#recon-run" className={buttonClass('secondary', 'md')}>
                {te('runAgain')}
              </Link>
            }
          />
        ) : (
          <>
            {open.length === 0 ? <Alert tone="success" title={t('allSettled')} /> : null}
            <ol className="m-0 flex list-none flex-col gap-4 p-0" data-testid="recon-items">
              {v.items.map((i) => {
                const s = statusOf(i);
                return (
                  <li key={i.id}>
                    <Card size="panel" className="flex flex-col gap-3">
                      <CardHeader
                        as="h3"
                        title={t(`kinds.${i.kind}`)}
                        actions={<StatusPill tone={s.tone} label={s.label} />}
                      />
                      <p className="m-0 font-mono text-caption text-ink-2">{i.reference}</p>
                      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body sm:max-w-sm">
                        <dt className="text-ink-2">{t('ledger')}</dt>
                        <dd className="m-0 text-end tabular-nums">{fmt(i.ledgerMinor, i.currency)}</dd>
                        <dt className="text-ink-2">{t('provider')}</dt>
                        <dd className="m-0 text-end tabular-nums">{fmt(i.providerMinor, i.currency)}</dd>
                        <dt className="text-ink-2">{t('difference')}</dt>
                        <dd className="m-0 text-end font-bold tabular-nums">
                          {fmt(i.differenceMinor, i.currency)}
                        </dd>
                      </dl>
                      {i.status === 'resolved' && i.resolutionNote ? (
                        <p className="m-0 text-body text-ink">
                          {t('resolvedNote', { note: i.resolutionNote })}
                        </p>
                      ) : null}
                      {canRun && i.status === 'open' ? (
                        <div className="border-t border-line pt-3">
                          <ProgramForm
                            action={resolveReconItemAction.bind(null, org, event, i.id)}
                            fields={[
                              {
                                kind: 'textarea',
                                name: 'note',
                                label: t('noteLabel'),
                                hint: t('noteHint'),
                                rows: 2,
                              },
                            ]}
                            idPrefix={`resolve-${i.id}`}
                            submitLabel={t('resolve', { reference: i.reference })}
                            successLabel={t('resolved')}
                            errors={errors}
                          />
                        </div>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      <section aria-labelledby="recon-payouts" className="flex flex-col gap-3">
        <SectionHeader id="recon-payouts" title={t('payoutsTitle')} description={t('payoutsBody')} />
        <Table
          caption={t('payoutsTitle')}
          stackOnPhone
          rows={v.payouts}
          rowKey={(p) => p.payoutId}
          empty={t('payoutsEmpty')}
          columns={[
            { key: 'id', header: t('payout.id'), cell: (p) => p.payoutId, mono: true },
            { key: 'status', header: t('payout.status'), cell: (p) => t(`payoutStatus.${p.status}`) },
            {
              key: 'arrival',
              header: t('payout.arrival'),
              cell: (p) => day.format(new Date(`${p.arrivalDate}T00:00:00Z`)),
            },
            {
              key: 'amount',
              header: t('payout.amount'),
              cell: (p) => fmt(p.amountMinor, p.currency),
              align: 'end',
            },
            {
              key: 'donations',
              header: t('payout.donations'),
              cell: (p) =>
                t('payout.donationsCell', {
                  count: p.donationCount,
                  net: fmt(p.donationNetMinor, p.currency),
                  fees: fmt(p.donationFeeMinor, p.currency),
                }),
              align: 'end',
            },
          ]}
        />
      </section>
    </>
  );
}
