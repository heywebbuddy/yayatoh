'use client';

import { Tabs, tabClass } from '@yayatoh/ui';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';

const TABS = [
  { key: 'clients', path: '' },
  { key: 'events', path: '/events' },
  { key: 'marketing', path: '/marketing' },
  { key: 'reports', path: '/reports' },
] as const;

/**
 * Agency v2, shown while the platform switch `agency_v2` is on: M6.8a's billing and commission
 * statement, M6.8b's operations.
 */
const V2_TABS = [
  { key: 'billing', path: '/billing' },
  { key: 'library', path: '/library' },
  { key: 'campaigns', path: '/campaigns' },
  { key: 'team', path: '/team' },
] as const;

/** Clients | Events | Marketing | Reports (vision §12). */
export function AgencyTabs({ base, v2 = false }: { base: string; v2?: boolean }) {
  const t = useTranslations('agency');
  const pathname = usePathname();
  return (
    <Tabs label={t('tabs')}>
      {[...TABS, ...(v2 ? V2_TABS : [])].map((tab) => {
        const active = tab.path ? pathname.endsWith(`/agency${tab.path}`) : pathname.endsWith('/agency');
        return (
          <Link
            key={tab.key}
            href={`${base}${tab.path}`}
            aria-current={active ? 'page' : undefined}
            className={tabClass(active)}
          >
            {t(`tab.${tab.key}`)}
          </Link>
        );
      })}
    </Tabs>
  );
}
