import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { payoutAccountQuery } from '@yayatoh/payments';
import { payoutsDashboardQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import {
  Button,
  buttonClass,
  Card,
  EmptyState,
  PageHeader,
  SectionHeader,
  StatCard,
  StatusDot,
  StatusPill,
  Table,
  Timeline,
} from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HowItWorks } from '@/components/how-it-works.tsx';
import { exportHref, MoneyTabs } from '@/components/money.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { startPayoutOnboarding } from './actions.ts';

const DOT = { none: 'neutral', pending: 'info', restricted: 'warning', active: 'success' } as const;
const SETTLEMENT_DOT = {
  ready: 'info',
  waiting_account: 'warning',
  transferred: 'success',
  failed: 'danger',
} as const;
const PILL = {
  held: 'neutral',
  ready: 'info',
  waiting_account: 'waiting',
  failed: 'danger',
  transferred: 'success',
} as const;

/**
 * Payouts (M1.3c, U5): connect the organization's payout account with the payment provider, then
 * see the money as numbers and dates (UX review 1 principle 5): the next payout, funds held per
 * event with their release date, reserves and when they come back, receivables, and every
 * settlement with a drill-down to its orders. Until the account is fully enabled, orders are
 * charged by the platform and paid out after the event (platform_mor); once active, buyers pay
 * the organizer directly (organizer_mor). Money figures need `finance:read`.
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
  const tm = await getTranslations('money');
  const account = await executeQuery(payoutAccountQuery, {}, data.ctx, ports);
  const canManage = roleCan(data.role, 'payouts:manage');
  const canSeeMoney = roleCan(data.role, 'finance:read');
  const d = canSeeMoney ? await executeQuery(payoutsDashboardQuery, {}, data.ctx, ports) : null;
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const sumBy = (rows: readonly { currency: string; v: number }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? 0) + r.v);
    return [...m.entries()].filter(([, v]) => v !== 0);
  };
  const moneyLines = (rows: [string, number][]) =>
    rows.length ? rows.map(([c, v]) => fmt(v, c)).join(' · ') : fmt(0, data.org.currency);
  // The timeline: held funds by release date, settlements on their way, reserves coming back.
  const upcoming = d
    ? [
        ...d.pending.map((p) => ({
          id: `s-${p.settlementId}`,
          at: p.releasedAt,
          title: (
            <Link href={`/o/${org}/payouts/${p.settlementId}`} className="underline underline-offset-2">
              {tm(p.kind === 'reserve' ? 'payouts.reserveOf' : 'payouts.payoutOf', {
                event: p.eventName || '—',
                amount: fmt(p.amountMinor, p.currency),
              })}
            </Link>
          ),
          status: p.status,
          tone: p.status === 'failed' ? ('danger' as const) : ('primary' as const),
        })),
        ...d.held.map((h) => ({
          id: `h-${h.eventId}-${h.currency}`,
          at: h.releaseAt,
          title: tm('payouts.expected', {
            event: h.eventName || '—',
            amount: fmt(h.expectedMinor, h.currency),
          }),
          detail: tm('payouts.heldDetail', {
            held: fmt(h.heldMinor, h.currency),
            reserve: fmt(h.reserveMinor, h.currency),
          }),
          status: 'held' as const,
          tone: 'neutral' as const,
        })),
        ...d.reserves.map((r) => ({
          id: `r-${r.settlementId}`,
          at: r.releaseAt,
          title: tm('payouts.reserveBack', {
            event: r.eventName || '—',
            amount: fmt(r.leftMinor, r.currency),
          }),
          detail: tm('payouts.reserveDetail', { kept: fmt(r.reserveMinor, r.currency) }),
          status: 'held' as const,
          tone: 'neutral' as const,
        })),
      ].sort((a, b) => a.at.getTime() - b.at.getTime())
    : [];
  const next = d?.held[0] ?? null;
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          d && (d.past.length || d.pending.length || d.held.length) ? (
            <a href={exportHref(locale, org, 'payouts', '')} download className={buttonClass('secondary')}>
              {tm('export')}
            </a>
          ) : null
        }
      />
      <MoneyTabs org={org} role={data.role} current="payouts" />
      <HowItWorks topic="payouts" />
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
      {d ? (
        <section
          aria-label={tm('payouts.summary')}
          className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
        >
          <StatCard
            label={tm('payouts.next')}
            value={next ? fmt(next.expectedMinor, next.currency) : '—'}
            sub={
              next
                ? tm('payouts.nextOn', { date: day.format(next.releaseAt), event: next.eventName || '—' })
                : tm('payouts.nothingScheduled')
            }
            testId="payouts-next"
          />
          <StatCard
            label={tm('payouts.held')}
            value={moneyLines(sumBy(d.held.map((h) => ({ currency: h.currency, v: h.heldMinor }))))}
            sub={tm('payouts.heldSub', { count: d.held.length })}
          />
          <StatCard
            label={tm('payouts.inReserve')}
            value={moneyLines(sumBy(d.reserves.map((r) => ({ currency: r.currency, v: r.leftMinor }))))}
            sub={
              d.reserves[0]
                ? tm('payouts.reserveNext', { date: day.format(d.reserves[0].releaseAt) })
                : tm('payouts.noReserve')
            }
          />
          <StatCard
            label={tm('payouts.owed')}
            value={moneyLines(d.receivables.map((r) => [r.currency, r.amountMinor] as [string, number]))}
            sub={tm('payouts.owedSub')}
          />
        </section>
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
      {d ? (
        <section aria-labelledby="upcoming-heading" className="flex flex-col gap-3">
          <SectionHeader id="upcoming-heading" title={tm('payouts.upcoming')} count={upcoming.length} />
          {upcoming.length === 0 ? (
            <EmptyState
              title={tm('payouts.upcomingEmptyTitle')}
              description={tm('payouts.upcomingEmpty')}
              action={
                <Link href={`/o/${org}/money`} className={buttonClass('primary', 'md')}>
                  {tm('payouts.toOverview')}
                </Link>
              }
            />
          ) : (
            <Card>
              <Timeline
                label={tm('payouts.upcoming')}
                items={upcoming.map((u) => ({
                  id: u.id,
                  tone: u.tone,
                  time: day.format(u.at),
                  title: u.title,
                  detail: (
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={PILL[u.status]} label={tm(`payouts.status.${u.status}`)} />
                      {'detail' in u && u.detail ? <span>{u.detail}</span> : null}
                    </span>
                  ),
                }))}
              />
            </Card>
          )}
        </section>
      ) : null}
      {d ? (
        <section aria-labelledby="settlements-heading" className="flex flex-col gap-3">
          <SectionHeader
            id="settlements-heading"
            title={t('settlements.title')}
            count={d.past.length + d.pending.length}
          />
          {d.past.length + d.pending.length === 0 ? (
            <p className="text-body text-ink-2">{t('settlements.empty')}</p>
          ) : (
            <Table
              caption={t('settlements.title')}
              captionHidden
              rowKey={(s) => s.settlementId}
              rows={[
                ...d.pending.map((p) => ({
                  ...p,
                  releasedMinor: null,
                  reserveMinor: null,
                  nettedMinor: null,
                  transferredAt: null,
                })),
                ...d.past.map((p) => ({ ...p, status: 'transferred' as const })),
              ].sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime())}
              columns={[
                {
                  key: 'date',
                  header: t('settlements.date'),
                  cell: (s) => day.format(s.transferredAt ?? s.releasedAt),
                },
                {
                  key: 'what',
                  header: t('settlements.what'),
                  cell: (s) => (
                    <Link
                      href={`/o/${org}/payouts/${s.settlementId}`}
                      className="underline underline-offset-2"
                    >
                      {t(`settlements.kind.${s.kind}`, { event: s.eventName || '—' })}
                    </Link>
                  ),
                },
                {
                  key: 'released',
                  header: t('settlements.released'),
                  cell: (s) => (s.releasedMinor === null ? '—' : fmt(s.releasedMinor, s.currency)),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'kept',
                  header: t('settlements.kept'),
                  cell: (s) =>
                    s.reserveMinor === null ? '—' : fmt(s.reserveMinor + (s.nettedMinor ?? 0), s.currency),
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
      {d ? (
        <section aria-labelledby="receivables-heading" className="flex flex-col gap-3">
          <SectionHeader id="receivables-heading" title={t('receivables.title')} />
          {d.receivables.length === 0 ? (
            <p className="text-body text-ink-2">{t('receivables.none')}</p>
          ) : (
            <ul className="flex list-none flex-col gap-2 p-0">
              {d.receivables.map((o) => (
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
          {d.receivableEntries.length > 0 ? (
            <Table
              caption={t('receivables.history')}
              rowKey={(e) => `${e.journalId}:${e.currency}`}
              rows={d.receivableEntries}
              columns={[
                { key: 'date', header: t('settlements.date'), cell: (e) => day.format(e.occurredAt) },
                {
                  key: 'what',
                  header: t('settlements.what'),
                  cell: (e) => t(`receivables.source.${e.source}`, { event: e.eventName || '—' }),
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
      {d ? <HowItWorks topic="payoutRules" /> : null}
    </>
  );
}
