import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { creditNotesQuery, creditNoteTotalsQuery } from '@yayatoh/orders';
import { reconciliationItemsQuery, reconciliationRunsQuery } from '@yayatoh/payments';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResolveItemForm } from '@/components/resolve-item-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { resolveReconciliationAction } from './actions.ts';

/**
 * Finance → reconciliation (M1.6e): each day the ledger's platform cash is compared with what
 * the payment provider moved. Differences are listed for finance to check and resolve with a
 * note. Owners, admins and finance only.
 */
export default async function FinancePage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!roleCan(data.role, 'finance:read')) notFound();
  const t = await getTranslations('finance');
  const canResolve = roleCan(data.role, 'finance:reconcile');
  const [runs, items] = await Promise.all([
    executeQuery(reconciliationRunsQuery, {}, data.ctx, ports),
    executeQuery(reconciliationItemsQuery, {}, data.ctx, ports),
  ]);
  // M3.10c: credit notes (issued, as store credit, recorded refunded, spent, left) and the latest.
  const ts = await getTranslations('supportTools.credit');
  const creditTotals = data.modules.has('ticketing')
    ? await executeQuery(creditNoteTotalsQuery, {}, data.ctx, ports)
    : [];
  const recentCredits = creditTotals.length
    ? await executeQuery(creditNotesQuery, { limit: 20 }, data.ctx, ports)
    : [];
  const open = items.filter((i) => i.status === 'open');
  const resolved = items.filter((i) => i.status === 'resolved');
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  // Days are UTC calendar days (the provider's), shown as dates.
  const day = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${d}T00:00:00Z`),
    );
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <section aria-labelledby="credit-notes-heading" className="flex flex-col gap-3">
        <h2 id="credit-notes-heading" className="text-section">
          {ts('financeTitle')}
        </h2>
        {creditTotals.length === 0 ? (
          <p className="text-body text-ink-2">{ts('financeEmpty')}</p>
        ) : (
          <>
            <Table
              caption={ts('financeTotals')}
              rowKey={(r) => r.currency}
              rows={creditTotals}
              columns={[
                { key: 'currency', header: ts('currency'), cell: (r) => r.currency, mono: true },
                { key: 'count', header: ts('count'), cell: (r) => r.count, mono: true, align: 'end' },
                {
                  key: 'issued',
                  header: ts('issuedTotal'),
                  cell: (r) => fmt(r.issuedMinor, r.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'store',
                  header: ts('disposition.store_credit'),
                  cell: (r) => fmt(r.storeCreditMinor, r.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'refunded',
                  header: ts('disposition.refunded'),
                  cell: (r) => fmt(r.refundedMinor, r.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'applied',
                  header: ts('applied'),
                  cell: (r) => fmt(r.appliedMinor, r.currency),
                  mono: true,
                  align: 'end',
                },
                {
                  key: 'outstanding',
                  header: ts('outstanding'),
                  cell: (r) => fmt(r.outstandingMinor, r.currency),
                  mono: true,
                  align: 'end',
                },
              ]}
            />
            <Table
              caption={ts('financeRecent')}
              rowKey={(c) => c.id}
              rows={recentCredits}
              columns={[
                { key: 'number', header: ts('number'), cell: (c) => c.label, mono: true },
                {
                  key: 'when',
                  header: ts('issuedOn'),
                  cell: (c) =>
                    new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeZone: data.org.timezone,
                    }).format(c.createdAt),
                },
                { key: 'buyer', header: ts('buyer'), cell: (c) => c.buyerName },
                {
                  key: 'disposition',
                  header: ts('dispositionCol'),
                  cell: (c) => ts(`disposition.${c.disposition}`),
                },
                {
                  key: 'amount',
                  header: ts('amountCol'),
                  cell: (c) => fmt(c.amountMinor, c.currency),
                  mono: true,
                  align: 'end',
                },
              ]}
            />
          </>
        )}
      </section>
      <section aria-labelledby="runs-heading" className="flex flex-col gap-3">
        <h2 id="runs-heading" className="text-section">
          {t('runsTitle')}
        </h2>
        {runs.length === 0 ? (
          <p className="text-body text-ink-2">{t('noRuns')}</p>
        ) : (
          <Table
            caption={t('runsTitle')}
            rowKey={(r) => r.runId}
            rows={runs}
            columns={[
              { key: 'day', header: t('day'), cell: (r) => day(r.day) },
              {
                key: 'ledger',
                header: t('ledgerCount'),
                cell: (r) => r.ledgerCount,
                mono: true,
                align: 'end',
              },
              {
                key: 'provider',
                header: t('providerCount'),
                cell: (r) => r.providerCount,
                mono: true,
                align: 'end',
              },
              {
                key: 'result',
                header: t('result'),
                cell: (r) => (
                  <StatusDot
                    status={r.itemCount === 0 ? 'success' : 'warning'}
                    label={r.itemCount === 0 ? t('matched') : t('differences', { n: r.itemCount })}
                  />
                ),
              },
            ]}
          />
        )}
      </section>

      <section aria-labelledby="open-heading" className="flex flex-col gap-3">
        <h2 id="open-heading" className="text-section">
          {t('openTitle')}
        </h2>
        {open.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Link href="#runs-heading" className={buttonClass('secondary', 'md')}>
                {t('emptyAction')}
              </Link>
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {open.map((i) => (
              <li key={i.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <StatusDot status="warning" label={t(`kind.${i.kind}`)} />
                    <span className="text-caption text-ink-2">{day(i.day)}</span>
                    <span className="break-all font-mono text-caption">{i.reference}</span>
                  </div>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <dt className="text-caption text-ink-2">{t('ledger')}</dt>
                      <dd className="font-mono tabular-nums">{fmt(i.ledgerMinor, i.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-ink-2">{t('provider')}</dt>
                      <dd className="font-mono tabular-nums">{fmt(i.providerMinor, i.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-ink-2">{t('difference')}</dt>
                      <dd className="font-mono tabular-nums">{fmt(i.differenceMinor, i.currency)}</dd>
                    </div>
                  </dl>
                  {canResolve ? (
                    <ResolveItemForm
                      action={resolveReconciliationAction.bind(null, org, i.id)}
                      reference={i.reference}
                    />
                  ) : (
                    <p className="text-caption text-ink-2">{t('noResolveAccess')}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolved.length > 0 ? (
        <section aria-labelledby="resolved-heading" className="flex flex-col gap-3">
          <h2 id="resolved-heading" className="text-section">
            {t('resolvedTitle')}
          </h2>
          <Table
            caption={t('resolvedTitle')}
            rowKey={(i) => i.id}
            rows={resolved}
            columns={[
              { key: 'day', header: t('day'), cell: (i) => day(i.day) },
              { key: 'kind', header: t('what'), cell: (i) => t(`kind.${i.kind}`) },
              {
                key: 'ref',
                header: t('reference'),
                cell: (i) => <span className="break-all">{i.reference}</span>,
                mono: true,
              },
              {
                key: 'diff',
                header: t('difference'),
                cell: (i) => fmt(i.differenceMinor, i.currency),
                mono: true,
                align: 'end',
              },
              { key: 'note', header: t('note'), cell: (i) => i.resolutionNote ?? '' },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
