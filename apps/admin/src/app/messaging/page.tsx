import { PageHeader, Table } from '@yayatoh/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { autoPausedOrgs } from '@/server/messaging-policy.ts';
import { requireStaff } from '@/server/staff.ts';

export async function generateMetadata() {
  const t = await getTranslations('messagingPolicy');
  return { title: t('title') };
}

/** Auto-paused orgs (M3.5a): complaint rate over 0.3 %; each links to its messaging page. */
export default async function AutoPausedPage() {
  const staff = await requireStaff('messaging');
  const t = await getTranslations('messagingPolicy');
  const rows = await autoPausedOrgs(staff);
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const pct = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 });
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <Table
        caption={t('title')}
        rowKey={(r) => r.orgId}
        rows={rows}
        empty={t('empty')}
        columns={[
          {
            key: 'org',
            header: t('org'),
            cell: (r) => (
              <Link href={`/tenants/${r.orgId}/messaging`} className="underline underline-offset-2">
                {r.orgName} ({r.orgSlug})
              </Link>
            ),
          },
          { key: 'since', header: t('since'), cell: (r) => `${when.format(r.since)} UTC` },
          {
            key: 'rate',
            header: t('rate'),
            cell: (r) =>
              t('rateValue', {
                rate: pct.format(r.rateBps / 10_000),
                complaints: r.complaints,
                sent: r.sent,
              }),
          },
        ]}
      />
    </Shell>
  );
}
