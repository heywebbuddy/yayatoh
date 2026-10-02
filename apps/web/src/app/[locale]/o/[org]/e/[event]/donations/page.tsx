import {
  type CampaignDto,
  catchUpGifts,
  donationsConsoleQuery,
  giftsExportBulk,
  type HostGiftDto,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import type { BulkOperationDto } from '@yayatoh/platform';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
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
  const t = await getTranslations('donations.console');
  const tn = await getTranslations('nav');
  const tb = await getTranslations('bulk');
  const te = await getTranslations();
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
  return (
    <>
      <PageHeader title={tn('donations')} description={t('subtitle')} />
      {view.connected ? null : (
        <Alert tone="info" title={t('connectTitle')}>
          <p>{t('connectBody')}</p>
          {can('payouts:manage') ? (
            <Link href={`/o/${org}/payouts`} className={buttonClass('primary', 'sm', 'mt-2 inline-flex')}>
              {t('connectAction')}
            </Link>
          ) : (
            <p className="mt-1">{t('connectAsk')}</p>
          )}
        </Alert>
      )}
      {view.connected && openCampaigns.length > 0 ? (
        ev.status === 'published' ? (
          <Card className="flex flex-col gap-2">
            <h2 className="text-section">{t('givingPage')}</h2>
            <p className="text-body text-zinc-600">{t('givingPageBody')}</p>
            <Link href={giving} className="self-start text-body underline underline-offset-2">
              {t('openGivingPage')}
            </Link>
          </Card>
        ) : (
          <p className="text-body text-zinc-600">{t('publishFirst')}</p>
        )
      ) : null}
      {canWrite ? null : <p className="text-body text-zinc-500">{t('viewerNotice')}</p>}
      {/* M4.8b: the charity profile's receipts, fair-market values and the receipts issued. */}
      {can('orders:read') ? (
        <Card className="flex flex-col gap-2">
          <h2 className="text-section">{t('receiptsTitle')}</h2>
          <p className="text-body text-zinc-600">{t('receiptsBody')}</p>
          <Link
            href={`/o/${org}/e/${event}/donations/receipts`}
            className="self-start text-body underline underline-offset-2"
          >
            {t('receiptsLink')}
          </Link>
        </Card>
      ) : null}

      <section aria-labelledby="campaigns-heading" className="flex flex-col gap-3">
        <h2 id="campaigns-heading" className="text-section">
          {t('campaigns')}
        </h2>
        {view.campaigns.length === 0 ? (
          <EmptyState
            title={t('emptyCampaignsTitle')}
            description={canWrite ? t('emptyCampaignsDescription') : t('emptyCampaignsViewer')}
          />
        ) : (
          <ol className="flex list-none flex-col gap-3 p-0">
            {view.campaigns.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-body font-medium">{c.name}</h3>
                    <span className="text-caption text-zinc-600">
                      {c.status === 'open' ? t('statusOpen') : t('statusClosed')}
                    </span>
                  </div>
                  {c.description ? <p className="text-body text-zinc-600">{c.description}</p> : null}
                  <p className="text-body">
                    {t('raised', {
                      raised: fmt(c.raisedMinor, c.currency),
                      goal: fmt(c.goalMinor, c.currency),
                      gifts: c.giftCount,
                    })}
                  </p>
                  {c.feeCoverMinor > 0 ? (
                    <p className="text-caption text-zinc-600">
                      {t('feesCovered', { amount: fmt(c.feeCoverMinor, c.currency) })}
                    </p>
                  ) : null}
                  <p className="text-caption text-zinc-600">
                    {t('limits', {
                      min: fmt(c.minGiftMinor, c.currency),
                      max: fmt(c.maxGiftMinor, c.currency),
                    })}
                  </p>
                  <h4 className="text-caption font-medium text-zinc-700">{t('levels')}</h4>
                  {c.levels.length === 0 ? (
                    <p className="text-caption text-zinc-500">{t('noLevels')}</p>
                  ) : (
                    <ul className="flex list-none flex-col gap-2 p-0">
                      {c.levels.map((l) => (
                        <li
                          key={l.id}
                          className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2"
                        >
                          <span className="text-body">
                            {t('levelLine', { amount: fmt(l.amountMinor, c.currency), name: l.name })}
                            {l.description ? (
                              <span className="block text-caption text-zinc-600">{l.description}</span>
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
                  {canWrite ? (
                    <>
                      <details>
                        <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
                          {t('addLevelTo', { name: c.name })}
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
                      <details>
                        <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
                          {t('editNamed', { name: c.name })}
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
                    </>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        )}
        {canWrite ? (
          <section aria-labelledby="add-campaign-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="add-campaign-heading" className="text-section">
                {t('addCampaign')}
              </h3>
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

      <section aria-labelledby="gifts-heading" className="flex flex-col gap-3">
        <h2 id="gifts-heading" className="text-section">
          {t('gifts')}
        </h2>
        {view.pendingCount > 0 ? (
          <p className="text-caption text-zinc-600">{t('pending', { count: view.pendingCount })}</p>
        ) : null}
        <Table<HostGiftDto>
          caption={t('giftsCaption')}
          rows={view.gifts}
          rowKey={(g) => g.id}
          empty={t('noGifts')}
          columns={[
            { key: 'date', header: t('columns.date'), cell: (g) => when.format(g.paidAt ?? g.createdAt) },
            { key: 'donor', header: t('columns.donor'), cell: (g) => g.shownName ?? t('anonymous') },
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
        {canExport && view.gifts.length > 0 ? (
          <StepUpForm action={exportGiftsAction.bind(null, org, event)} className="flex flex-wrap gap-3">
            <Button type="submit" variant="secondary" size="sm">
              {t('export')}
            </Button>
          </StepUpForm>
        ) : null}
        {sp.exportError ? (
          <Alert title={t('exportError', { reason: te(errorMessageKey(sp.exportError)) })} />
        ) : null}
        {op ? (
          <section
            aria-labelledby="export-heading"
            className="flex flex-col gap-2 rounded-panel border border-zinc-200 bg-white px-5 py-4"
          >
            {opActive ? <AutoRefresh seconds={2} /> : null}
            <h3 id="export-heading" className="text-section">
              {t('exportTitle')}
            </h3>
            <p className="text-body" role="status">
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
                href={`${locale === 'en' ? '' : `/${locale}`}/o/${org}/e/${event}/donations/exports/${op.id}`}
                className={buttonClass('primary', 'sm', 'self-start')}
                download
              >
                {tb('download')}
              </a>
            ) : null}
          </section>
        ) : null}
      </section>
    </>
  );
}
