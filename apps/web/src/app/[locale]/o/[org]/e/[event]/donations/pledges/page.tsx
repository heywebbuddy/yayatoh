import { randomUUID } from 'node:crypto';
import {
  catchUpGifts,
  type PledgeRowDto,
  pledgeCollectionQuery,
  pledgeOutcomesSubscriber,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, money, utcToZonedInput } from '@yayatoh/kernel';
import { catchUpSubscriber } from '@yayatoh/platform';
import { Alert, buttonClass, Card, EmptyState, PageHeader, StatCard, StatusPill, Table } from '@yayatoh/ui';
import { HandCoins } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { RaiseActionButton, RaiseAnnouncer } from '../paddle-raise/action-button.tsx';
import { closePledgesAction, recordPledgePaymentAction, writeOffPledgeAction } from './actions.ts';
import { CardSavingQr } from './card-qr.tsx';
import { SettleForms } from './settle-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pledges');
  return { title: t('title') };
}

const TONE = {
  open: 'neutral',
  scheduled: 'info',
  charging: 'info',
  invoiced: 'waiting',
  paid: 'success',
  paid_offline: 'success',
  written_off: 'danger',
} as const;

/**
 * Pledge collection (M4.8e, P4-12): every confirmed pledge of the event with how it is being
 * collected. One primary action: close the night (summaries to donors; saved cards are charged at
 * 09:00 the next morning, the others get a pay link due in 30 days). Finance roles record offline
 * payments and write pledges off with a note; `orders:read` watches.
 */
export default async function PledgesPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  if (!can('orders:read')) notFound();
  // Dev and e2e have no worker: apply the payments that just landed.
  await catchUpGifts(data.org.id);
  await catchUpSubscriber(pledgeOutcomesSubscriber, data.org.id);
  const view = await executeQuery(pledgeCollectionQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('pledges');
  const tn = await getTranslations('nav');
  const canSettle = can('orders:refund');
  const fmt = (minor: number, currency = view.currency) => formatMoney(money(minor, currency), locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: view.timeZone,
  });
  const day = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    );
  const today = utcToZonedInput(new Date(), view.timeZone).slice(0, 10);
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
  const detail = (r: PledgeRowDto) => {
    const card = r.card
      ? t('cardLabel', { brand: r.card.brand ?? t('card'), last4: r.card.last4 ?? '' })
      : null;
    switch (r.status) {
      case 'open':
        return t('detail.open');
      case 'scheduled':
        return t('detail.scheduled', { card: card ?? '', when: r.chargeAt ? when.format(r.chargeAt) : '' });
      case 'charging':
        return t('detail.charging', { card: card ?? '' });
      case 'invoiced':
        return [
          t('detail.invoiced', { date: r.dueOn ? day(r.dueOn) : '' }),
          r.declineCode ? t('detail.declined', { count: r.cardAttempts }) : null,
          r.emailed ? null : t('detail.noEmail'),
        ]
          .filter(Boolean)
          .join(' ');
      case 'paid':
        return card ? t('detail.paidCard', { card }) : t('detail.paidLink');
      case 'paid_offline':
        return [t(`methods.${r.offlineMethod ?? 'other'}`), r.note].filter(Boolean).join(' · ');
      case 'written_off':
        return r.note ?? '';
    }
  };
  return (
    <>
      <PageHeader breadcrumb={crumbs} title={t('title')} description={t('subtitle')} />
      <RaiseAnnouncer>
        {canSettle ? null : <Alert tone="info" title={t('viewerNotice')} />}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5" data-testid="pledge-totals">
          <StatCard label={t('pledged')} value={fmt(view.totals.pledgedMinor)} />
          <StatCard label={t('paid')} value={fmt(view.totals.paidMinor)} />
          <StatCard label={t('owed')} value={fmt(view.totals.openMinor)} />
          <StatCard label={t('writtenOffTotal')} value={fmt(view.totals.writtenOffMinor)} />
          <StatCard label={t('cardsSaved')} value={new Intl.NumberFormat(locale).format(view.savedCards)} />
        </div>
        <CardSavingQr orgId={data.org.id} eventId={ev.id} slug={ev.slug} source="table" />
        {view.rows.length === 0 ? (
          <EmptyState
            icon={<HandCoins strokeWidth={2} />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Link href={`${base}/paddle-raise`} className={buttonClass('primary', 'md')}>
                {tn('donations')}
              </Link>
            }
          />
        ) : (
          <>
            {view.unclosed > 0 ? (
              <Card size="panel" className="flex flex-col gap-3">
                <h2 className="m-0 text-card text-ink">{t('closeTitle', { count: view.unclosed })}</h2>
                <p className="m-0 text-body text-ink-2">{t('closeBody')}</p>
                {canSettle ? (
                  <RaiseActionButton
                    action={closePledgesAction.bind(null, org, event)}
                    label={t('close')}
                    variant="primary"
                    className="self-start"
                  />
                ) : null}
              </Card>
            ) : null}
            <Table<PledgeRowDto>
              caption={t('caption')}
              rows={view.rows}
              rowKey={(r) => r.pledgeId}
              empty={t('emptyTitle')}
              columns={[
                { key: 'paddle', header: t('columns.paddle'), mono: true, cell: (r) => r.paddleNumber },
                { key: 'holder', header: t('columns.holder'), cell: (r) => r.holderName },
                { key: 'level', header: t('columns.level'), cell: (r) => r.levelName },
                {
                  key: 'amount',
                  header: t('columns.amount'),
                  cell: (r) => <span className="tabular-nums">{fmt(r.amountMinor, r.currency)}</span>,
                },
                {
                  key: 'status',
                  header: t('columns.status'),
                  cell: (r) => <StatusPill tone={TONE[r.status]} label={t(`status.${r.status}`)} />,
                },
                {
                  key: 'detail',
                  header: t('columns.detail'),
                  cell: (r) => (
                    <span className="flex flex-col gap-1">
                      <span>{detail(r)}</span>
                      {r.payToken ? (
                        <a
                          href={`/events/${view.eventSlug}/pledge/${encodeURIComponent(r.payToken)}`}
                          className="inline-flex min-h-6 items-center text-caption font-semibold text-primary underline"
                        >
                          {t('payLink', { paddle: r.paddleNumber })}
                        </a>
                      ) : null}
                    </span>
                  ),
                },
                ...(canSettle
                  ? [
                      {
                        key: 'actions',
                        header: t('columns.actions'),
                        cell: (r: PledgeRowDto) =>
                          r.status === 'open' || r.status === 'scheduled' || r.status === 'invoiced' ? (
                            <SettleForms
                              paddle={r.paddleNumber}
                              today={today}
                              record={recordPledgePaymentAction.bind(
                                null,
                                org,
                                event,
                                r.pledgeId,
                                randomUUID(),
                              )}
                              writeOff={writeOffPledgeAction.bind(
                                null,
                                org,
                                event,
                                r.pledgeId,
                                r.amountMinor,
                                r.currency,
                              )}
                            />
                          ) : (
                            '—'
                          ),
                      },
                    ]
                  : []),
              ]}
            />
          </>
        )}
      </RaiseAnnouncer>
    </>
  );
}
