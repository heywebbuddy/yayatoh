import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';

/** The Seating page's two views: the plan (editor, prices) and assigning guests (M1.7d). */
export function SeatingTabs({ base, active }: { base: string; active: 'plan' | 'assign' }) {
  const t = useTranslations('seating.tabs');
  const tabs = [
    { key: 'plan', href: base },
    { key: 'assign', href: `${base}/assign` },
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
