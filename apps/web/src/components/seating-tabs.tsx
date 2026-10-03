import { filterChipClass } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';

/**
 * The Seating page's views: the plan (editor, prices), assigning guests (M1.7d), the seating
 * rules (M1.7f) and, when the org has the seat_finder module, the public seat finder and its
 * poster (M1.7e).
 */
export function SeatingTabs({
  base,
  active,
  finder = false,
  date = null,
  guests = false,
}: {
  base: string;
  active: 'plan' | 'assign' | 'guests' | 'rules' | 'finder';
  finder?: boolean;
  /** The org has the guests module: the guest seating editor (M4.3a). */
  guests?: boolean;
  /** The date whose chart the plan and guest views show (M1.7g); kept when switching views. */
  date?: string | null;
}) {
  const t = useTranslations('seating.tabs');
  const q = date ? `?date=${date}` : '';
  const tabs = [
    { key: 'plan', href: `${base}${q}` },
    { key: 'assign', href: `${base}/assign${q}` },
    ...(guests ? [{ key: 'guests', href: `${base}/guests` } as const] : []),
    { key: 'rules', href: `${base}/rules` },
    ...(finder ? [{ key: 'finder', href: `${base}/finder` } as const] : []),
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
