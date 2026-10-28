import type { PublicEntrySummaryDto } from '@yayatoh/cms';
import type { ListingDto } from '@yayatoh/marketplace';
import { publicCovers, publicMedia } from '@yayatoh/media';
import { brandPalette, cx } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { BrandSection } from '@/components/brand-styled.tsx';
import { Pagination } from '@/components/marketplace/pagination.tsx';
import { TagFilter } from '@/components/marketplace/tag-filter.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import { Link } from '@/i18n/navigation.ts';
import { Carousel } from './carousel.tsx';
import { JaggedCircle } from './hero.tsx';
import { PosterCard } from './poster-card.tsx';
import { Reveal } from './reveal.tsx';

/**
 * An organizer's public home in the marketplace's showcase look (U-redesign): a big display
 * headline over a jagged cover circle tinted with the org's brand colour, category pills from its
 * events, a poster carousel of its upcoming events and its blog. Used by the organizer page
 * (`/o/{slug}`) and by the tenant site home, so what the landing page promises is what it gets.
 * The brand colour reaches the page through `BrandSection` (CSSOM, strict CSP).
 */
export async function OrgShowcase({
  orgId,
  name,
  brandColor,
  eyebrow,
  lede,
  listings,
  locale,
  tags,
  tag,
  path,
  page,
  pageCount,
  posts,
  postsHref,
  links,
  emptyTitle,
  emptyDescription,
  header,
  footer,
}: {
  orgId: string;
  name: string;
  brandColor: string | null;
  eyebrow: string;
  lede: string;
  listings: readonly ListingDto[];
  locale: string;
  tags: readonly { key: string; tag: string; count: number }[];
  tag: string | null;
  path: string;
  page: number;
  pageCount: number;
  posts: readonly PublicEntrySummaryDto[];
  postsHref: string;
  links?: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  header: ReactNode;
  footer: ReactNode;
}) {
  const t = await getTranslations('market');
  const tc = await getTranslations('cmsPublic');
  const ts = await getTranslations('showcase');
  const [covers, logos] = await Promise.all([
    publicCovers(listings.map((l) => l.slug)),
    publicMedia('org', orgId),
  ]);
  const logo = logos[0] ?? null;
  const brand = brandColor ? brandPalette(brandColor) : null;
  const heroCover = listings[0] ? (covers.get(listings[0].slug) ?? null) : null;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <div data-surface="showcase" className="min-h-dvh bg-page">
      {header}
      <main id="main" className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-4 pb-4 md:px-6">
        <section
          aria-labelledby="org-heading"
          className="relative isolate grid items-center gap-8 overflow-hidden rounded-[36px] border border-line bg-surface p-6 md:grid-cols-[1.2fr_0.8fr] md:p-12"
        >
          <BrandSection
            aria-hidden="true"
            brand={brand ? { background: brand.background, text: brand.text } : null}
            className="pointer-events-none absolute -start-24 -top-24 -z-10 size-96 rounded-full bg-ember opacity-40 blur-3xl animate-breathe motion-reduce:animate-none"
          />
          <div className="flex flex-col items-start gap-5">
            {logo ? (
              <div
                data-testid="org-logo"
                className="flex size-20 items-center justify-center rounded-tile bg-white p-2"
              >
                <MediaPicture image={logo} sizes="80px" eager className="max-h-16 w-auto object-contain" />
              </div>
            ) : null}
            <p className="m-0 text-caption font-bold tracking-widest text-ember uppercase">{eyebrow}</p>
            <h1
              id="org-heading"
              className="m-0 font-display text-[44px] leading-[0.95] font-black tracking-[-0.04em] text-ink uppercase animate-rise motion-reduce:animate-none md:text-[84px] [overflow-wrap:anywhere]"
            >
              {name}
            </h1>
            <p className="m-0 max-w-xl text-[17px] leading-relaxed text-ink-2">{lede}</p>
            {links ? <div className="flex flex-wrap gap-4 text-body">{links}</div> : null}
          </div>
          <JaggedCircle cover={heroCover} className="mx-auto w-full max-w-sm" />
        </section>
        {tags.length > 0 ? (
          <div className="flex flex-col gap-3">
            <TagFilter tags={tags} current={tag} path={path} />
          </div>
        ) : null}
        {listings.length > 0 ? (
          <>
            <Carousel id="org-upcoming" title={t('upcoming')} viewAllHref="/events">
              {listings.map((l, i) => (
                <li key={l.slug} className="snap-start">
                  <PosterCard listing={l} cover={covers.get(l.slug) ?? null} locale={locale} eager={i < 5} />
                </li>
              ))}
            </Carousel>
            <Pagination path={path} params={{ tag: tag ?? undefined }} page={page} pageCount={pageCount} />
          </>
        ) : (
          <section className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
            <h2 className="font-display text-[22px] font-black uppercase">{emptyTitle}</h2>
            <p className="max-w-md text-ink-2">{emptyDescription}</p>
          </section>
        )}
        {posts.length > 0 ? (
          <Reveal as="section" className="flex flex-col gap-5">
            <div className="flex items-end justify-between gap-4">
              <h2 className="m-0 font-display text-[26px] leading-none font-black tracking-[-0.02em] uppercase md:text-[34px]">
                {tc('blog')}
              </h2>
              <Link href={postsHref} className="text-body font-bold underline underline-offset-4">
                {ts('viewAll')}
              </Link>
            </div>
            <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
              {posts.slice(0, 3).map((p, i) => (
                <li key={p.slug}>
                  <article
                    className={cx(
                      'group relative flex h-full flex-col gap-2 rounded-card border border-line p-6 transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none',
                      i % 3 === 0 ? 'bg-ember-soft text-white' : 'bg-surface',
                    )}
                  >
                    <p className="m-0 text-caption font-bold opacity-80">
                      <time dateTime={p.publishedAt.toISOString()}>{date.format(p.publishedAt)}</time>
                    </p>
                    <h3 className="m-0 text-[20px] leading-snug font-extrabold">
                      <Link
                        href={`${postsHref}/${p.slug}`}
                        className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
                      >
                        {p.title}
                      </Link>
                    </h3>
                    {p.excerpt ? <p className="m-0 line-clamp-3 text-body opacity-80">{p.excerpt}</p> : null}
                  </article>
                </li>
              ))}
            </ul>
          </Reveal>
        ) : null}
      </main>
      {footer}
    </div>
  );
}
