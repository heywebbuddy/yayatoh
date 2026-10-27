import { cx } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { ScrollRow } from './carousel.tsx';
import { categoryLook, GLOW } from './categories.ts';

/**
 * The category pills: two rows that scroll sideways, each pill a round thumbnail with a glowing
 * outline and the category name. Links go to the events list filtered to that category.
 */
export async function CategoryRail({
  keys,
  active,
}: {
  keys: readonly string[];
  active?: string | undefined;
}) {
  const t = await getTranslations('categories');
  const ts = await getTranslations('showcase');
  const half = Math.ceil(keys.length / 2);
  const rows = [keys.slice(0, half), keys.slice(half)].filter((r) => r.length > 0);
  return (
    <nav aria-label={ts('categoriesLabel')} className="flex flex-col">
      {rows.map((row, i) => (
        <ScrollRow key={row[0]} label={ts('categoriesLabel')} className={i === 1 ? 'ps-10' : ''}>
          {row.map((key) => {
            const look = categoryLook(key);
            const glow = GLOW[look.glow];
            const Icon = look.icon;
            return (
              <li key={key} className="snap-start">
                <Link
                  href={`/events?topic=${key}`}
                  aria-current={active === key ? 'page' : undefined}
                  className={cx(
                    'inline-flex min-h-14 items-center gap-3 rounded-pill border-2 bg-surface py-1.5 ps-1.5 pe-6 text-[15px] font-bold whitespace-nowrap text-ink transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none',
                    glow.ring,
                    active === key && 'bg-surface-3',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'inline-flex size-11 items-center justify-center rounded-pill bg-linear-to-br text-white',
                      glow.art,
                    )}
                  >
                    <Icon className="size-5" strokeWidth={2.2} />
                  </span>
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ScrollRow>
      ))}
    </nav>
  );
}
