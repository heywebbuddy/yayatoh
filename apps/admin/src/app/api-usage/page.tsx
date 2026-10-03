import { Card, PageHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { requireStaff } from '@/server/staff.ts';
import { apiUsage } from '@/server/tenants.ts';

/** /v1 traffic by route × client × app version (M1.15): who still calls what, from which app build. */
export default async function ApiUsagePage() {
  const staff = await requireStaff();
  const t = await getTranslations('apiUsage');
  const rows = await apiUsage(staff);
  const clients = [...new Set(rows.map((r) => `${r.client} ${r.appVersion}`))];
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <p className="text-body text-ink-2">{t('summary', { versions: clients.length })}</p>
      <Card className="p-0">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable) */}
        <section className="overflow-x-auto" tabIndex={0} aria-label={t('title')}>
          <table className="w-full text-start text-caption">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="text-ink-2">
              <tr>
                {(['route', 'client', 'version', 'requests', 'lastDay'] as const).map((k) => (
                  <th
                    key={k}
                    scope="col"
                    className={`px-4 py-2 font-normal ${k === 'requests' ? 'text-end' : 'text-start'}`}
                  >
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-2">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={`${r.method} ${r.route} ${r.client} ${r.appVersion}`}
                    className="border-t border-line"
                  >
                    <td className="px-4 py-1.5 font-mono">
                      {r.method} {r.route}
                    </td>
                    <td className="px-4 py-1.5">{r.client}</td>
                    <td className="px-4 py-1.5 font-mono">{r.appVersion}</td>
                    <td className="px-4 py-1.5 text-end font-mono tabular-nums">{r.requests}</td>
                    <td className="px-4 py-1.5 font-mono whitespace-nowrap">{r.lastDay}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </Card>
    </Shell>
  );
}
