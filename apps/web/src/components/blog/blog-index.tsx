import { cx } from '@yayatoh/ui';
import { ArrowUpRight, Search } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Pagination } from '@/components/marketplace/pagination.tsx';
import { MaskLines, Parallax } from '@/components/organizers/motion.tsx';
import { artGlow, GLOW } from '@/components/showcase/categories.ts';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { Link } from '@/i18n/navigation.ts';
import { type BlogCard, categoriesOf, filterCards } from './model.ts';

export const BLOG_PAGE_SIZE = 9;

const eyebrow = 'm-0 text-caption font-bold tracking-widest text-ember uppercase';
const pill =
  'inline-flex min-h-11 items-center rounded-pill border px-5 text-body font-bold whitespace-nowrap transition-colors motion-reduce:transition-none';

function Cover({ card, sizes, className }: { card: BlogCard; sizes?: string; className?: string }) {
  if (card.coverUrl)
    return (
      <img
        src={card.coverUrl}
        alt={card.coverAlt}
        sizes={sizes}
        loading="lazy"
        decoding="async"
        className={cx(
          'size-full object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:transition-none',
          className,
        )}
      />
    );
  const art = GLOW[artGlow(card.slug)];
  return (
    <div
      role="img"
      aria-label={card.coverAlt}
      className={cx('flex size-full items-end bg-linear-to-br p-6', art.art)}
    >
      <span
        aria-hidden="true"
        className="font-display text-[clamp(2.5rem,6vw,5rem)] leading-none font-black tracking-[-0.04em] text-white/90 uppercase"
      >
        {card.title.slice(0, 2)}
      </span>
    </div>
  );
}

async function Meta({ card, locale, className }: { card: BlogCard; locale: string; className?: string }) {
  const t = await getTranslations('blogUi');
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(card.date);
  return (
    <p className={cx('m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption font-bold', className)}>
      <time dateTime={card.date.toISOString()}>{date}</time>
      <span aria-hidden="true">•</span>
      <span>{t('minRead', { n: card.minutes })}</span>
      {card.author ? (
        <>
          <span aria-hidden="true">•</span>
          <span>{t('by', { name: card.author })}</span>
        </>
      ) : null}
    </p>
  );
}

async function Featured({ card, locale }: { card: BlogCard; locale: string }) {
  const t = await getTranslations('blogUi');
  return (
    <Reveal>
      <article className="group relative isolate grid min-h-[26rem] overflow-hidden rounded-[40px] border border-line bg-surface md:min-h-[32rem]">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <Parallax distance={40} className="size-full">
            <Cover card={card} sizes="100vw" className="scale-110" />
          </Parallax>
          <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/45 to-black/10" />
        </div>
        <div className="flex flex-col justify-end gap-4 p-6 text-white md:max-w-3xl md:p-12">
          <p className="m-0 flex flex-wrap items-center gap-2">
            <span className="rounded-pill bg-white px-3 py-1 text-caption font-black tracking-widest text-black uppercase">
              {t('featured')}
            </span>
            {card.category ? (
              <span className="rounded-pill bg-white/15 px-3 py-1 text-caption font-bold backdrop-blur">
                {card.category}
              </span>
            ) : null}
          </p>
          <h2 className="m-0 font-display text-[clamp(1.8rem,4.6vw,3.6rem)] leading-[1.02] font-black tracking-[-0.03em] uppercase [overflow-wrap:anywhere]">
            <Link
              href={card.href}
              className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
            >
              {card.title}
            </Link>
          </h2>
          {card.excerpt ? (
            <p className="m-0 line-clamp-3 max-w-2xl text-[17px] leading-relaxed text-white/85">
              {card.excerpt}
            </p>
          ) : null}
          <Meta card={card} locale={locale} className="text-white/80" />
          <span className="inline-flex items-center gap-2 self-start rounded-pill bg-white px-5 py-3 font-bold text-black transition-transform group-hover:translate-x-1 motion-reduce:transition-none">
            {t('readMore')}
            <ArrowUpRight aria-hidden="true" className="size-5" />
          </span>
        </div>
      </article>
    </Reveal>
  );
}

export async function BlogGridCard({
  card,
  locale,
  index = 0,
}: {
  card: BlogCard;
  locale: string;
  index?: number;
}) {
  const t = await getTranslations('blogUi');
  return (
    <Reveal as="li" delay={index % 3}>
      <article className="group relative flex h-full flex-col overflow-hidden rounded-[32px] border border-line bg-surface transition-all duration-300 hover:-translate-y-1.5 hover:border-ember motion-reduce:transition-none motion-reduce:hover:translate-y-0">
        <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
          <Cover card={card} sizes="(min-width: 1024px) 380px, 90vw" />
          {card.category ? (
            <span className="absolute start-4 top-4 rounded-pill bg-black/65 px-3 py-1 text-caption font-bold text-white backdrop-blur">
              {card.category}
            </span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-6">
          <Meta card={card} locale={locale} className="text-ink-3" />
          <h3 className="m-0 text-[22px] leading-snug font-extrabold tracking-[-0.01em] text-ink [overflow-wrap:anywhere]">
            <Link
              href={card.href}
              className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
            >
              {card.title}
            </Link>
          </h3>
          {card.excerpt ? <p className="m-0 line-clamp-3 text-body text-ink-2">{card.excerpt}</p> : null}
          <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-body font-bold text-ember">
            {t('readMore')}
            <ArrowUpRight
              aria-hidden="true"
              className="size-4 transition-transform group-hover:rotate-45 motion-reduce:transition-none"
            />
          </span>
        </div>
      </article>
    </Reveal>
  );
}

/**
 * The blog index, the same for the platform blog and every organization's: a big masked headline,
 * a search box and category pills, a featured post, a grid of image cards and pagination. The
 * filter, the search and the page are query parameters, so every state has its own address and
 * works without JavaScript.
 */
export async function BlogIndex({
  lines,
  title,
  lede,
  cards,
  path,
  q,
  category,
  page,
  locale,
  header,
  footer,
  glow,
}: {
  lines?: readonly string[];
  title?: string;
  lede: string;
  cards: readonly BlogCard[];
  path: string;
  q: string;
  category: string;
  page: number;
  locale: string;
  header: ReactNode;
  footer: ReactNode;
  glow?: ReactNode;
}) {
  const t = await getTranslations('blogUi');
  const categories = categoriesOf(cards);
  const filtered = filterCards(cards, q, category);
  const filtering = Boolean(q.trim() || category);
  const showFeatured = !filtering && page === 1 && filtered.length > 0;
  const rest = showFeatured ? filtered.slice(1) : filtered;
  const pageCount = Math.max(1, Math.ceil(rest.length / BLOG_PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pageCount);
  const slice = rest.slice((p - 1) * BLOG_PAGE_SIZE, p * BLOG_PAGE_SIZE);
  const href = (c: string) =>
    c
      ? `${path}?category=${encodeURIComponent(c)}${q ? `&q=${encodeURIComponent(q)}` : ''}`
      : q
        ? `${path}?q=${encodeURIComponent(q)}`
        : path;
  return (
    <div data-surface="showcase" className="min-h-dvh bg-page">
      {header}
      <main
        id="main"
        className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pt-5 pb-4 md:gap-14 md:px-6 md:pt-6"
      >
        <header className="relative isolate flex flex-col gap-6 overflow-hidden rounded-[40px] border border-line bg-surface p-6 md:p-14">
          {glow ?? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -end-24 -top-24 -z-10 size-96 rounded-full bg-ember opacity-30 blur-3xl animate-breathe motion-reduce:animate-none"
            />
          )}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-32 start-1/3 -z-10 size-72 rounded-full bg-grape opacity-20 blur-3xl animate-drift motion-reduce:animate-none"
          />
          <p className={eyebrow}>{t('eyebrow')}</p>
          <MaskLines
            as="h1"
            lines={lines ?? [title ?? '']}
            className="m-0 font-display text-[clamp(2.4rem,8vw,6.5rem)] leading-[0.95] font-black tracking-[-0.04em] text-ink uppercase [overflow-wrap:anywhere]"
          />
          <p className="m-0 max-w-2xl text-[17px] leading-relaxed text-ink-2">{lede}</p>
          <search className="max-w-xl">
            <form action={path} method="get" className="flex items-center gap-2">
              {category ? <input type="hidden" name="category" value={category} /> : null}
              <label htmlFor="blog-search" className="sr-only">
                {t('searchLabel')}
              </label>
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-ink-3"
                />
                <input
                  id="blog-search"
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={80}
                  placeholder={t('searchPlaceholder')}
                  className="min-h-12 w-full rounded-pill border border-line bg-surface-2 ps-12 pe-4 text-body text-ink placeholder:text-ink-3"
                />
              </div>
              <button
                type="submit"
                className="min-h-12 rounded-pill bg-white px-6 font-bold text-black hover:bg-white/90"
              >
                {t('searchButton')}
              </button>
            </form>
          </search>
          {categories.length > 0 ? (
            <nav aria-label={t('filterLabel')}>
              <ul className="no-scrollbar m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1">
                {['', ...categories].map((c) => {
                  const on = c.toLowerCase() === category.toLowerCase();
                  return (
                    <li key={c || 'all'}>
                      <Link
                        href={href(c)}
                        aria-current={on ? 'page' : undefined}
                        className={cx(
                          pill,
                          on
                            ? 'border-ember bg-ember-soft text-white'
                            : 'border-line bg-surface-2 text-ink hover:border-ember',
                        )}
                      >
                        {c || t('all')}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}
        </header>

        {cards.length === 0 ? (
          <section className="flex flex-col items-center gap-3 rounded-[32px] border border-line bg-surface p-12 text-center">
            <h2 className="m-0 font-display text-[26px] font-black uppercase">{t('noPostsTitle')}</h2>
            <p className="m-0 max-w-md text-ink-2">{t('noPostsBody')}</p>
          </section>
        ) : filtered.length === 0 ? (
          <section
            role="status"
            className="flex flex-col items-center gap-4 rounded-[32px] border border-line bg-surface p-12 text-center"
          >
            <h2 className="m-0 font-display text-[26px] font-black uppercase">{t('emptyTitle')}</h2>
            <p className="m-0 max-w-md text-ink-2">{t('emptyBody')}</p>
            <Link
              href={path}
              className="inline-flex min-h-12 items-center rounded-pill bg-white px-6 font-bold text-black"
            >
              {t('clear')}
            </Link>
          </section>
        ) : (
          <>
            {q.trim() ? <p className="m-0 text-body text-ink-2">{t('results', { q: q.trim() })}</p> : null}
            {showFeatured && filtered[0] ? <Featured card={filtered[0]} locale={locale} /> : null}
            {slice.length > 0 ? (
              <ul className="m-0 grid list-none gap-5 p-0 md:grid-cols-2 lg:grid-cols-3">
                {slice.map((c, i) => (
                  <BlogGridCard key={c.slug} card={c} locale={locale} index={i} />
                ))}
              </ul>
            ) : null}
            <Pagination
              path={path}
              params={{ category: category || undefined, q: q.trim() || undefined }}
              page={p}
              pageCount={pageCount}
            />
          </>
        )}
      </main>
      {footer}
    </div>
  );
}
