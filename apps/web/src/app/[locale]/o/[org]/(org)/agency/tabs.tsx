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

/** Clients | Events | Marketing | Reports (vision §12). */
export function AgencyTabs({ base }: { base: string }) {
  const t = useTranslations('agency');
  const pathname = usePathname();
  return (
    <Tabs label={t('tabs')}>
      {TABS.map((tab) => {
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
