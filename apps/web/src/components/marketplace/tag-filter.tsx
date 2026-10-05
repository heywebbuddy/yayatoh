import { cx, filterChipClass } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

/**
 * U8: the org site's tag filter (organizer page, tenant site home). Links, so it works without
 * JavaScript and every filtered page has its own URL; the current one is `aria-current`. 44 px
 * targets (public pages).
 */
export async function TagFilter({
  tags,
  current,
  path,
}: {
  tags: readonly { key: string; tag: string; count: number }[];
  /** The selected tag key, or null for all events. */
  current: string | null;
  path: string;
}) {
  if (tags.length === 0) return null;
  const t = await getTranslations('market.tags');
  const chip = (on: boolean) => cx(filterChipClass(on), 'min-h-11');
  return (
    <nav aria-label={t('label')}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        <li>
          <Link href={path} aria-current={current ? undefined : 'page'} className={chip(!current)}>
            {t('all')}
          </Link>
        </li>
        {tags.map((x) => (
          <li key={x.key}>
            <Link
              href={`${path}?tag=${encodeURIComponent(x.key)}`}
              aria-current={current === x.key ? 'page' : undefined}
              aria-label={t('tagLabel', { tag: x.tag, count: x.count })}
              className={chip(current === x.key)}
            >
              {x.tag}
              <span aria-hidden="true" className="tabular-nums opacity-80">
                {x.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
