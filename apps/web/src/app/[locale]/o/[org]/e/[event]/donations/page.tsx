import {
  type CampaignDto,
  catchUpGifts,
  donationsConsoleQuery,
  giftsExportBulk,
  type HostGiftDto,
  matchesQuery,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import type { BulkOperationDto } from '@yayatoh/platform';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CardHeader,
  cardClass,
  cx,
  EmptyState,
  PageHeader,
  ProgressBar,
  SectionHeader,
  StatCard,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import { ChevronDown, Gift, HandHeart } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { Crumbs } from '@/components/crumbs.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  createCampaignAction,
  createLevelAction,
  deleteLevelAction,
  exportGiftsAction,
  updateCampaignAction,
} from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('donations') };
}

/** A decimal amount for an edit form's default value (minor units → "1000" or "12.50"). */
const decimal = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

/**
 * Donations (M4.8a), the gala and community profiles' tab: campaigns with a goal and giving levels,
 * the paid gifts with each donor's name only as they chose (P4-13), totals, and the step-up CSV
 * export. Online giving needs a connected Stripe account (P4-9): until then the tab says so and the
 * public giving page stays closed. Viewers read; `events:write` changes campaigns and levels.
 */
export default async function DonationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ op?: string; exportError?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  // Gift outcomes from the outbox (the worker relays them; dev and e2e have none).
  await catchUpGifts(data.org.id);
  const view = await executeQuery(donationsConsoleQuery, { eventId: ev.id }, data.ctx, ports);
  // M4.8f: the running challenge matches, for the Matching gifts card.
  const running = can('orders:read')
    ? (await executeQuery(matchesQuery, { eventId: ev.id }, data.ctx, ports)).matches.filter(
        (m) => m.status === 'active',
      )
    : [];
  const tm = await getTranslations('donations.matches');
  const tr = await getTranslations('donations.report');
  const t = await getTranslations('donations.console');
  const tn = await getTranslations('nav');
  const tb = await getTranslations('bulk');
  const tg = await getTranslations('donations.give');
  const te = await getTranslations();
  const tp = await getTranslations('donations.raiseCard');
  const canWrite = can('events:write');
  const canExport = can('attendees:export');
  const fmt = (minor: number, currency = ev.currency) => formatMoney(money(minor, currency), locale);
  const n = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  let op: BulkOperationDto | null = null;
  if (canExport && sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    op = await executeQuery(giftsExportBulk.status, { operationId: sp.op }, data.ctx, ports).catch((err) => {
      if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) return null;
      throw err;
    });
    if (op && op.eventId !== ev.id) op = null;
  }
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;
  const errors = {
    name: t('errors.name'),
    'conflict.name': t('errors.nameTaken'),
    goalMinor: t('errors.amount'),
    minGiftMinor: t('errors.amount'),
    maxGiftMinor: t('errors.amount'),
    limits: t('errors.limits'),
    amountMinor: t('errors.amount'),
    amount_taken: t('errors.amountTaken'),
    too_many: t('errors.tooMany'),
    description: t('errors.description'),
  };
  const cur = ev.currency;
  const campaignFields = (c?: CampaignDto): FieldSpec[] => [
    {
      kind: 'text',
      name: 'name',
      label: t('campaignName'),
      required: true,
      maxLength: 120,
      defaultValue: c?.name,
    },
    {
      kind: 'text',
      name: 'goalMinor',
      label: t('goal', { currency: cur }),
      hint: t('goalHint'),
      required: true,
      defaultValue: c ? decimal(c.goalMinor) : undefined,
    },
    {
      kind: 'text',
      name: 'minGiftMinor',
      label: t('minGift', { currency: cur }),
      hint: c ? undefined : t('minGiftHint'),
      defaultValue: c ? decimal(c.minGiftMinor) : undefined,
    },
    {
      kind: 'text',
      name: 'maxGiftMinor',
      label: t('maxGift', { currency: cur }),
      hint: c ? undefined : t('maxGiftHint'),
      defaultValue: c ? decimal(c.maxGiftMinor) : undefined,
    },
    {
      kind: 'textarea',
      name: 'description',
      label: t('campaignDescription'),
      hint: t('campaignDescriptionHint'),
      rows: 3,
      defaultValue: c?.description ?? undefined,
    },
    ...(c
      ? [
          {
            kind: 'select' as const,
            name: 'status',
            label: t('status'),
            options: [
              { value: 'open', label: t('statusOpen') },
              { value: 'closed', label: t('statusClosed') },
            ],
            defaultValue: c.status,
          },
        ]
      : []),
  ];
  const levelFields: FieldSpec[] = [
    {
      kind: 'text',
      name: 'name',
      label: t('levelName'),
      hint: t('levelNameHint'),
      required: true,
      maxLength: 80,
    },
    { kind: 'text', name: 'amountMinor', label: t('levelAmount', { currency: cur }), required: true },
    {
      kind: 'text',
      name: 'description',
      label: t('levelDescription'),
      hint: t('levelDescriptionHint'),
      maxLength: 200,
    },
  ];
  const campaignName = new Map(view.campaigns.map((c) => [c.id, c.name]));
  const giving = `/events/${ev.slug}/give`;
  const openCampaigns = view.campaigns.filter((c) => c.status === 'open');
  // Totals of the event's own currency (campaigns take the event's currency).
  const own = view.campaigns.filter((c) => c.currency === cur);
  const sum = (pick: (c: CampaignDto) => number) => own.reduce((a, c) => a + pick(c), 0);
  const raised = sum((c) => c.raisedMinor);
  const goal = sum((c) => c.goalMinor);
  const disclosure =
    'inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-control text-[13px] font-bold text-primary-ink underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden';
  const chevron = (
    <ChevronDown
      aria-hidden="true"
      className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
      strokeWidth={2}
    />
  );
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tn('donations') },
      ]}
    />
  );
  return (
    <>
      <PageHeader breadcrumb={crumbs} title={tn('donations')} description={t('subtitle')} />
      {view.connected ? null : (
        <Alert tone="warning" title={t('connectTitle')}>
          <p className="m-0">{t('connectBody')}</p>
          {can('payouts:manage') ? (
            <Link href={`/o/${org}/payouts`} className={buttonClass('primary', 'sm', 'mt-3')}>
              {t('connectAction')}
            </Link>
          ) : (
            <p className="m-0 mt-1">{t('connectAsk')}</p>
          )}
        </Alert>
      )}
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}
      {view.campaigns.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="donations-stats">
          <StatCard
            label={tg('progressLabel')}
            value={fmt(raised)}
            progress={
              goal > 0
                ? { value: Math.min(raised, goal), max: goal, label: tg('progressLabel'), tone: 'success' }
                : undefined
            }
          />
          <StatCard
            label={t('giftsCaption')}
            value={n.format(view.campaigns.reduce((a, c) => a + c.giftCount, 0))}
          />
          <StatCard label={t('columns.feeCover')} value={fmt(sum((c) => c.feeCoverMinor))} />
          <StatCard label={te('order.status.awaiting_payment')} value={n.format(view.pendingCount)} />
        </div>
      ) : null}
      {view.connected && openCampaigns.length > 0 ? (
        ev.status === 'published' ? (
          <Card tone="feature" className="flex flex-col gap-3">
            <CardHeader
              title={t('givingPage')}
              actions={
                <Link href={giving} className={buttonClass('primary', 'md')}>
                  {t('openGivingPage')}
                </Link>
              }
            />
            <p className="m-0 text-body text-ink-2">{t('givingPageBody')}</p>
          </Card>
        ) : (
          <Alert tone="info" title={t('publishFirst')} />
        )
      ) : null}
      {/* M4.8b: the charity profile's receipts, fair-market values and the receipts issued. */}
      {can('orders:read') ? (
        <Card className="flex flex-col gap-3">
          <CardHeader
            title={t('receiptsTitle')}
            actions={
              <Link
                href={`/o/${org}/e/${event}/donations/receipts`}
                className={buttonClass('secondary', 'sm')}
              >
                {t('receiptsLink')}
              </Link>
            }
          />
          <p className="m-0 text-body text-ink-2">{t('receiptsBody')}</p>
        </Card>
      ) : null}

      {/* M4.8f: challenge matches and the employer matching list. */}
      {can('orders:read') ? (
        <Card className="flex flex-col gap-3" data-testid="matches-card">
          <CardHeader
            title={tm('title')}
            actions={
              <Link
                href={`/o/${org}/e/${event}/donations/matches`}
                className={buttonClass('secondary', 'sm')}
              >
                {tm('cardLink')}
              </Link>
            }
          />
          <p className="m-0 text-body text-ink-2">{tm('cardBody')}</p>
          {running.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {running.map((m) => (
                <li key={m.id} className="text-body text-ink">
                  <span className="font-bold">
                    {tm('headline', {
                      ratio: `r${m.ratioPercent}`,
                      percent: n.format(m.ratioPercent),
                      cap: fmt(m.capMinor, m.currency),
                    })}
                  </span>{' '}
                  <span className="text-ink-2 tabular-nums">
                    {tm('progress', {
                      matched: fmt(m.matchedMinor, m.currency),
                      cap: fmt(m.capMinor, m.currency),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {/* M4.8g: the donations report, donor CRM exports and reconciliation (finance roles). */}
      {can('finance:read') ? (
        <Card className="flex flex-col gap-3" data-testid="report-card">
          <CardHeader
            title={tr('cardTitle')}
            actions={
              <Link href={`/o/${org}/e/${event}/donations/report`} className={buttonClass('secondary', 'sm')}>
                {tr('cardLink')}
              </Link>
            }
          />
          <p className="m-0 text-body text-ink-2">{tr('cardBody')}</p>
          <Link
            href={`/o/${org}/e/${event}/donations/reconciliation`}
            className="inline-flex min-h-6 items-center self-start text-body font-bold text-ink underline underline-offset-4"
          >
            {tr('cardReconcile')}
          </Link>
        </Card>
      ) : null}

      {/* M4.8c: the paddle raise (console, spotters, review) and the paddle numbers. */}
      {can('orders:read') || can('checkin:scan') || can('guests:read') ? (
        <Card className="flex flex-col gap-3" data-testid="paddle-raise-card">
          <CardHeader as="h2" title={tp('cardTitle')} />
          <p className="m-0 text-body text-ink-2">{tp('cardBody')}</p>
          <div className="flex flex-wrap gap-2">
            {can('orders:read') ? (
              <Link
                href={`/o/${org}/e/${event}/donations/paddle-raise`}
                className={buttonClass('secondary', 'sm')}
              >
                {tp('openConsole')}
              </Link>
            ) : null}
            {can('orders:read') ? (
              <Link href={`/o/${org}/e/${event}/donations/screen`} className={buttonClass('secondary', 'sm')}>
                {tp('openScreen')}
              </Link>
            ) : null}
            {can('checkin:scan') ? (
              <Link
                href={`/o/${org}/e/${event}/donations/paddle-raise/spot`}
                className={buttonClass('secondary', 'sm')}
              >
                {tp('openSpotter')}
              </Link>
            ) : null}
            {can('guests:read') ? (
              <Link
                href={`/o/${org}/e/${event}/donations/paddles`}
                className={buttonClass('secondary', 'sm')}
              >
                {tp('openPaddles')}
              </Link>
            ) : null}
            {/* M4.8e: pledge collection and saved cards. */}
            {can('orders:read') ? (
              <Link
                href={`/o/${org}/e/${event}/donations/pledges`}
                className={buttonClass('secondary', 'sm')}
              >
                {tp('openPledges')}
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      <section aria-labelledby="campaigns-heading" className="flex flex-col gap-4">
        <SectionHeader id="campaigns-heading" title={t('campaigns')} />
        {view.campaigns.length === 0 ? (
          <EmptyState
            icon={<HandHeart strokeWidth={2} />}
            title={t('emptyCampaignsTitle')}
            description={canWrite ? t('emptyCampaignsDescription') : t('emptyCampaignsViewer')}
          />
        ) : (
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {view.campaigns.map((c) => (
              <li key={c.id}>
                <Card size="panel" className="flex flex-col gap-4">
                  <CardHeader
                    as="h3"
                    title={c.name}
                    actions={
                      <StatusPill
                        tone={c.status === 'open' ? 'success' : 'neutral'}
                        label={c.status === 'open' ? t('statusOpen') : t('statusClosed')}
                      />
                    }
                  />
                  {c.description ? <p className="m-0 text-body text-ink-2">{c.description}</p> : null}
                  <div className="flex flex-col gap-2">
                    <p className="m-0 text-body font-bold text-ink tabular-nums">
                      {t('raised', {
                        raised: fmt(c.raisedMinor, c.currency),
                        goal: fmt(c.goalMinor, c.currency),
                        gifts: c.giftCount,
                      })}
                    </p>
                    <ProgressBar
                      value={Math.min(c.raisedMinor, c.goalMinor)}
                      max={c.goalMinor}
                      label={tg('progressLabel')}
                      tone="success"
                    />
                    {c.feeCoverMinor > 0 ? (
                      <p className="m-0 text-caption text-ink-2">
                        {t('feesCovered', { amount: fmt(c.feeCoverMinor, c.currency) })}
                      </p>
                    ) : null}
                    <p className="m-0 text-caption text-ink-2">
                      {t('limits', {
                        min: fmt(c.minGiftMinor, c.currency),
                        max: fmt(c.maxGiftMinor, c.currency),
                      })}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <h4 className="m-0 text-label text-ink-2 uppercase">{t('levels')}</h4>
                    {c.levels.length === 0 ? (
                      <p className="m-0 text-caption text-ink-2">{t('noLevels')}</p>
                    ) : (
                      <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-tile border border-line bg-surface-2 p-0">
                        {c.levels.map((l) => (
                          <li
                            key={l.id}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                          >
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="text-body font-bold text-ink tabular-nums">
                                {t('levelLine', { amount: fmt(l.amountMinor, c.currency), name: l.name })}
                              </span>
                              {l.description ? (
                                <span className="text-caption text-ink-2">{l.description}</span>
                              ) : null}
                            </span>
                            {canWrite ? (
                              <ProgramForm
                                action={deleteLevelAction.bind(null, org, event, l.id)}
                                fields={[]}
                                idPrefix={`level-${l.id}`}
                                submitLabel={t('removeLevel', { name: l.name })}
                                successLabel={t('levelRemoved')}
                                errors={errors}
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {canWrite ? (
                    <div className="flex flex-col gap-1 border-t border-line pt-3">
                      <details className="group">
                        <summary className={disclosure}>
                          {t('addLevelTo', { name: c.name })}
                          {chevron}
                        </summary>
                        <div className="pt-3">
                          <ProgramForm
                            action={createLevelAction.bind(null, org, event, c.id)}
                            fields={levelFields}
                            idPrefix={`new-level-${c.id}`}
                            submitLabel={t('addLevel')}
                            successLabel={t('levelAdded')}
                            errors={errors}
                            reset
                          />
                        </div>
                      </details>
                      <details className="group">
                        <summary className={disclosure}>
                          {t('editNamed', { name: c.name })}
                          {chevron}
                        </summary>
                        <div className="pt-3">
                          <ProgramForm
                            action={updateCampaignAction.bind(null, org, event, c.id)}
                            fields={campaignFields(c)}
                            idPrefix={`campaign-${c.id}`}
                            submitLabel={t('save')}
                            successLabel={t('saved')}
                            errors={errors}
                          />
                        </div>
                      </details>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        )}
        {canWrite ? (
          <section aria-labelledby="add-campaign-heading">
            <Card size="panel" className="flex flex-col gap-4">
              <CardHeader as="h3" id="add-campaign-heading" title={t('addCampaign')} />
              <ProgramForm
                action={createCampaignAction.bind(null, org, event)}
                fields={campaignFields()}
                idPrefix="new-campaign"
                submitLabel={t('addCampaign')}
                successLabel={t('campaignAdded')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        ) : null}
      </section>

      <section aria-labelledby="gifts-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="gifts-heading"
          title={t('gifts')}
          actions={
            canExport && view.gifts.length > 0 ? (
              <StepUpForm action={exportGiftsAction.bind(null, org, event)} className="flex flex-wrap gap-3">
                <Button type="submit" variant="secondary" size="sm">
                  {t('export')}
                </Button>
              </StepUpForm>
            ) : undefined
          }
        />
        {sp.exportError ? (
          <Alert title={t('exportError', { reason: te(errorMessageKey(sp.exportError)) })} />
        ) : null}
        {op ? (
          <section aria-labelledby="export-heading" className={cx(cardClass(), 'flex flex-col gap-3')}>
            {opActive ? <AutoRefresh seconds={2} /> : null}
            <h3 id="export-heading" className="m-0 text-card text-ink">
              {t('exportTitle')}
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
            {opActive && op.total > 0 ? (
              <ProgressBar value={op.processed} max={op.total} label={t('exportTitle')} />
            ) : null}
            {op.status === 'done' && op.hasFile ? (
              <a
                href={`${locale === 'en' ? '' : `/${locale}`}/o/${org}/e/${event}/donations/exports/${op.id}`}
                className={buttonClass('primary', 'sm', 'self-start')}
                download
              >
                {tb('download')}
              </a>
            ) : null}
          </section>
        ) : null}
        {view.gifts.length === 0 ? (
          <EmptyState icon={<Gift strokeWidth={2} />} title={t('noGifts')} />
        ) : (
          <Table<HostGiftDto>
            caption={t('giftsCaption')}
            rows={view.gifts}
            rowKey={(g) => g.id}
            empty={t('noGifts')}
            columns={[
              { key: 'date', header: t('columns.date'), cell: (g) => when.format(g.paidAt ?? g.createdAt) },
              {
                key: 'donor',
                header: t('columns.donor'),
                cell: (g) =>
                  g.shownName ? (
                    <span className="font-bold text-ink">{g.shownName}</span>
                  ) : (
                    <span className="text-ink-2">{t('anonymous')}</span>
                  ),
              },
              {
                key: 'amount',
                header: t('columns.amount'),
                align: 'end',
                mono: true,
                cell: (g) => fmt(g.amountMinor, g.currency),
              },
              {
                key: 'cover',
                header: t('columns.feeCover'),
                align: 'end',
                mono: true,
                cell: (g) => (g.feeCoverMinor > 0 ? fmt(g.feeCoverMinor, g.currency) : '—'),
              },
              {
                key: 'campaign',
                header: t('columns.campaign'),
                cell: (g) => [campaignName.get(g.campaignId), g.levelName].filter(Boolean).join(' · '),
              },
              {
                key: 'tribute',
                header: t('columns.tribute'),
                cell: (g) => (g.tribute ? t(`tributeLine.${g.tribute.kind}`, { name: g.tribute.name }) : '—'),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
