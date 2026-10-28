import { platformHero, platformPosts, platformTestimonials } from '@yayatoh/cms';
import { buttonClass } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SiteSections } from '@/components/marketing/site-sections.tsx';
import { Carousel } from '@/components/showcase/carousel.tsx';
import { CategoryRail } from '@/components/showcase/category-rail.tsx';
import { ShowcaseHero } from '@/components/showcase/hero.tsx';
import { loadShowcaseHome } from '@/components/showcase/home-data.ts';
import {
  BlogSection,
  FeatureGrid,
  FinalCta,
  HomeFaq,
  HowItWorks,
  StatsBand,
  TestimonialsSection,
  TrustedBy,
} from '@/components/showcase/home-sections.tsx';
import { OrganizerCta } from '@/components/showcase/organizer-cta.tsx';
import { OrganizersPanel } from '@/components/showcase/organizers-panel.tsx';
import { PosterCard } from '@/components/showcase/poster-card.tsx';
import { railItems, sectionLabel } from '@/components/showcase/rail-items.ts';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { cachedEntries } from '@/server/cms.ts';
import { cachedSections, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';
import { devAuthEnabled } from '@/server/session.ts';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'market' });
  const req = await requestHost();
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/',
    title: t('home.metaTitle'),
    description: t('home.lede'),
    image: `${req.origin}/api/og/home`,
  });
}

/**
 * The marketplace home (yayatoh.com; `/` locally), in the showcase look: a hero, the category
 * pills, featured and per-category carousels of real upcoming events, the organizers behind them,
 * and the organizer call to action.
 */
export default async function Home({ params }: Props) {
  const { locale } = await params;
  pageLocale(locale);
  const t = await getTranslations('showcase');
  const tm = await getTranslations('market');
  const data = await loadShowcaseHome();
  // M3.11b: the organizer sections ("Why Yayatoh") come from the platform CMS.
  const content = await platformContentOrg(await requestHost());
  const sections = content ? await cachedSections(content.orgId, 'home', locale) : [];
  // Staff-managed platform content (admin console) first; the content org's is the fallback.
  const [platformQuotes, platformPostList, hero] = await Promise.all([
    platformTestimonials(),
    platformPosts(3),
    platformHero(),
  ]);
  const orgQuotes = content ? await cachedSections(content.orgId, 'testimonials', locale) : [];
  const quotes =
    platformQuotes.length > 0
      ? platformQuotes.map((q) => ({
          key: q.id,
          quote: q.quote,
          name: q.name,
          role: q.role,
          photoUrl: q.photoUrl,
          rating: q.rating,
        }))
      : orgQuotes.map((s) => ({
          key: s.slug,
          quote: s.body || s.heading,
          name: s.heading,
          role: s.eyebrow || null,
          lang: s.locale === locale ? undefined : s.locale,
        }));
  const posts =
    platformPostList.items.length > 0
      ? platformPostList.items
      : content
        ? (await cachedEntries(content.orgId, 'post', 1)).items
        : [];
  const first = data.featured[0];
  return (
    <ShowcaseShell>
      <ShowcaseHero
        override={hero}
        cover={data.heroCover}
        featured={first ? { name: first.name, href: `/events/${first.slug}` } : null}
      />
      <CategoryRail items={await railItems()} />
      {data.featured.length > 0 ? (
        <Carousel id="featured" title={t('featured')} viewAllHref="/events">
          {data.featured.map((l, i) => (
            <li key={l.slug} className="snap-start">
              <PosterCard listing={l} cover={data.covers.get(l.slug) ?? null} locale={locale} eager={i < 5} />
            </li>
          ))}
        </Carousel>
      ) : (
        <section className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
          <h2 className="font-display text-[22px] font-black uppercase">{tm('empty.title')}</h2>
          <p className="max-w-md text-ink-2">{tm('empty.description')}</p>
        </section>
      )}
      {
        await Promise.all(
          data.sections.map(async (s) => (
            <Reveal key={s.key}>
              <Carousel
                id={`cat-${s.key.replace(':', '-')}`}
                title={await sectionLabel(s.key)}
                viewAllHref={`/events?${s.key.replace(':', '=')}`}
              >
                {s.events.map((l, i) => (
                  <li key={l.slug} className="snap-start">
                    <PosterCard
                      listing={l}
                      cover={data.covers.get(l.slug) ?? null}
                      locale={locale}
                      eager={i < 5}
                    />
                  </li>
                ))}
              </Carousel>
            </Reveal>
          )),
        )
      }
      <Reveal>
        <OrganizersPanel organizers={data.organizers} />
      </Reveal>
      {sections.length > 0 ? (
        <section aria-labelledby="home-organizers" className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2
              id="home-organizers"
              className="font-display text-[26px] leading-none font-black tracking-[-0.02em] uppercase md:text-[34px]"
            >
              {tm('home.organizersTitle')}
            </h2>
            <Link href="/features" className="self-start text-body underline underline-offset-4">
              {tm('home.organizersMore')}
            </Link>
          </div>
          <SiteSections sections={sections} layout="grid" locale={locale} headingLevel={3} />
        </section>
      ) : null}
      <Reveal>
        <StatsBand events={data.events.length} organizers={new Set(data.events.map((e) => e.orgSlug)).size} />
      </Reveal>
      <HowItWorks />
      <FeatureGrid />
      <TestimonialsSection items={quotes} />
      <BlogSection posts={posts} base="" locale={locale} />
      <TrustedBy organizers={data.organizers} />
      <HomeFaq />
      <Reveal>
        <OrganizerCta events={data.featured} covers={data.covers} />
      </Reveal>
      <FinalCta />
      {devAuthEnabled() ? (
        <Link className={buttonClass('secondary', 'md', 'self-center')} href="/dev/login">
          {tm('home.demoCta')}
        </Link>
      ) : null}
    </ShowcaseShell>
  );
}
