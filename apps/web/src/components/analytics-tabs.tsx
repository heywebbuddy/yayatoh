import { Tabs, tabClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

export type AnalyticsSection = 'overview' | 'explore' | 'alerts' | 'reports';

/**
 * The analytics sections (M6.2b): the dashboards (M6.2a), the curated explorer, organizer alert
 * rules and scheduled reports. Composed locally from the v2 `Tabs` (no new shared component).
 * Every section needs `orders:read`, like the dashboards; each page checks its own permissions.
 */
const SECTIONS: readonly AnalyticsSection[] = ['overview', 'explore', 'alerts', 'reports'];

export async function AnalyticsTabs({ org, current }: { org: string; current: AnalyticsSection }) {
  const t = await getTranslations('analyticsPro.tabs');
  const href: Record<AnalyticsSection, string> = {
    overview: `/o/${org}/analytics`,
    explore: `/o/${org}/analytics/explore`,
    alerts: `/o/${org}/analytics/alerts`,
    reports: `/o/${org}/analytics/reports`,
  };
  return (
    <Tabs label={t('label')}>
      {SECTIONS.map((s) => (
        <Link
          key={s}
          href={href[s]}
          aria-current={s === current ? 'page' : undefined}
          className={tabClass(s === current)}
          data-testid={`analytics-tab-${s}`}
        >
          {t(s)}
        </Link>
      ))}
    </Tabs>
  );
}
