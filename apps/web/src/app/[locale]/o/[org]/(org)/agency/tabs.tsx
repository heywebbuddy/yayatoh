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
  // M6.8a (flag `agency_v2`): agency billing and the commission statement.
  { key: 'billing', path: '/billing' },
] as const;

/** Clients | Events | Marketing | Reports (vision §12). */
export function AgencyTabs({ base, billing = false }: { base: string; billing?: boolean }) {
  const t = useTranslations('agency');
  const pathname = usePathname();
  return (
    <Tabs label={t('tabs')}>
      {TABS.filter((tab) => billing || tab.key !== 'billing').map((tab) => {
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
