import type { FinanceReportDto } from '@yayatoh/reports';
import { Card } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { fmtMoney } from './reports.tsx';

const LINES = [
  { key: 'sales.gross', sign: '' },
  { key: 'sales.refunds', sign: '−' },
  { key: 'finance.disputesLost', sign: '−' },
  { key: 'finance.platformFees', sign: '−' },
  { key: 'finance.net', sign: '=' },
] as const;

/** Gross → net, one column per currency (currencies are never added together). */
export async function FinanceWaterfall({ report, locale }: { report: FinanceReportDto; locale: string }) {
  const t = await getTranslations('reports');
  const value = (key: string, currency: string) =>
    report.metrics.find((m) => m.key === key && m.currency === currency)?.value ?? 0;
  return (
    <Card size="panel" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-section">{t('finance.title')}</h2>
        <p className="max-w-prose text-body text-zinc-600">{t('finance.description')}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{t('finance.caption')}</caption>
          <thead>
            <tr className="border-b border-zinc-200">
              <th
                scope="col"
                className="px-3 py-2 text-start font-mono text-label font-normal uppercase text-zinc-500"
              >
                {t('finance.line')}
              </th>
              {report.currencies.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="px-3 py-2 text-end font-mono text-label font-normal uppercase text-zinc-500"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LINES.map((l) => (
              <tr
                key={l.key}
                className={
                  l.key === 'finance.net'
                    ? 'border-t-2 border-zinc-900 font-medium'
                    : 'border-b border-zinc-100'
                }
              >
                <th scope="row" className="px-3 py-2.5 text-start font-normal">
                  <span aria-hidden="true" className="inline-block w-4 text-zinc-500">
                    {l.sign}
                  </span>
                  {t(`metric.${l.key}`)}
                </th>
                {report.currencies.map((c) => (
                  <td key={c} className="px-3 py-2.5 text-end font-mono tabular-nums">
                    {fmtMoney(value(l.key, c), c, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
