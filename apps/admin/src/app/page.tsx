import { buttonClass, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { requireStaff } from '@/server/staff.ts';
import { listTenants } from '@/server/tenants.ts';

const PAYOUT_DOT = { none: 'neutral', pending: 'info', restricted: 'warning', active: 'success' } as const;

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requireStaff();
  const { q = '' } = await searchParams;
  const t = await getTranslations('tenants');
  const rows = await listTenants(staff, q.slice(0, 100));
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <search>
        <form className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-caption text-zinc-600">
              {t('search')}
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q}
              className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
            />
          </div>
          <button type="submit" className={buttonClass('primary')}>
            {t('searchButton')}
          </button>
        </form>
      </search>
      <Card className="p-0">
        {/* Scrollable on narrow screens: focusable and named so keyboard users can scroll it. */}
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable) */}
        <section className="overflow-x-auto" tabIndex={0} aria-label={t('title')}>
          <table className="w-full text-start text-body">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="text-caption text-zinc-500">
              <tr>
                {(['name', 'status', 'members', 'payouts', 'paused', 'created'] as const).map((c) => (
                  <th key={c} scope="col" className="px-4 py-2 text-start font-normal">
                    {t(`col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2">
                    <Link href={`/tenants/${r.id}`} className="underline underline-offset-2">
                      {r.name}
                    </Link>
                    <span className="block font-mono text-caption text-zinc-500">{r.slug}</span>
                  </td>
                  <td className="px-4 py-2">{t(`status.${r.status}`)}</td>
                  <td className="px-4 py-2 tabular-nums">{r.members}</td>
                  <td className="px-4 py-2">
                    <StatusDot status={PAYOUT_DOT[r.payoutState]} label={t(`payout.${r.payoutState}`)} />
                    {r.payoutsHeld ? (
                      <span className="block text-caption text-accent-text">{t('held')}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-caption">
                    {r.paused.length ? r.paused.map((k) => t(`pause.${k}`)).join(', ') : '—'}
                  </td>
                  <td className="px-4 py-2 text-caption text-zinc-600">{date.format(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {rows.length === 0 ? <p className="px-4 py-6 text-body text-zinc-600">{t('empty')}</p> : null}
      </Card>
    </Shell>
  );
}
