import { PageHeader, Table } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { charitiesForReview } from '@/server/charities.ts';
import { requireStaff } from '@/server/staff.ts';

export async function generateMetadata() {
  const t = await getTranslations('charities');
  return { title: t('title') };
}

/**
 * Charity profiles to verify (M4.8b, P4-11): waiting first, oldest first; "Reviewed" lists the
 * latest verdicts. Each row opens the review against the IRS exempt-organization list.
 */
export default async function CharitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const staff = await requireStaff('charities');
  const { status: raw } = await searchParams;
  const status = raw === 'reviewed' ? 'reviewed' : 'pending';
  const t = await getTranslations('charities');
  const rows = await charitiesForReview(staff, status);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <nav aria-label={t('filter')} className="flex gap-4 text-body">
        <Link
          href="/charities"
          aria-current={status === 'pending' ? 'page' : undefined}
          className="inline-flex min-h-6 items-center underline-offset-2 hover:underline aria-[current=page]:font-semibold"
        >
          {t('pending')}
        </Link>
        <Link
          href="/charities?status=reviewed"
          aria-current={status === 'reviewed' ? 'page' : undefined}
          className="inline-flex min-h-6 items-center underline-offset-2 hover:underline aria-[current=page]:font-semibold"
        >
          {t('reviewed')}
        </Link>
      </nav>
      <Table
        caption={status === 'pending' ? t('pendingCaption') : t('reviewedCaption')}
        rowKey={(r) => r.orgId}
        rows={rows}
        empty={status === 'pending' ? t('emptyPending') : t('emptyReviewed')}
        columns={[
          {
            key: 'org',
            header: t('org'),
            cell: (r) => (
              <Link href={`/charities/${r.orgId}`} className="underline underline-offset-2">
                {r.orgName} ({r.orgSlug})
              </Link>
            ),
          },
          { key: 'legal', header: t('legalName'), cell: (r) => r.legalName },
          { key: 'ein', header: t('ein'), mono: true, cell: (r) => r.sponsorEin ?? r.ein },
          { key: 'kind', header: t('kind'), cell: (r) => t(`kinds.${r.exemptKind}`) },
          { key: 'status', header: t('status'), cell: (r) => t(`statuses.${r.status}`) },
          {
            key: 'at',
            header: status === 'pending' ? t('submitted') : t('reviewedAt'),
            cell: (r) =>
              `${when.format(status === 'pending' ? r.submittedAt : (r.reviewedAt ?? r.submittedAt))} UTC`,
          },
        ]}
      />
    </Shell>
  );
}
