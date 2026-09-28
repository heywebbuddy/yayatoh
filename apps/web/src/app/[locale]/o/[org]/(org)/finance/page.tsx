import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { reconciliationItemsQuery, reconciliationRunsQuery } from '@yayatoh/payments';
import { roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ResolveItemForm } from '@/components/resolve-item-form.tsx';
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
      <section aria-labelledby="runs-heading" className="flex flex-col gap-3">
        <h2 id="runs-heading" className="text-section">
          {t('runsTitle')}
        </h2>
        {runs.length === 0 ? (
          <p className="text-body text-zinc-600">{t('noRuns')}</p>
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
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {open.map((i) => (
              <li key={i.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <StatusDot status="warning" label={t(`kind.${i.kind}`)} />
                    <span className="text-caption text-zinc-600">{day(i.day)}</span>
                    <span className="break-all font-mono text-caption">{i.reference}</span>
                  </div>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <dt className="text-caption text-zinc-600">{t('ledger')}</dt>
                      <dd className="font-mono tabular-nums">{fmt(i.ledgerMinor, i.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-zinc-600">{t('provider')}</dt>
                      <dd className="font-mono tabular-nums">{fmt(i.providerMinor, i.currency)}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-zinc-600">{t('difference')}</dt>
                      <dd className="font-mono tabular-nums">{fmt(i.differenceMinor, i.currency)}</dd>
                    </div>
                  </dl>
                  {canResolve ? (
                    <ResolveItemForm
                      action={resolveReconciliationAction.bind(null, org, i.id)}
                      reference={i.reference}
                    />
                  ) : (
                    <p className="text-caption text-zinc-600">{t('noResolveAccess')}</p>
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
