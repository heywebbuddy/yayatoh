import {
  type CallDto,
  type ConsoleLiveDto,
  PADDLE_CONSOLE_CHANNEL,
  paddleConsoleQuery,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { realtimeChannelName } from '@yayatoh/platform';
import {
  Alert,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  SectionHeader,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import { Gavel } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { RaiseActionButton } from './action-button.tsx';
import { armLevelAction, closeCallAction, undoAction } from './actions.ts';
import { RaiseLive } from './raise-live.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.raise');
  return { title: t('title') };
}

/**
 * The paddle-raise console (M4.8c), for the host or the auctioneer: arm a level, watch the running
 * count and total climb as spotters sync, close the level, undo the last step. `orders:read` sees
 * it; `events:write` runs it. Spotters use their own page; the recorder confirms pledges on Review.
 */
export default async function PaddleRaisePage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  if (!can('orders:read')) notFound();
  const view = await executeQuery(paddleConsoleQuery, { eventId: ev.id }, data.ctx, ports);
  const t = await getTranslations('donations.raise');
  const tn = await getTranslations('nav');
  const canRun = can('events:write');
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const n = new Intl.NumberFormat(locale);
  const base = `/o/${org}/e/${event}/donations`;
  const levels = view.campaigns.flatMap((c) => c.levels.map((l) => ({ ...l, campaign: c })));
  const open = view.open;
  const live: ConsoleLiveDto = { open: view.open, totals: view.totals };
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
  return (
    <>
      <PageHeader
        breadcrumb={crumbs}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`${base}/paddle-raise/review`} className={buttonClass('secondary', 'md')}>
              {t('openReview', { count: view.totals.toReview })}
            </Link>
            <Link href={`${base}/paddle-raise/spot`} className={buttonClass('secondary', 'md')}>
              {t('openSpotter')}
            </Link>
          </div>
        }
      />
      {canRun ? null : <Alert tone="info" title={t('viewerNotice')} />}
      {view.paddleCount === 0 ? (
        <Alert tone="warning" title={t('noPaddlesTitle')}>
          <p className="m-0">{t('noPaddlesBody')}</p>
          <Link href={`${base}/paddles`} className={buttonClass('primary', 'sm', 'mt-3')}>
            {t('openPaddles')}
          </Link>
        </Alert>
      ) : null}
      <RaiseLive
        url={realtimeUrl(realtimeChannelName(PADDLE_CONSOLE_CHANNEL, data.org.id, ev.id))}
        initial={live}
      />
      {canRun ? (
        <section aria-labelledby="controls-heading" className="flex flex-col gap-4">
          <SectionHeader id="controls-heading" title={t('controls')} />
          {open ? (
            <Card size="panel" className="flex flex-wrap items-start gap-4">
              <RaiseActionButton
                action={closeCallAction.bind(null, org, event, open.id)}
                label={t('close', { name: open.levelName })}
                variant="primary"
                size="lg"
                testId="close-level"
              />
              <RaiseActionButton
                action={undoAction.bind(null, org, event)}
                label={t('undo')}
                size="lg"
                testId="undo"
              />
            </Card>
          ) : levels.length === 0 ? (
            <EmptyState
              icon={<Gavel strokeWidth={2} />}
              title={t('noLevelsTitle')}
              description={t('noLevelsDescription')}
              action={
                <Link href={base} className={buttonClass('primary', 'md')}>
                  {t('openDonations')}
                </Link>
              }
            />
          ) : (
            <Card size="panel" className="flex flex-col gap-4">
              <CardHeader as="h3" title={t('armTitle')} />
              <p className="m-0 text-body text-ink-2">{t('armBody')}</p>
              <ul className="m-0 flex list-none flex-wrap gap-3 p-0" aria-label={t('armTitle')}>
                {levels.map((l) => (
                  <li key={l.id}>
                    <RaiseActionButton
                      action={armLevelAction.bind(null, org, event, l.campaign.id, l.id)}
                      label={t('arm', { amount: fmt(l.amountMinor, l.campaign.currency), name: l.name })}
                      variant="primary"
                      size="lg"
                    />
                  </li>
                ))}
              </ul>
              {view.calls.length > 0 ? (
                <RaiseActionButton
                  action={undoAction.bind(null, org, event)}
                  label={t('undo')}
                  className="self-start"
                  testId="undo"
                />
              ) : null}
            </Card>
          )}
        </section>
      ) : null}
      <section aria-labelledby="calls-heading" className="flex flex-col gap-4">
        <SectionHeader id="calls-heading" title={t('callsTitle')} />
        {view.calls.length === 0 ? (
          <EmptyState icon={<Gavel strokeWidth={2} />} title={t('noCalls')} />
        ) : (
          <Table<CallDto>
            caption={t('callsTitle')}
            rows={view.calls}
            rowKey={(c) => c.id}
            empty={t('noCalls')}
            columns={[
              {
                key: 'level',
                header: t('columns.level'),
                cell: (c) => t('levelLine', { amount: fmt(c.amountMinor, c.currency), name: c.levelName }),
              },
              {
                key: 'status',
                header: t('columns.status'),
                cell: (c) => (
                  <StatusPill
                    tone={c.status === 'open' ? 'success' : 'neutral'}
                    label={c.status === 'open' ? t('statusOpen') : t('statusClosed')}
                  />
                ),
              },
              {
                key: 'count',
                header: t('columns.paddles'),
                align: 'end',
                mono: true,
                cell: (c) => n.format(c.count),
              },
              {
                key: 'total',
                header: t('columns.total'),
                align: 'end',
                mono: true,
                cell: (c) => fmt(c.totalMinor, c.currency),
              },
              {
                key: 'duplicates',
                header: t('columns.duplicates'),
                align: 'end',
                mono: true,
                cell: (c) => n.format(c.duplicates),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
