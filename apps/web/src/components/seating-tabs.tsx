import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';

/**
 * The Seating page's views: the plan (editor, prices), assigning guests (M1.7d) and, when the org
 * has the seat_finder module, the public seat finder and its poster (M1.7e).
 */
export function SeatingTabs({
  base,
  active,
  finder = false,
}: {
  base: string;
  active: 'plan' | 'assign' | 'finder';
  finder?: boolean;
}) {
  const t = useTranslations('seating.tabs');
  const tabs = [
    { key: 'plan', href: base },
    { key: 'assign', href: `${base}/assign` },
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
                className={`inline-flex min-h-9 items-center rounded-pill border px-3.5 text-[13px] whitespace-nowrap ${on ? 'border-ink bg-ink text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
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
