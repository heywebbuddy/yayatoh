import type { PublicEntrySummaryDto } from '@yayatoh/cms';
import type { ListingDto } from '@yayatoh/marketplace';
import { publicCovers, publicMedia } from '@yayatoh/media';
import { brandPalette } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { BlogGridCard } from '@/components/blog/blog-index.tsx';
import { orgCard } from '@/components/blog/org-blog.tsx';
import { BrandSection } from '@/components/brand-styled.tsx';
import { Pagination } from '@/components/marketplace/pagination.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import { Link } from '@/i18n/navigation.ts';
import { categoryLabels, platformCategoryCatalog } from '@/server/event-categories.ts';
import { Carousel } from './carousel.tsx';
import { TYPE_KEYS } from './categories.ts';
import { CategoryRail, type RailItem } from './category-rail.tsx';
import { HeroOrb } from './hero-orb.tsx';
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
  const tt = await getTranslations('showcase.types');
  const tcat = await getTranslations('categories');
  const catKeys = new Set((await platformCategoryCatalog()).map((c) => c.key));
  const label = await categoryLabels((k) => tcat(k as 'music'));
  // The org's own event types and platform categories, named like the marketplace pills; raw tags and counts stay out.
  const have = new Set(listings.map((l) => l.profile));
  const pills: RailItem[] = [
    ...TYPE_KEYS.filter((k) => have.has(k)).map((k) => ({
      key: `type:${k}`,
      href: k === 'wedding' ? '/solutions/weddings' : `/events?type=${k}`,
      label: tt(k),
    })),
    ...tags
      .filter((x) => catKeys.has(x.key) && x.key !== 'other')
      .map((x) => ({ key: `topic:${x.key}`, href: `/events?topic=${x.key}`, label: label(x.key) })),
  ];
  const [covers, logos] = await Promise.all([
    publicCovers(listings.map((l) => l.slug)),
    publicMedia('org', orgId),
  ]);
  const logo = logos[0] ?? null;
  const brand = brandColor ? brandPalette(brandColor) : null;
  const heroCover = listings[0] ? (covers.get(listings[0].slug) ?? null) : null;
  const _date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <div data-surface="showcase" className="min-h-dvh bg-page">
      {header}
      <main
        id="main"
        className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-4 pt-5 pb-4 md:px-6 md:pt-6"
      >
        <section
          aria-labelledby="org-heading"
          className="relative isolate flex flex-col items-center gap-6 overflow-x-clip pt-10 text-center md:pt-16"
        >
          <BrandSection
            aria-hidden="true"
            brand={brand ? { background: brand.background, text: brand.text } : null}
            className="pointer-events-none absolute start-1/2 top-10 -z-10 size-[28rem] -translate-x-1/2 rounded-full bg-ember opacity-40 blur-3xl animate-breathe motion-reduce:animate-none"
          />
          {logo ? (
            <div
              data-testid="org-logo"
              className="flex size-20 items-center justify-center rounded-tile bg-white p-2"
            >
              <MediaPicture image={logo} sizes="80px" eager className="max-h-16 w-auto object-contain" />
            </div>
          ) : null}
          <p className="m-0 text-caption font-bold tracking-widest text-ember uppercase">{eyebrow}</p>
          <HeroOrb cover={heroCover} className="w-[min(86vw,620px)]">
            <h1
              id="org-heading"
              className="pointer-events-none absolute inset-x-[-12%] top-1/2 m-0 -translate-y-1/2 px-2 font-display text-[clamp(24px,5.2vw,76px)] leading-[0.95] font-black tracking-[-0.04em] text-balance text-ink uppercase [text-shadow:0_2px_24px_var(--color-canvas),0_0_2px_var(--color-canvas)]"
            >
              {name}
            </h1>
          </HeroOrb>
          <p className="m-0 max-w-xl text-[16px] text-ink-2 md:text-[18px]">{lede}</p>
          {links ? <div className="flex flex-wrap justify-center gap-4 text-body">{links}</div> : null}
        </section>
        {pills.length > 0 ? <CategoryRail items={pills} /> : null}
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
            <ul className="m-0 grid list-none gap-5 p-0 md:grid-cols-3">
              {posts.slice(0, 3).map((p, i) => (
                <BlogGridCard
                  key={p.slug}
                  card={orgCard({ org: { orgId }, base: postsHref.replace(/\/blogs$/, '') }, p)}
                  locale={locale}
                  index={i}
                />
              ))}
            </ul>
          </Reveal>
        ) : null}
      </main>
      {footer}
    </div>
  );
}
