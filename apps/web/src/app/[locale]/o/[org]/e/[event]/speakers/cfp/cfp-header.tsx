import { PageHeader, StatusPill, TabCount, Tabs, tabClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Crumbs } from '@/components/crumbs.tsx';
import { Link } from '@/i18n/navigation.ts';

export type CfpTab = 'submissions' | 'reviewers' | 'settings';

/**
 * The call-for-papers pages' header (M5.3b): breadcrumb, the call's state, the public link and
 * the three sections (submissions, reviewers, settings). Composed from design-system parts only.
 */
export async function CfpHeader({
  org,
  event,
  orgName,
  eventName,
  status,
  active,
  counts,
  title,
  actions,
  crumb,
}: {
  org: string;
  event: string;
  orgName: string;
  eventName: string;
  status: 'draft' | 'open' | 'closed';
  active: CfpTab | null;
  counts: { submissions: number; reviewers: number };
  title?: string;
  actions?: ReactNode;
  crumb?: string;
}) {
  const t = await getTranslations('cfp');
  const tn = await getTranslations('nav');
  const base = `/o/${org}/e/${event}/speakers/cfp`;
  const tabs: { key: CfpTab; href: string; count?: number }[] = [
    { key: 'submissions', href: base, count: counts.submissions },
    { key: 'reviewers', href: `${base}/reviewers`, count: counts.reviewers },
    { key: 'settings', href: `${base}/settings` },
  ];
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: orgName, href: `/o/${org}` },
              { label: eventName, href: `/o/${org}/e/${event}` },
              { label: tn('speakers'), href: `/o/${org}/e/${event}/speakers` },
              ...(crumb ? [{ label: t('title'), href: base }, { label: crumb }] : [{ label: t('title') }]),
            ]}
          />
        }
        title={title ?? t('title')}
        tag={
          <StatusPill
            tone={status === 'open' ? 'success' : status === 'closed' ? 'neutral' : 'waiting'}
            label={t(`status.${status}`)}
          />
        }
        description={title ? undefined : t('subtitle')}
        actions={actions}
      />
      {active ? (
        <Tabs label={t('sectionsLabel')}>
          {tabs.map((x) => (
            <Link
              key={x.key}
              href={x.href}
              aria-current={active === x.key ? 'page' : undefined}
              className={tabClass(active === x.key)}
            >
              {t(`tabs.${x.key}`)}
              {x.count !== undefined ? <TabCount active={active === x.key}>{x.count}</TabCount> : null}
            </Link>
          ))}
        </Tabs>
      ) : null}
    </>
  );
}

export const scoreText = (score: number | null) => (score === null ? '—' : score.toFixed(1));
