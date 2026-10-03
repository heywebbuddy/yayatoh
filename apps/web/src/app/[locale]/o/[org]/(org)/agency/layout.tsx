import { buttonClass, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { refreshAgencyAction } from './actions.ts';
import { loadAgency } from './load.ts';
import { RefreshForm } from './refresh-form.tsx';
import { AgencyTabs } from './tabs.tsx';

/**
 * The agency's home (M6.7a): Clients | Events | Marketing | Reports, all read from the agency's
 * snapshots of its live clients. Refreshing recomputes them.
 */
export default async function AgencyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { data, canRead } = await loadAgency(org);
  const t = await getTranslations('agency');
  const tb = await getTranslations('billingPlan');
  if (!canRead)
    return (
      <>
        <PageHeader title={t('title')} description={t('subtitle', { agency: data.org.name })} />
        <EmptyState
          title={t('noAccessTitle')}
          description={t('noAccessDescription', { agency: data.org.name })}
          action={
            <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
              {tb('findOwner')}
            </Link>
          }
        />
      </>
    );
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle', { agency: data.org.name })}
        actions={<RefreshForm action={refreshAgencyAction.bind(null, org)} />}
      />
      <AgencyTabs base={`/o/${org}/agency`} />
      {children}
    </>
  );
}
