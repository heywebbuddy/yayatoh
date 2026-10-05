import { eventLifecycle } from '@yayatoh/events';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { cancellationPreviewQuery, type MassRefundDto, massRefundsQuery } from '@yayatoh/orders';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Card, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { cancelAndRefundAction, postponeAction, steerRunAction } from './actions.ts';

type State = (typeof eventLifecycle.states)[number];

/**
 * The cancel/postpone wizard (M3.10b). Choose what happens; cancelling shows the money first
 * (orders, gross, fees, refunds per funds flow, what is left out) and, once confirmed, cancels the
 * event and starts the resumable mass refund; its progress shows here (pause, resume, the
 * reconciliation at the end). Postponing keeps tickets valid and emails every buyer. Event
 * editors only; refunding needs `orders:refund` too.
 */
export default async function CancelWizardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ step?: string; run?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'home');
  if (!roleCan(data.role, 'events:write')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('refundOps');
  const tAll = await getTranslations();
  const canRefund = roleCan(data.role, 'orders:refund') && data.modules.has('ticketing');
  const status = ev.status as State;
  const canCancel = eventLifecycle.can(status, 'cancel');
  const canPostpone = eventLifecycle.can(status, 'postpone');
  const runs = canRefund ? await executeQuery(massRefundsQuery, { eventId: ev.id }, data.ctx, ports) : [];
  const live = runs.find((r) => r.status !== 'done') ?? null;
  const shown = runs.find((r) => r.id === sp.run) ?? live ?? (status === 'cancelled' ? runs[0] : undefined);
  const step = sp.step === 'cancel' || sp.step === 'postpone' ? sp.step : null;
  const fmt = (minor: number) => formatMoney(money(minor, ev.currency), locale);
  const base = `/o/${org}/e/${event}/cancel`;
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  // Refunding everyone: after choosing "cancel", or on an event cancelled without a batch yet.
  const offerRefunds =
    canRefund && !live && ((step === 'cancel' && canCancel) || (status === 'cancelled' && runs.length === 0));
  const preview = offerRefunds
    ? await executeQuery(cancellationPreviewQuery, { eventId: ev.id }, data.ctx, ports)
    : null;

  return (
    <>
      <PageHeader title={t('wizard.title')} description={t('wizard.description', { name: ev.name })} />
      {shown ? <RunCard run={shown} org={org} event={event} locale={locale} when={when} /> : null}

      {status === 'postponed' ? <Alert tone="info" title={t('wizard.postponedAlready')} /> : null}
      {status === 'cancelled' && !shown && !offerRefunds ? (
        <Alert tone="info" title={t('wizard.cancelledAlready')} />
      ) : null}

      {!step && !live && (canCancel || canPostpone) ? (
        <Card className="flex flex-col gap-4">
          <form method="get" className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-3">
              <legend className="text-section">{t('wizard.choose', { name: ev.name })}</legend>
              {canCancel ? (
                <label className="flex min-h-6 items-start gap-2 text-body">
                  <input
                    type="radio"
                    name="step"
                    value="cancel"
                    required
                    className="mt-0.5 size-5 shrink-0"
                  />
                  <span className="flex flex-col">
                    <span>{t('wizard.cancelOption')}</span>
                    <span className="text-caption text-ink-2">
                      {canRefund ? t('wizard.cancelHint') : t('wizard.cancelNoRefundHint')}
                    </span>
                  </span>
                </label>
              ) : null}
              {canPostpone ? (
                <label className="flex min-h-6 items-start gap-2 text-body">
                  <input
                    type="radio"
                    name="step"
                    value="postpone"
                    required
                    className="mt-0.5 size-5 shrink-0"
                  />
                  <span className="flex flex-col">
                    <span>{t('wizard.postponeOption')}</span>
                    <span className="text-caption text-ink-2">{t('wizard.postponeHint')}</span>
                  </span>
                </label>
              ) : null}
            </fieldset>
            <Button type="submit" className="self-start">
              {t('wizard.continue')}
            </Button>
          </form>
        </Card>
      ) : null}

      {step === 'cancel' && canCancel && !canRefund ? (
        <Card className="flex flex-col gap-3">
          <Alert title={t('wizard.notAllowed')} />
          <Link href={base} className={buttonClass('secondary', 'md', 'self-start')}>
            {t('wizard.back')}
          </Link>
        </Card>
      ) : null}

      {preview ? (
        <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
          <h2 id="preview-heading" className="text-section">
            {t('wizard.previewTitle')}
          </h2>
          <Card className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
              {(
                [
                  ['orders', String(preview.orders)],
                  ['gross', fmt(preview.grossMinor)],
                  ['fees', fmt(preview.feesMinor)],
                  ['alreadyRefunded', fmt(preview.alreadyRefundedMinor)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-caption text-ink-2">{t(`wizard.${k}`)}</dt>
                  <dd className="font-mono text-body tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <Table
              caption={t('wizard.previewCaption')}
              rowKey={(r) => r.key}
              rows={[
                ...(['platform_mor', 'organizer_mor'] as const)
                  .filter((f) => preview.byFlow[f].orders > 0)
                  .map((f) => ({ key: f, label: tAll(`refunds.soldBy.${f}`), ...preview.byFlow[f] })),
                { key: 'total', label: t('wizard.total'), ...preview.refund },
              ]}
              columns={[
                { key: 'flow', header: t('wizard.flowCol'), cell: (r) => r.label },
                {
                  key: 'orders',
                  header: t('wizard.refundOrders'),
                  cell: (r) => r.orders,
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'amount',
                  header: t('wizard.refundTotal'),
                  cell: (r) => fmt(r.amountMinor),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'fee',
                  header: t('wizard.feeBack'),
                  cell: (r) => fmt(r.feeBackMinor),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'org',
                  header: t('wizard.organizerShare'),
                  cell: (r) => fmt(r.organizerMinor),
                  mono: true,
                  align: 'end',
                },
              ]}
            />
            {preview.disputed.orders > 0 ? (
              <Alert
                tone="info"
                title={t('wizard.disputed', {
                  count: preview.disputed.orders,
                  amount: fmt(preview.disputed.grossMinor),
                })}
              />
            ) : null}
            {preview.organizerCollected.orders > 0 ? (
              <Alert
                tone="info"
                title={t('wizard.collected', {
                  count: preview.organizerCollected.orders,
                  amount: fmt(preview.organizerCollected.grossMinor),
                })}
              />
            ) : null}
            <StepUpForm action={cancelAndRefundAction.bind(null, org, event)} className="flex flex-col gap-4">
              <label className="flex min-h-6 items-start gap-2 text-body">
                <input
                  type="checkbox"
                  name="confirm"
                  value="yes"
                  required
                  className="mt-0.5 size-5 shrink-0"
                />
                <span>
                  {status === 'cancelled'
                    ? t('wizard.confirmRefunds', {
                        count: preview.refund.orders,
                        amount: fmt(preview.refund.amountMinor),
                      })
                    : t('wizard.confirm', {
                        name: ev.name,
                        count: preview.refund.orders,
                        amount: fmt(preview.refund.amountMinor),
                      })}
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">
                  {status === 'cancelled' ? t('wizard.startRefundsOnly') : t('wizard.start')}
                </Button>
                {step ? (
                  <Link href={base} className={buttonClass('secondary')}>
                    {t('wizard.back')}
                  </Link>
                ) : null}
              </div>
            </StepUpForm>
          </Card>
        </section>
      ) : null}

      {step === 'postpone' && canPostpone ? (
        <section aria-labelledby="postpone-heading" className="flex flex-col gap-3">
          <h2 id="postpone-heading" className="text-section">
            {t('wizard.postponeTitle', { name: ev.name })}
          </h2>
          <Card className="flex flex-col gap-4">
            <p className="text-body">{t('wizard.postponeBody')}</p>
            <StepUpForm action={postponeAction.bind(null, org, event)} className="flex flex-wrap gap-2">
              <Button type="submit">{t('wizard.postpone')}</Button>
              <Link href={base} className={buttonClass('secondary')}>
                {t('wizard.back')}
              </Link>
            </StepUpForm>
          </Card>
        </section>
      ) : null}
    </>
  );
}

/** A mass refund's progress: counts, pause/resume, what was left out, and the reconciliation. */
async function RunCard({
  run,
  org,
  event,
  locale,
  when,
}: {
  run: MassRefundDto;
  org: string;
  event: string;
  locale: string;
  when: Intl.DateTimeFormat;
}) {
  const t = await getTranslations('refundOps.run');
  const fmt = (minor: number) => formatMoney(money(minor, run.currency), locale);
  const counts = [
    ['refunded', run.refunded],
    ['skippedDisputed', run.skippedDisputed],
    ['skipped', run.skipped],
    ['failed', run.failed],
  ] as const;
  return (
    <section aria-labelledby="run-heading" className="flex flex-col gap-3">
      {run.status === 'running' ? <AutoRefresh seconds={3} /> : null}
      <h2 id="run-heading" className="text-section">
        {t('title')}
      </h2>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusDot
            status={run.status === 'done' ? 'success' : run.status === 'paused' ? 'warning' : 'info'}
            label={t(`status.${run.status}`)}
          />
          <span className="text-caption text-ink-2">
            {t('started', { date: when.format(run.createdAt) })}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <progress
            value={run.processed}
            max={Math.max(run.total, 1)}
            aria-label={t('progressLabel')}
            className="h-2 w-full accent-primary"
          />
          <p className="text-body" aria-live="polite">
            {t('progress', { processed: run.processed, total: run.total })}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-5">
          {counts.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-caption text-ink-2">{t(k)}</dt>
              <dd className="font-mono text-body tabular-nums">{v}</dd>
            </div>
          ))}
          <div className="flex flex-col">
            <dt className="text-caption text-ink-2">{t('amount')}</dt>
            <dd className="font-mono text-body tabular-nums">{fmt(run.refundedMinor)}</dd>
          </div>
        </dl>
        {run.status === 'running' ? <p className="text-caption text-ink-2">{t('working')}</p> : null}
        {run.status === 'paused' ? <p className="text-caption text-ink-2">{t('paused')}</p> : null}
        {run.status !== 'done' ? (
          <StepUpForm
            action={steerRunAction.bind(
              null,
              org,
              event,
              run.id,
              run.status === 'running' ? 'pause' : 'resume',
            )}
            className="flex flex-wrap gap-2"
          >
            <Button type="submit" variant={run.status === 'running' ? 'secondary' : 'primary'}>
              {run.status === 'running' ? t('pause') : t('resume')}
            </Button>
          </StepUpForm>
        ) : null}
        {run.reconciliation ? (
          run.reconciliation.reconciled ? (
            <Alert tone="info" title={t('reconciled', { amount: fmt(run.refundedMinor) })} />
          ) : (
            <Alert
              title={t('notReconciled', {
                ledger: fmt(-run.reconciliation.ledgerCashMinor),
                expected: fmt(-run.reconciliation.expectedCashMinor),
              })}
            />
          )
        ) : null}
        {run.reconciliation && run.reconciliation.receivableMinor > 0 ? (
          <p className="text-caption text-ink-2">
            {t('receivable', { amount: fmt(run.reconciliation.receivableMinor) })}
          </p>
        ) : null}
        {run.exceptions.length > 0 ? (
          <Table
            caption={t('exceptions')}
            rowKey={(e) => e.orderId}
            rows={run.exceptions}
            columns={[
              {
                key: 'order',
                header: t('order'),
                cell: (e) => (
                  <Link
                    href={`/o/${org}/e/${event}/orders/${e.orderId}`}
                    className="inline-flex min-h-6 items-center underline underline-offset-2"
                  >
                    {e.buyerName}
                  </Link>
                ),
              },
              {
                key: 'why',
                header: t('why'),
                cell: (e) =>
                  t.has(`codes.${e.code}`) ? t(`codes.${e.code}`) : t('codes.failed', { code: e.code ?? '' }),
              },
            ]}
          />
        ) : null}
      </Card>
    </section>
  );
}
