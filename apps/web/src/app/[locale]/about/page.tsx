import { platformAboutSettings } from '@yayatoh/cms';
import { Heart, Sparkles, Ticket, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { PageCta, PageHero } from '@/components/showcase/page-hero.tsx';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'sitePages.about' });
  const a = await platformAboutSettings();
  return { title: t('metaTitle'), description: a.lede || undefined };
}

const card = 'flex flex-col gap-3 rounded-[28px] border border-line bg-surface p-6 md:p-8';
const h2 =
  'm-0 font-display text-[26px] leading-tight font-black tracking-[-0.02em] uppercase md:text-[34px]';

/** About us: every text below comes from the admin console ("Site content" → About us). */
export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('sitePages.about');
  const a = await platformAboutSettings();
  const values = a.values.filter((v) => v.title.trim());
  const team = a.team.filter((m) => m.name.trim());
  const stats = a.stats.filter((s) => s.value.trim());
  return (
    <ShowcaseShell width="max-w-6xl">
      <PageHero eyebrow={t('eyebrow')} title={t('title')} lede={a.lede || undefined} icon={Sparkles} />
      {a.mission ? (
        <Reveal as="section" className="flex flex-col gap-4">
          <h2 className={h2}>{t('mission')}</h2>
          <p className="m-0 max-w-4xl font-display text-[22px] leading-snug font-extrabold md:text-[30px]">
            {a.mission}
          </p>
        </Reveal>
      ) : null}
      {stats.length > 0 ? (
        <Reveal>
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3">
            {stats.map((s) => (
              <li
                key={`${s.value}-${s.label}`}
                className="flex flex-col gap-1 rounded-[28px] bg-ember-soft p-6 text-white"
              >
                <span className="font-display text-[44px] leading-none font-black">{s.value}</span>
                <span className="text-body text-white/90">{s.label}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      ) : null}
      {a.story ? (
        <Reveal as="section" className="flex flex-col gap-4">
          <h2 className={h2}>{t('story')}</h2>
          <Markdown
            source={a.story}
            className="flex max-w-3xl flex-col gap-4 text-[18px] leading-8 text-ink-2"
          />
        </Reveal>
      ) : null}
      {values.length > 0 ? (
        <Reveal as="section" className="flex flex-col gap-5">
          <h2 className={h2}>{t('values')}</h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v) => (
              <li key={v.title} className={card}>
                <span className="grid size-10 place-items-center rounded-full bg-ember text-white">
                  <Heart aria-hidden="true" className="size-5" />
                </span>
                <h3 className="m-0 text-[18px] font-extrabold">{v.title}</h3>
                <p className="m-0 text-body text-ink-2">{v.text}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      ) : null}
      {a.attendees || a.organizers ? (
        <Reveal as="section" className="flex flex-col gap-5">
          <h2 className={h2}>{t('offer')}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {a.attendees ? (
              <div className={card}>
                <Ticket aria-hidden="true" className="size-7 text-ember" />
                <h3 className="m-0 text-[20px] font-extrabold">{t('forAttendees')}</h3>
                <p className="m-0 text-body text-ink-2">{a.attendees}</p>
              </div>
            ) : null}
            {a.organizers ? (
              <div className={card}>
                <Users aria-hidden="true" className="size-7 text-ember" />
                <h3 className="m-0 text-[20px] font-extrabold">{t('forOrganizers')}</h3>
                <p className="m-0 text-body text-ink-2">{a.organizers}</p>
              </div>
            ) : null}
          </div>
        </Reveal>
      ) : null}
      {team.length > 0 ? (
        <Reveal as="section" className="flex flex-col gap-5">
          <h2 className={h2}>{t('team')}</h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((m) => (
              <li key={m.name} className={card}>
                <span
                  aria-hidden="true"
                  className="grid size-14 place-items-center rounded-full bg-ember font-display text-[22px] font-black text-white"
                >
                  {m.name.trim().charAt(0).toUpperCase()}
                </span>
                <h3 className="m-0 text-[18px] font-extrabold">{m.name}</h3>
                {m.role ? (
                  <p className="m-0 text-caption font-bold tracking-widest text-ember uppercase">{m.role}</p>
                ) : null}
                {m.bio ? <p className="m-0 text-body text-ink-2">{m.bio}</p> : null}
              </li>
            ))}
          </ul>
        </Reveal>
      ) : null}
      <PageCta
        {...(a.ctaTitle ? { title: a.ctaTitle } : {})}
        {...(a.ctaLabel && a.ctaHref ? { label: a.ctaLabel, href: a.ctaHref } : {})}
      />
    </ShowcaseShell>
  );
}
