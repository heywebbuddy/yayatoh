import { filterChipClass } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';

/** U7: a series page's views — its events and its details. */
export function SeriesTabs({ base, active }: { base: string; active: 'events' | 'details' }) {
  const t = useTranslations('seriesPage.tabs');
  const tabs = [
    { key: 'events', href: base },
    { key: 'details', href: `${base}/details` },
  ] as const;
  return (
    <nav aria-label={t('label')}>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {tabs.map((tab) => {
          const on = tab.key === active;
          return (
            <li key={tab.key}>
              <Link href={tab.href} aria-current={on ? 'page' : undefined} className={filterChipClass(on)}>
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
