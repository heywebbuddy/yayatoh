import { listEventsQuery } from '@yayatoh/events';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { payoutAccountQuery, receivablesQuery, settlementsQuery } from '@yayatoh/payments';
import { roleCan } from '@yayatoh/tenancy';
import { Button, Card, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StepUpForm } from '@/components/step-up.tsx';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { startPayoutOnboarding } from './actions.ts';

const DOT = { none: 'neutral', pending: 'info', restricted: 'warning', active: 'success' } as const;

/**
 * Payouts (M1.3c): connect the organization's payout account with the payment provider. Until
 * the account is fully enabled, orders are charged by the platform and paid out after the event
 * (platform_mor); once active, buyers pay the organizer directly (organizer_mor).
 */
export default async function PayoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { locale, org } = await params;
  const { onboarding } = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations('payouts');
  const account = await executeQuery(payoutAccountQuery, {}, data.ctx, ports);
  const canManage = roleCan(data.role, 'payouts:manage');
  const canSeeMoney = roleCan(data.role, 'finance:read');
  const settlements = canSeeMoney ? await executeQuery(settlementsQuery, {}, data.ctx, ports) : [];
  const receivables = canSeeMoney ? await executeQuery(receivablesQuery, {}, data.ctx, ports) : null;
  const eventNames = new Map(
    settlements.length || receivables?.entries.length
      ? (await executeQuery(listEventsQuery, {}, data.ctx, ports)).map((e) => [e.id, e.name])
      : [],
  );
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const SETTLEMENT_DOT = {
    ready: 'info',
    waiting_account: 'warning',
    transferred: 'success',
    failed: 'danger',
  } as const;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {onboarding === 'returned' && account.state !== 'active' ? (
        <p role="status" className="rounded-card border border-line bg-surface-2 px-4 py-3 text-body">
          {t('returned')}
        </p>
      ) : null}
      {account.onHold ? (
        <p
          role="status"
          className="rounded-card border border-primary bg-primary-soft px-4 py-3 text-body text-primary-ink"
        >
          {t('onHold')}
        </p>
      ) : null}
      {account.destinationHoldUntil ? (
        <p role="status" className="rounded-card border border-line bg-surface px-4 py-3 text-body">
          {t('destinationHold', {
            until: new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: data.org.timezone,
            }).format(account.destinationHoldUntil),
          })}
        </p>
      ) : null}
      <Card className="flex flex-col gap-4">
        <StatusDot status={DOT[account.state]} label={t(`state.${account.state}`)} />
        <p className="text-body text-ink-2">{t(`explain.${account.state}`)}</p>
        {account.state === 'restricted' && account.requirementsDue.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-caption text-ink-2">{t('requirements')}</p>
            <ul className="flex list-none flex-col gap-1 p-0">
              {account.requirementsDue.map((r) => (
                <li key={r} className="font-mono text-caption">
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-caption text-ink-2">{t(`flow.${account.fundsFlow}`)}</p>
        {canManage && account.state !== 'active' ? (
          <StepUpForm action={startPayoutOnboarding.bind(null, org, locale)}>
            <Button type="submit">{account.state === 'none' ? t('start') : t('continue')}</Button>
          </StepUpForm>
        ) : !canManage ? (
          <p className="text-caption text-ink-2">{t('noAccess')}</p>
        ) : null}
      </Card>
      {canSeeMoney ? (
        <section aria-labelledby="settlements-heading" className="flex flex-col gap-3">
          <h2 id="settlements-heading" className="text-section">
            {t('settlements.title')}
          </h2>
          <p className="text-body text-ink-2">{t('settlements.description')}</p>
          {settlements.length === 0 ? (
            <p className="text-caption text-ink-2">{t('settlements.empty')}</p>
          ) : (
            <Table
              caption={t('settlements.title')}
              rowKey={(s) => s.id}
              rows={settlements}
              columns={[
                { key: 'date', header: t('settlements.date'), cell: (s) => day.format(s.releasedAt) },
                {
                  key: 'what',
                  header: t('settlements.what'),
                  cell: (s) =>
                    t(`settlements.kind.${s.kind}`, {
                      event: (s.eventId && eventNames.get(s.eventId)) || '—',
                    }),
                },
                {
                  key: 'released',
                  header: t('settlements.released'),
                  cell: (s) => fmt(s.releasedMinor, s.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'kept',
                  header: t('settlements.kept'),
                  cell: (s) => fmt(s.reserveMinor + s.nettedMinor, s.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'amount',
                  header: t('settlements.amount'),
                  cell: (s) => fmt(s.amountMinor, s.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'status',
                  header: t('settlements.statusCol'),
                  cell: (s) => (
                    <StatusDot
                      status={SETTLEMENT_DOT[s.status]}
                      label={t(`settlements.status.${s.status}`)}
                    />
                  ),
                },
              ]}
            />
          )}
        </section>
      ) : null}
      {receivables ? (
        <section aria-labelledby="receivables-heading" className="flex flex-col gap-3">
          <h2 id="receivables-heading" className="text-section">
            {t('receivables.title')}
          </h2>
          <p className="text-body text-ink-2">{t('receivables.description')}</p>
          {receivables.outstanding.length === 0 ? (
            <p className="text-caption text-ink-2">{t('receivables.none')}</p>
          ) : (
            <ul className="flex list-none flex-col gap-2 p-0">
              {receivables.outstanding.map((o) => (
                <li key={o.currency}>
                  <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <StatusDot status="warning" label={t('receivables.owed')} />
                    <span className="font-mono tabular-nums">{fmt(o.amountMinor, o.currency)}</span>
                    <span className="text-caption text-ink-2">{t('receivables.nettedNext')}</span>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {receivables.entries.length > 0 ? (
            <Table
              caption={t('receivables.history')}
              rowKey={(e) => `${e.journalId}:${e.currency}`}
              rows={receivables.entries}
              columns={[
                { key: 'date', header: t('settlements.date'), cell: (e) => day.format(e.occurredAt) },
                {
                  key: 'what',
                  header: t('settlements.what'),
                  cell: (e) =>
                    t(`receivables.source.${e.source}`, {
                      event: (e.eventId && eventNames.get(e.eventId)) || '—',
                    }),
                },
                {
                  key: 'amount',
                  header: t('receivables.amount'),
                  cell: (e) => fmt(e.amountMinor, e.currency),
                  mono: true,
                  align: 'end',
                },
              ]}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
