import { APPLICATION_STATUSES, type ApplicationStatus } from '@yayatoh/applications';
import { Button, Card, Input, PageHeader, StatusDot } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { type ApplicationFilter, listApplications } from '@/server/applications.ts';
import { requireStaff } from '@/server/staff.ts';

const DOT = {
  new: 'info',
  in_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  needs_info: 'warning',
} as const;

/** The organizer applications queue: filter by status, assignee or a search; newest first. */
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; assignee?: string; q?: string }>;
}) {
  const staff = await requireStaff('applications');
  const sp = await searchParams;
  const t = await getTranslations('applications');
  const status = APPLICATION_STATUSES.find((s) => s === sp.status);
  const filter: ApplicationFilter = { status, assignee: sp.assignee || undefined, q: sp.q || undefined };
  const { rows, counts } = await listApplications(staff, filter);
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
  const tab = (key: ApplicationStatus | 'all') => ({
    href: key === 'all' ? '/applications' : `/applications?status=${key}`,
    label: `${t(`status.${key}`)} (${counts[key]})`,
    current: (key === 'all' ? undefined : key) === status,
  });
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <nav aria-label={t('filters')} className="flex flex-wrap gap-2">
        {(['all', ...APPLICATION_STATUSES] as const).map((k) => {
          const x = tab(k);
          return (
            <Link
              key={k}
              href={x.href}
              aria-current={x.current ? 'page' : undefined}
              className="inline-flex min-h-10 items-center rounded-pill border border-line px-4 text-body aria-[current=page]:bg-surface-3 aria-[current=page]:font-bold"
            >
              {x.label}
            </Link>
          );
        })}
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <Input name="q" defaultValue={sp.q ?? ''} label={t('search')} maxLength={100} />
        <Button type="submit" variant="secondary">
          {t('searchButton')}
        </Button>
      </form>
      <Card className="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-body text-ink-2">{t('empty')}</p>
        ) : (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable)
          <section className="overflow-x-auto" tabIndex={0} aria-label={t('list')}>
            <table className="w-full text-start text-body">
              <caption className="sr-only">{t('list')}</caption>
              <thead className="text-caption text-ink-2">
                <tr>
                  {(['org', 'kind', 'status', 'plan', 'assignee', 'received'] as const).map((c) => (
                    <th key={c} scope="col" className="px-4 py-2 text-start font-normal">
                      {t(`col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2">
                      <Link href={`/applications/${r.id}`} className="font-bold underline underline-offset-2">
                        {r.orgName}
                      </Link>
                      <span className="block text-caption text-ink-2">
                        {r.contactName} · {r.country}
                      </span>
                    </td>
                    <td className="px-4 py-2">{t(`kind.${r.kind}`)}</td>
                    <td className="px-4 py-2">
                      <StatusDot status={DOT[r.status]} label={t(`status.${r.status}`)} />
                    </td>
                    <td className="px-4 py-2">{t(`plan.${r.planInterest}`)}</td>
                    <td className="px-4 py-2">{r.assigneeName ?? t('unassigned')}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{date.format(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </Card>
    </Shell>
  );
}
