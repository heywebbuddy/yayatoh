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
}: {
  base: string;
  active: 'plan' | 'assign' | 'rules' | 'finder';
  finder?: boolean;
  /** The date whose chart the plan and guest views show (M1.7g); kept when switching views. */
  date?: string | null;
}) {
  const t = useTranslations('seating.tabs');
  const q = date ? `?date=${date}` : '';
  const tabs = [
    { key: 'plan', href: `${base}${q}` },
    { key: 'assign', href: `${base}/assign${q}` },
    { key: 'rules', href: `${base}/rules` },
    ...(finder ? [{ key: 'finder', href: `${base}/finder` } as const] : []),
  ] as const;
  return (
    <nav aria-label={t('label')}>
      <ul className="flex list-none flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const on = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center rounded-pill border px-3.5 text-[13px] whitespace-nowrap ${on ? 'border-ink bg-tag text-white' : 'border-line bg-surface text-ink-2 hover:bg-surface-2'}`}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
