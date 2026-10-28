import { cx } from '@yayatoh/ui';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { MaskLines, Parallax } from '@/components/organizers/motion.tsx';
import { artGlow, GLOW } from '@/components/showcase/categories.ts';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { Link } from '@/i18n/navigation.ts';
import { Article } from './article.tsx';
import { BlogGridCard } from './blog-index.tsx';
import { ReadingProgress, ShareButtons, Toc } from './client.tsx';
import { type BlogCard, headingsOf } from './model.ts';

export interface BlogPostModel extends BlogCard {
  readonly body: string;
}

/**
 * One post: a full-bleed cover with the title over a gradient, author, date and reading time, a
 * reading progress bar, a sticky table of contents on wide screens, the typeset article, share
 * buttons, related posts and a closing call to action. An organization's post can carry a card
 * with its upcoming events (`aside`).
 */
export async function BlogPostPage({
  post,
  related,
  locale,
  blogHref,
  header,
  footer,
  aside,
  cta,
}: {
  post: BlogPostModel;
  related: readonly BlogCard[];
  locale: string;
  blogHref: string;
  header: ReactNode;
  footer: ReactNode;
  aside?: ReactNode;
  cta?: ReactNode;
}) {
  const t = await getTranslations('blogUi');
  const headings = headingsOf(post.body);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(post.date);
  const art = GLOW[artGlow(post.slug)];
  return (
    <div data-surface="showcase" className="min-h-dvh bg-page">
      <ReadingProgress label={t('progress')} targetId="post-article" />
      {header}
      <main
        id="main"
        className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 pt-5 pb-4 md:gap-16 md:px-6 md:pt-6"
      >
        <header className="relative isolate flex min-h-[26rem] flex-col justify-end overflow-hidden rounded-[40px] border border-line bg-surface md:min-h-[36rem]">
          <div className="absolute inset-0 -z-10 overflow-hidden">
            {post.coverUrl ? (
              <Parallax distance={70} className="size-full">
                <img
                  src={post.coverUrl}
                  alt={post.coverAlt}
                  loading="eager"
                  decoding="async"
                  className="size-full scale-110 object-cover"
                />
              </Parallax>
            ) : (
              <div
                role="img"
                aria-label={post.coverAlt}
                className={cx('size-full bg-linear-to-br', art.art)}
              />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/50 to-black/15" />
          </div>
          <div className="flex max-w-4xl flex-col gap-5 p-6 text-white md:p-14">
            <Link
              href={blogHref}
              className="inline-flex items-center gap-2 self-start rounded-pill bg-white/15 px-4 py-2 text-caption font-bold backdrop-blur hover:bg-white/25"
            >
              <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
              {t('back')}
            </Link>
            {post.category ? (
              <p className="m-0 self-start rounded-pill bg-white px-3 py-1 text-caption font-black tracking-widest text-black uppercase">
                {post.category}
              </p>
            ) : null}
            <MaskLines
              as="h1"
              lines={[post.title]}
              className="m-0 font-display text-[clamp(1.9rem,5.2vw,4.4rem)] leading-[1.02] font-black tracking-[-0.03em] text-white uppercase [overflow-wrap:anywhere]"
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body text-white/85">
              {post.author ? (
                <span className="inline-flex items-center gap-2 font-bold">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-9 items-center justify-center rounded-full bg-white font-display font-black text-black"
                  >
                    {post.author.slice(0, 1).toUpperCase()}
                  </span>
                  {t('by', { name: post.author })}
                </span>
              ) : null}
              <time dateTime={post.date.toISOString()}>{t('published', { date })}</time>
              <span>{t('minRead', { n: post.minutes })}</span>
            </div>
          </div>
        </header>

        <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)_15rem] lg:gap-14">
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <Toc headings={headings} label={t('toc')} />
            </div>
          </aside>
          <article id="post-article" className="flex flex-col gap-8">
            {post.excerpt ? (
              <p className="m-0 max-w-[44rem] text-[clamp(1.2rem,2.2vw,1.5rem)] leading-snug font-semibold text-ink">
                {post.excerpt}
              </p>
            ) : null}
            <Article source={post.body} />
            {post.tags.length > 0 ? (
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {post.tags.map((g) => (
                  <li
                    key={g}
                    className="rounded-pill border border-line bg-surface px-3 py-1 text-caption font-bold text-ink-2"
                  >
                    #{g}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
          <aside className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
            <ShareButtons
              title={post.title}
              label={t('share')}
              whatsapp={t('shareWhatsapp')}
              linkedin={t('shareLinkedin')}
              x={t('shareX')}
              copy={t('copyLink')}
              copied={t('copied')}
            />
            <div className="lg:hidden">
              <Toc headings={headings} label={t('toc')} />
            </div>
          </aside>
        </div>

        {aside}

        {related.length > 0 ? (
          <section aria-labelledby="related-h" className="flex flex-col gap-6">
            <Reveal>
              <h2
                id="related-h"
                className="m-0 font-display text-[clamp(1.8rem,4vw,3rem)] leading-none font-black tracking-[-0.03em] text-ink uppercase"
              >
                {t('related')}
              </h2>
            </Reveal>
            <ul className="m-0 grid list-none gap-5 p-0 md:grid-cols-3">
              {related.map((c, i) => (
                <BlogGridCard key={c.slug} card={c} locale={locale} index={i} />
              ))}
            </ul>
          </section>
        ) : null}

        {cta ?? (
          <section className="flex flex-col items-start gap-4 rounded-[40px] bg-ember-soft p-8 text-white md:flex-row md:items-center md:justify-between md:p-12">
            <div className="flex max-w-xl flex-col gap-2">
              <h2 className="m-0 font-display text-[clamp(1.5rem,3.4vw,2.4rem)] leading-tight font-black uppercase">
                {t('ctaTitle')}
              </h2>
              <p className="m-0 text-[17px] opacity-90">{t('ctaBody')}</p>
            </div>
            <Link
              href="/for-organizers"
              className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-white px-6 font-bold text-black hover:bg-white/90"
            >
              {t('ctaButton')}
              <ArrowUpRight aria-hidden="true" className="size-5" />
            </Link>
          </section>
        )}
      </main>
      {footer}
    </div>
  );
}

/** Related posts: the same category first, then the newest others. */
export function relatedOf(all: readonly BlogCard[], post: BlogCard, n = 3): BlogCard[] {
  const others = all.filter((c) => c.slug !== post.slug);
  const same = others.filter(
    (c) => post.category && c.category?.toLowerCase() === post.category.toLowerCase(),
  );
  return [...same, ...others.filter((c) => !same.includes(c))].slice(0, n);
}
