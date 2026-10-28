import { platformHero } from '@yayatoh/cms';
import { buttonClass } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Carousel } from '@/components/showcase/carousel.tsx';
import { CategoryRail } from '@/components/showcase/category-rail.tsx';
import { ShowcaseHero } from '@/components/showcase/hero.tsx';
import { loadShowcaseHome } from '@/components/showcase/home-data.ts';
import { BuyerFaq, FinalCta } from '@/components/showcase/home-sections.tsx';
import { OrganizersPanel } from '@/components/showcase/organizers-panel.tsx';
import { PosterCard } from '@/components/showcase/poster-card.tsx';
import { railItems, sectionLabel } from '@/components/showcase/rail-items.ts';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { Link } from '@/i18n/navigation.ts';
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
  // Staff-managed hero text (admin console) overrides the default headline.
  const hero = await platformHero();
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
      <BuyerFaq />
      <FinalCta />
      {devAuthEnabled() ? (
        <Link className={buttonClass('secondary', 'md', 'self-center')} href="/dev/login">
          {tm('home.demoCta')}
        </Link>
      ) : null}
    </ShowcaseShell>
  );
}
