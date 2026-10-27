import { cx } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { categoryLook, GLOW, typeLook } from './categories.ts';

export interface RailItem {
  /** `type:concert` or `topic:music`: also the `active` value of the page. */
  readonly key: string;
  readonly href: string;
  readonly label: string;
}

function Pill({ item, active }: { item: RailItem; active: boolean }) {
  const [kind, id = ''] = item.key.split(':');
  const look = kind === 'type' ? typeLook(id) : categoryLook(id);
  const glow = GLOW[look.glow];
  const Icon = look.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'inline-flex min-h-14 items-center gap-3 rounded-pill border-2 bg-surface py-1.5 ps-1.5 pe-6 text-[15px] font-bold whitespace-nowrap text-ink transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none',
        glow.ring,
        active && 'bg-surface-3',
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
      {item.label}
    </Link>
  );
}

/**
 * Our event types and categories as pills: two rows that scroll sideways on their own in opposite
 * directions (a marquee) and stop under the pointer or the keyboard focus. Under reduced motion
 * they are plain scrollable rows. Each pill is a round thumbnail with a glowing outline; the
 * second copy of a row is hidden from assistive technology and the tab order.
 */
export async function CategoryRail({
  items,
  active,
}: {
  items: readonly RailItem[];
  active?: string | undefined;
}) {
  const ts = await getTranslations('showcase');
  const half = Math.ceil(items.length / 2);
  const rows = [items.slice(0, half), items.slice(half)].filter((r) => r.length > 0);
  return (
    <nav aria-label={ts('categoriesLabel')} className="flex flex-col gap-1">
      {rows.map((row, i) => (
        <div
          key={row[0]?.key}
          className="no-scrollbar group/marquee overflow-hidden py-3 motion-reduce:overflow-x-auto"
        >
          <ul
            className={cx(
              'm-0 flex w-max list-none gap-3 p-1 group-focus-within/marquee:[animation-play-state:paused] group-hover/marquee:[animation-play-state:paused] motion-reduce:animate-none',
              i === 0 ? 'animate-marquee' : 'animate-marquee-rev',
            )}
          >
            {row.map((item) => (
              <li key={item.key}>
                <Pill item={item} active={active === item.key} />
              </li>
            ))}
            {row.map((item) => (
              <li key={`copy-${item.key}`} aria-hidden="true" inert className="motion-reduce:hidden">
                <Pill item={item} active={false} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
