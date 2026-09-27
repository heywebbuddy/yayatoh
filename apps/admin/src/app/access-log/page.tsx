import { Card, PageHeader } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { requireStaff } from '@/server/staff.ts';
import { recentAccess } from '@/server/tenants.ts';

/** Every cross-tenant (platform_reader) read, newest first. */
export default async function AccessLogPage() {
  const staff = await requireStaff();
  const t = await getTranslations('accessLog');
  const rows = await recentAccess(staff);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' });
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <Card className="p-0">
        {/* Scrollable on narrow screens: focusable and named so keyboard users can scroll it. */}
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable) */}
        <section className="overflow-x-auto" tabIndex={0} aria-label={t('title')}>
          <table className="w-full text-start text-caption">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="text-zinc-500">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-normal">
                  {t('at')}
                </th>
                <th scope="col" className="px-4 py-2 text-start font-normal">
                  {t('actor')}
                </th>
                <th scope="col" className="px-4 py-2 text-start font-normal">
                  {t('reason')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.at.toISOString()}-${i}`} className="border-t border-zinc-100">
                  <td className="px-4 py-1.5 whitespace-nowrap">{when.format(r.at)}</td>
                  <td className="px-4 py-1.5 font-mono">{r.actor}</td>
                  <td className="px-4 py-1.5">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </Card>
    </Shell>
  );
}
