import { PADDLE_CONSOLE_CHANNEL, paddleReviewQuery, type ReviewEntryDto } from '@yayatoh/donations';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { realtimeChannelName } from '@yayatoh/platform';
import { Alert, Card, CardHeader, EmptyState, PageHeader, StatCard, StatusPill, Table } from '@yayatoh/ui';
import { ClipboardCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { RaiseActionButton, RaiseAnnouncer } from '../action-button.tsx';
import { confirmCallAction, confirmEntryAction, voidEntryAction } from '../actions.ts';
import { RefreshOnLive } from './refresh-on-live.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.review');
  return { title: t('title') };
}

const TONE = { recorded: 'neutral', duplicate: 'waiting', confirmed: 'success', voided: 'danger' } as const;

/**
 * The recorder's review (M4.8c): every level called, with the paddles spotters recorded and their
 * holders. The recorder confirms recorded paddles into pledges (a level at a time), decides on
 * duplicates one by one, and sets mistakes aside. `orders:read` reads; `events:write` confirms.
 */
export default async function PaddleReviewPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  if (!can('orders:read')) notFound();
  const view = await executeQuery(paddleReviewQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('donations.review');
  const tr = await getTranslations('donations.raise');
  const tn = await getTranslations('nav');
  const canConfirm = can('events:write');
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const n = new Intl.NumberFormat(locale);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  const base = `/o/${org}/e/${event}/donations`;
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tn('donations'), href: base },
        { label: tr('title'), href: `${base}/paddle-raise` },
        { label: t('title') },
      ]}
    />
  );
  return (
    <>
      <RefreshOnLive url={realtimeUrl(realtimeChannelName(PADDLE_CONSOLE_CHANNEL, data.org.id, ev.id))} />
      <PageHeader breadcrumb={crumbs} title={t('title')} description={t('subtitle')} />
      <RaiseAnnouncer>
        {canConfirm ? null : <Alert tone="info" title={t('viewerNotice')} />}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="review-totals">
          <StatCard label={tr('totalRaised')} value={fmt(view.totals.totalMinor, view.totals.currency)} />
          <StatCard label={t('pledges')} value={n.format(view.totals.pledgeCount)} />
          <StatCard label={tr('pledged')} value={fmt(view.totals.pledgedMinor, view.totals.currency)} />
          <StatCard label={tr('toReview')} value={n.format(view.totals.toReview)} />
        </div>
        {view.calls.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck strokeWidth={2} />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {view.calls.map(({ call, entries }) => {
              const waiting = entries.filter((e) => e.status === 'recorded').length;
              const level = tr('levelLine', {
                amount: fmt(call.amountMinor, call.currency),
                name: call.levelName,
              });
              return (
                <li key={call.id}>
                  <section aria-label={level}>
                    <Card size="panel" className="flex flex-col gap-4">
                      <CardHeader
                        as="h2"
                        title={level}
                        actions={
                          <StatusPill
                            tone={call.status === 'open' ? 'success' : 'neutral'}
                            label={call.status === 'open' ? tr('statusOpen') : tr('statusClosed')}
                          />
                        }
                      />
                      <p className="m-0 text-body text-ink tabular-nums">
                        {t('callSummary', {
                          count: call.count,
                          total: fmt(call.totalMinor, call.currency),
                          confirmed: call.confirmed,
                          duplicates: call.duplicates,
                        })}
                      </p>
                      {canConfirm && waiting > 0 ? (
                        <RaiseActionButton
                          action={confirmCallAction.bind(null, org, event, call.id)}
                          label={t('confirmAll', { count: waiting })}
                          variant="primary"
                          className="self-start"
                        />
                      ) : null}
                      {entries.length === 0 ? (
                        <p className="m-0 text-caption text-ink-2">{t('noEntries')}</p>
                      ) : (
                        <Table<ReviewEntryDto>
                          caption={t('entriesCaption', { level: call.levelName })}
                          rows={entries}
                          rowKey={(e) => e.id}
                          empty={t('noEntries')}
                          columns={[
                            {
                              key: 'paddle',
                              header: t('columns.paddle'),
                              mono: true,
                              cell: (e) => (
                                <span className="font-bold text-ink">{n.format(e.paddleNumber)}</span>
                              ),
                            },
                            {
                              key: 'holder',
                              header: t('columns.holder'),
                              cell: (e) => e.holderName ?? t('holderGone'),
                            },
                            {
                              key: 'status',
                              header: t('columns.status'),
                              cell: (e) => (
                                <StatusPill tone={TONE[e.status]} label={t(`status.${e.status}`)} />
                              ),
                            },
                            {
                              key: 'time',
                              header: t('columns.recorded'),
                              cell: (e) => time.format(e.recordedAt),
                            },
                            ...(canConfirm
                              ? [
                                  {
                                    key: 'actions',
                                    header: t('columns.actions'),
                                    cell: (e: ReviewEntryDto) =>
                                      e.status === 'voided' ? (
                                        '—'
                                      ) : (
                                        <div className="flex flex-wrap gap-2">
                                          {e.status === 'duplicate' ? (
                                            <RaiseActionButton
                                              action={confirmEntryAction.bind(
                                                null,
                                                org,
                                                event,
                                                e.id,
                                                e.paddleNumber,
                                              )}
                                              label={t('confirmOne', { number: e.paddleNumber })}
                                              size="sm"
                                            />
                                          ) : null}
                                          <RaiseActionButton
                                            action={voidEntryAction.bind(
                                              null,
                                              org,
                                              event,
                                              e.id,
                                              e.paddleNumber,
                                            )}
                                            label={t('void', { number: e.paddleNumber })}
                                            variant="ghost"
                                            size="sm"
                                          />
                                        </div>
                                      ),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      )}
                    </Card>
                  </section>
                </li>
              );
            })}
          </ol>
        )}
      </RaiseAnnouncer>
    </>
  );
}
