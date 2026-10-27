import { buttonClass, cx } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { artGlow, GLOW } from './categories.ts';

export interface OrganizerTile {
  readonly slug: string;
  readonly name: string;
  readonly events: number;
  readonly href: string;
}

/** Heights cycle so the tiles read as a masonry rather than a grid. */
const SHAPES = ['aspect-[4/5]', 'aspect-square', 'aspect-[4/3]', 'aspect-[3/4]', 'aspect-[5/4]'];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** "Popular organizers": a pink-red panel with a masonry of the organizers behind today's events. */
export async function OrganizersPanel({ organizers }: { organizers: readonly OrganizerTile[] }) {
  const t = await getTranslations('showcase.creators');
  if (organizers.length === 0) return null;
  return (
    <section
      aria-labelledby="creators-title"
      className="grid gap-8 rounded-[36px] bg-ember-soft p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:p-10"
    >
      <div className="flex flex-col justify-between gap-6 text-white">
        <div className="flex flex-col gap-4">
          <h2
            id="creators-title"
            className="font-display text-[30px] leading-[1.02] font-black tracking-[-0.03em] uppercase md:text-[40px]"
          >
            {t('title')}
          </h2>
          <p className="max-w-sm text-[16px] text-white/85">{t('lede')}</p>
        </div>
        <Link href="/events" className={buttonClass('white', 'md', 'self-start')}>
          {t('all')}
        </Link>
      </div>
      <ul className="m-0 list-none columns-2 gap-3 p-0 md:columns-3">
        {organizers.map((o, i) => (
          <li key={o.slug} className="mb-3 break-inside-avoid">
            <Link
              href={o.href}
              className={cx(
                'group relative flex w-full flex-col justify-end overflow-hidden rounded-card bg-linear-to-br p-4 text-white',
                GLOW[artGlow(o.slug)].art,
                SHAPES[i % SHAPES.length],
              )}
            >
              <span
                aria-hidden="true"
                className="absolute start-4 top-3 font-display text-[40px] leading-none font-black tracking-[-0.04em] text-white/35 uppercase transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none"
              >
                {initials(o.name)}
              </span>
              <span className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/55 to-transparent" />
              <span className="relative text-[15px] leading-tight font-extrabold">{o.name}</span>
              <span className="relative text-caption text-white/80">{t('events', { count: o.events })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
