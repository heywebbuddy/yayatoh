import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { type PayoutDetailDto, payoutDetailQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, SectionHeader, StatusDot, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { exportHref } from '@/components/money.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('money.payout');
  return { title: t('metaTitle') };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOT = { ready: 'info', waiting_account: 'warning', transferred: 'success', failed: 'danger' } as const;

/**
 * One payout down to its orders (U5): what it released, the reserve and anything netted, then
 * every sale and refund whose organizer share made it up, with the fee on each and a link to the
 * order. The lines add up to the released amount. Finance roles only.
 */
export default async function PayoutDetailPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; settlement: string }>;
}) {
  const { locale, org, settlement } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'finance:read') || !UUID.test(settlement)) notFound();
  let p: PayoutDetailDto;
  try {
    p = await executeQuery(payoutDetailQuery, { settlementId: settlement }, data.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const t = await getTranslations('money.payout');
  const tp = await getTranslations('payouts');
  const fmt = (minor: number) => formatMoney(money(minor, p.currency), locale);
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const stamp = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const event = p.eventName || '—';
  const steps: [string, string, string][] = [
    ['released', t('released'), fmt(p.releasedMinor)],
    ...(p.reserveMinor ? [['reserve', t('reserve'), fmt(-p.reserveMinor)] as [string, string, string]] : []),
    ...(p.nettedMinor ? [['netted', t('netted'), fmt(-p.nettedMinor)] as [string, string, string]] : []),
  ];
  return (
    <>
      <PageHeader
        title={p.kind === 'reserve' ? t('titleReserve', { event }) : t('title', { event })}
        description={t('description', { date: day.format(p.releasedAt) })}
        meta={<StatusDot status={DOT[p.status]} label={tp(`settlements.status.${p.status}`)} />}
        actions={
          p.lines.length ? (
            <a
              href={exportHref(locale, org, 'payout', `id=${p.settlementId}`)}
              download
              className={buttonClass('secondary')}
            >
              {t('export')}
            </a>
          ) : null
        }
      />
      <Card className="flex flex-col gap-3">
        <SectionHeader as="h2" title={t('summary')} />
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-body">
          {steps.map(([k, label, value]) => (
            <div key={k} className="contents">
              <dt className="text-ink-2">{label}</dt>
              <dd className="m-0 text-end font-mono tabular-nums">{value}</dd>
            </div>
          ))}
          <dt className="border-t border-line pt-2 font-bold text-ink">{t('amount')}</dt>
          <dd
            className="m-0 border-t border-line pt-2 text-end font-mono font-bold tabular-nums"
            data-testid="payout-amount"
          >
            {fmt(p.amountMinor)}
          </dd>
        </dl>
        <p className="m-0 text-caption text-ink-2">
          {p.transferredAt
            ? t('paidOn', { date: day.format(p.transferredAt) })
            : t(`notYet.${p.status === 'transferred' ? 'ready' : p.status}`)}
          {p.reserveReleaseAt ? ` ${t('reserveOn', { date: day.format(p.reserveReleaseAt) })}` : ''}
        </p>
        {p.eventSlug ? (
          <Link
            href={`/o/${org}/e/${p.eventSlug}/analysis/finance`}
            className="self-start text-body font-bold text-primary-ink underline underline-offset-2"
          >
            {t('eventFinance', { event })}
          </Link>
        ) : null}
      </Card>
      <section aria-labelledby="payout-lines" className="flex flex-col gap-3">
        <SectionHeader id="payout-lines" title={t('lines')} count={p.lines.length} />
        {p.kind === 'reserve' ? (
          <EmptyState
            title={t('reserveTitle')}
            description={t('reserveExplain')}
            action={
              p.reserveOfSettlementId ? (
                <Link
                  href={`/o/${org}/payouts/${p.reserveOfSettlementId}`}
                  className={buttonClass('primary', 'md')}
                >
                  {t('toOriginal')}
                </Link>
              ) : null
            }
          />
        ) : p.lines.length === 0 ? (
          <EmptyState
            title={t('noLinesTitle')}
            description={t('noLines')}
            action={
              <Link href={`/o/${org}/payouts`} className={buttonClass('primary', 'md')}>
                {t('back')}
              </Link>
            }
          />
        ) : (
          <Table
            caption={t('lines')}
            captionHidden
            stackOnPhone
            rowKey={(l) => `${l.kind}-${l.orderId}-${l.occurredAt.getTime()}`}
            rows={p.lines}
            columns={[
              { key: 'date', header: t('date'), cell: (l) => stamp.format(l.occurredAt) },
              { key: 'type', header: t('type'), cell: (l) => t(`kind.${l.kind}`) },
              {
                key: 'order',
                header: t('order'),
                cell: (l) =>
                  p.eventSlug ? (
                    <Link
                      href={`/o/${org}/e/${p.eventSlug}/orders/${l.orderId}`}
                      className="font-mono underline underline-offset-2"
                      aria-label={t('orderLink', { ref: l.orderRef, buyer: l.buyerName })}
                    >
                      {l.orderRef}
                    </Link>
                  ) : (
                    <span className="font-mono">{l.orderRef}</span>
                  ),
              },
              { key: 'buyer', header: t('buyer'), cell: (l) => l.buyerName },
              { key: 'gross', header: t('gross'), cell: (l) => fmt(l.grossMinor), mono: true, align: 'end' },
              { key: 'fee', header: t('fee'), cell: (l) => fmt(l.feeMinor), mono: true, align: 'end' },
              {
                key: 'organizer',
                header: t('organizer'),
                cell: (l) => fmt(l.organizerMinor),
                mono: true,
                align: 'end',
              },
            ]}
          />
        )}
        {p.lines.length ? (
          <dl className="m-0 flex flex-wrap justify-end gap-x-6 gap-y-1 text-body" aria-label={t('totals')}>
            <div className="flex gap-2">
              <dt className="text-ink-2">{t('gross')}</dt>
              <dd className="m-0 font-mono tabular-nums">{fmt(p.totals.grossMinor)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-2">{t('fee')}</dt>
              <dd className="m-0 font-mono tabular-nums">{fmt(p.totals.feeMinor)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-bold text-ink">{t('organizer')}</dt>
              <dd className="m-0 font-mono font-bold tabular-nums" data-testid="payout-lines-total">
                {fmt(p.totals.organizerMinor)}
              </dd>
            </div>
          </dl>
        ) : null}
      </section>
    </>
  );
}
