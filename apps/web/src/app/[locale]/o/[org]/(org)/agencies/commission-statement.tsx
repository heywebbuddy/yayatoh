import { formatMoney, money } from '@yayatoh/kernel';
import type { CommissionStatementDto } from '@yayatoh/payments';
import { SectionHeader, StatCard, Table } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { formatDate } from '@/lib/format.ts';

/**
 * M6.8a: a commission statement (the client's or the agency's), read from ledger entries only.
 * `names` labels the other side (agencies for a client, clients for an agency).
 */
export async function CommissionStatement({
  statement,
  names,
  side,
  locale,
  timeZone,
}: {
  statement: CommissionStatementDto;
  names: ReadonlyMap<string, string>;
  side: 'client' | 'agency';
  locale: string;
  timeZone: string;
}) {
  const t = await getTranslations('agencyBilling');
  const m = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const counterparty = (id: string | null) =>
    (id ? names.get(id) : undefined) ?? t(side === 'client' ? 'unknownAgency' : 'unknownClient');
  return (
    <section aria-labelledby={`statement-${side}`} className="flex flex-col gap-4">
      <SectionHeader id={`statement-${side}`} title={t('statementTitle')} description={t('statementIntro')} />
      {statement.totals.map((tot) => (
        <div key={tot.currency} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            testId={`commission-earned-${tot.currency}`}
            label={t('totalEarned')}
            value={m(tot.earnedMinor, tot.currency)}
          />
          <StatCard
            testId={`commission-pending-${tot.currency}`}
            label={t('totalPending')}
            value={m(tot.pendingMinor, tot.currency)}
          />
          <StatCard
            testId={`commission-paid-${tot.currency}`}
            label={t('totalPaid')}
            value={m(tot.paidMinor, tot.currency)}
          />
          <StatCard
            testId={`commission-owed-${tot.currency}`}
            label={t('totalOwed')}
            value={m(tot.owedMinor, tot.currency)}
          />
        </div>
      ))}
      <Table
        caption={t('entriesCaption')}
        rowKey={(e) => `${e.journalId}:${e.kind}`}
        rows={statement.entries}
        empty={t(side === 'client' ? 'statementEmptyClient' : 'statementEmptyAgency')}
        columns={[
          {
            key: 'date',
            header: t('dateColumn'),
            mono: true,
            cell: (e) =>
              formatDate(
                e.occurredAt.toISOString(),
                { locale, currency: e.currency, timeZone },
                { year: 'numeric', month: 'short', day: 'numeric' },
              ),
          },
          { key: 'entry', header: t('entryColumn'), cell: (e) => t(`kind.${e.kind}`) },
          {
            key: 'who',
            header: t(side === 'client' ? 'agencyColumn' : 'clientColumn'),
            cell: (e) => counterparty(e.counterpartyOrgId),
          },
          {
            key: 'amount',
            header: t('amountColumn'),
            align: 'end',
            mono: true,
            cell: (e) => m(e.amountMinor, e.currency),
          },
        ]}
      />
    </section>
  );
}
