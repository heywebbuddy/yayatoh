import { buttonClass, cx } from '@yayatoh/ui';
import type { LucideIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';

/**
 * The designed top of every public page: an ember glow behind a big display headline, a small
 * eyebrow with an icon, the lede and an optional action row. Motion is the shared `animate-rise`
 * (off under reduced motion); no inline styles.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  icon: Icon,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  icon?: LucideIcon;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cx(
        'relative isolate flex flex-col gap-4 overflow-hidden rounded-[36px] border border-line bg-surface p-6 md:p-12',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -end-24 -top-24 -z-10 size-72 rounded-full bg-ember opacity-30 blur-3xl animate-breathe motion-reduce:animate-none"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 start-1/3 -z-10 size-64 rounded-full bg-rose opacity-20 blur-3xl animate-drift motion-reduce:animate-none"
      />
      {eyebrow ? (
        <p className="m-0 flex items-center gap-2 text-caption font-bold tracking-widest text-ember uppercase">
          {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
          {eyebrow}
        </p>
      ) : null}
      <h1 className="m-0 max-w-3xl font-display text-[32px] leading-[1.05] font-black tracking-[-0.03em] uppercase animate-rise motion-reduce:animate-none md:text-[48px] [overflow-wrap:anywhere]">
        {title}
      </h1>
      {lede ? <p className="m-0 max-w-2xl text-[17px] leading-relaxed text-ink-2">{lede}</p> : null}
      {children}
    </header>
  );
}

/** The closing call to action of a public page. */
export async function PageCta({
  title,
  lede,
  href = '/contact',
  label,
}: {
  title?: string;
  lede?: string;
  href?: string;
  label?: string;
}) {
  const t = await getTranslations('pages.cta');
  return (
    <section
      aria-labelledby="page-cta"
      className="flex flex-col items-start gap-4 rounded-[36px] bg-ember-soft p-8 text-white md:flex-row md:items-center md:justify-between md:p-10"
    >
      <div className="flex max-w-xl flex-col gap-2">
        <h2
          id="page-cta"
          className="m-0 font-display text-[24px] leading-tight font-black uppercase md:text-[30px] [overflow-wrap:anywhere]"
        >
          {title ?? t('title')}
        </h2>
        <p className="m-0 text-[16px] text-white/90">{lede ?? t('lede')}</p>
      </div>
      <Link href={href} className={buttonClass('white', 'lg', 'shrink-0')}>
        {label ?? t('button')}
      </Link>
    </section>
  );
}

export interface TocItem {
  readonly id: string;
  readonly title: string;
}

/** A sticky "On this page" list for long text (legal pages, articles); plain in-page anchors. */
export async function Toc({ items }: { items: readonly TocItem[] }) {
  if (items.length < 3) return null;
  const t = await getTranslations('pages');
  return (
    <nav
      aria-label={t('toc')}
      className="rounded-card border border-line bg-surface p-5 lg:sticky lg:top-24 lg:self-start"
    >
      <p className="m-0 mb-3 text-caption font-bold tracking-widest text-ink-2 uppercase">{t('toc')}</p>
      <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[15px]">
        {items.map((i, n) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className="flex min-h-9 items-start gap-2 py-1 text-ink-2 hover:text-ember [overflow-wrap:anywhere]"
            >
              <span className="text-ember">{n + 1}.</span>
              {i.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
