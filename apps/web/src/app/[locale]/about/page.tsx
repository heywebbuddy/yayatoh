import { platformAboutSettings } from '@yayatoh/cms';
import { buttonClass } from '@yayatoh/ui';
import {
  CalendarCheck,
  Compass,
  Heart,
  PartyPopper,
  Quote,
  Sparkles,
  Star,
  Ticket,
  Users,
  Zap,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { CountUp, MaskLines } from '@/components/organizers/motion.tsx';
import { PageCta } from '@/components/showcase/page-hero.tsx';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { Link } from '@/i18n/navigation.ts';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'sitePages.about' });
  const a = await platformAboutSettings();
  return { title: t('metaTitle'), description: a.lede || undefined };
}

const card =
  'flex flex-col gap-3 rounded-[28px] border border-line bg-surface p-6 transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 md:p-8';
const h2 =
  'm-0 font-display text-[26px] leading-tight font-black tracking-[-0.02em] uppercase md:text-[34px]';
const VALUE_ICONS = [Heart, Star, Zap, Sparkles, Users, Compass];

/** "12,000+" → { to: 12000, prefix: '', suffix: '+' }; non-numeric values stay plain text. */
function parseStat(value: string): { to: number; prefix: string; suffix: string } | null {
  const m = /^(\D*?)(\d[\d,.]*)(\D*)$/.exec(value.trim());
  if (!m) return null;
  // Decimals ("4.9") stay plain text; only thousands separators are stripped.
  if (/\.\d{1,2}$/.test(m[2] ?? '')) return null;
  const to = Number((m[2] ?? '').replace(/[,.]/g, ''));
  if (!Number.isFinite(to) || to > 1e9) return null;
  return { to, prefix: m[1] ?? '', suffix: m[3] ?? '' };
}

/** About us: the copy comes from the admin console ("Site content" → About us); "how it works" is translated. */
export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('sitePages.about');
  const a = await platformAboutSettings();
  const values = a.values.filter((v) => v.title.trim());
  const team = a.team.filter((m) => m.name.trim());
  const stats = a.stats.filter((s) => s.value.trim());
  const steps = [
    { icon: Compass, title: t('step1Title'), text: t('step1Text') },
    { icon: CalendarCheck, title: t('step2Title'), text: t('step2Text') },
    { icon: PartyPopper, title: t('step3Title'), text: t('step3Text') },
  ];
  return (
    <ShowcaseShell width="max-w-6xl">
      <header className="relative isolate flex flex-col gap-6 overflow-hidden rounded-[36px] border border-line bg-surface p-6 md:p-16">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -end-24 -top-24 -z-10 size-96 rounded-full bg-ember opacity-30 blur-3xl animate-breathe motion-reduce:animate-none"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 start-1/4 -z-10 size-80 rounded-full bg-rose opacity-20 blur-3xl animate-drift motion-reduce:animate-none"
        />
        <p className="m-0 flex items-center gap-2 text-caption font-bold tracking-widest text-ember uppercase">
          <Sparkles aria-hidden="true" className="size-4" />
          {t('eyebrow')}
        </p>
        <MaskLines
          as="h1"
          lines={[t('title')]}
          className="m-0 max-w-4xl font-display text-[38px] leading-[1.02] font-black tracking-[-0.03em] uppercase md:text-[72px] [overflow-wrap:anywhere]"
        />
        {a.lede ? <p className="m-0 max-w-2xl text-[18px] leading-relaxed text-ink-2">{a.lede}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Link href="/events" className={buttonClass('primary', 'lg')}>
            <Ticket aria-hidden="true" />
            {t('browse')}
          </Link>
          <Link href="/for-organizers" className={buttonClass('secondary', 'lg')}>
            {t('forOrganizers')}
          </Link>
        </div>
      </header>

      {stats.length > 0 ? (
        <Reveal>
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3">
            {stats.map((s) => {
              const n = parseStat(s.value);
              return (
                <li
                  key={`${s.value}-${s.label}`}
                  className="flex flex-col gap-1 rounded-[28px] bg-ember-soft p-6 text-white md:p-8"
                >
                  <span className="font-display text-[44px] leading-none font-black md:text-[56px]">
                    {n ? (
                      <>
                        {n.prefix}
                        <CountUp to={n.to} suffix={n.suffix} />
                      </>
                    ) : (
                      s.value
                    )}
                  </span>
                  <span className="text-body text-white/90">{s.label}</span>
                </li>
              );
            })}
          </ul>
        </Reveal>
      ) : null}

      {a.mission ? (
        <Reveal
          as="section"
          className="relative flex flex-col gap-4 rounded-[36px] border border-line bg-surface p-6 md:p-12"
        >
          <Quote aria-hidden="true" className="size-10 text-ember" />
          <h2 className="m-0 text-caption font-bold tracking-widest text-ember uppercase">{t('mission')}</h2>
          <p className="m-0 max-w-4xl font-display text-[24px] leading-snug font-extrabold md:text-[36px]">
            {a.mission}
          </p>
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

      <Reveal as="section" className="flex flex-col gap-5">
        <h2 className={h2}>{t('howTitle')}</h2>
        <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className={`${card} relative overflow-hidden`}>
              <span
                aria-hidden="true"
                className="absolute end-5 top-2 font-display text-[88px] leading-none font-black text-ink-2 opacity-10"
              >
                {i + 1}
              </span>
              <span className="grid size-12 place-items-center rounded-full bg-ember text-white">
                <s.icon aria-hidden="true" className="size-6" />
              </span>
              <h3 className="m-0 text-[20px] font-extrabold">{s.title}</h3>
              <p className="m-0 text-body text-ink-2">{s.text}</p>
            </li>
          ))}
        </ol>
      </Reveal>

      {values.length > 0 ? (
        <Reveal as="section" className="flex flex-col gap-5">
          <h2 className={h2}>{t('values')}</h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v, i) => {
              const Icon = VALUE_ICONS[i % VALUE_ICONS.length] ?? Heart;
              return (
                <li key={v.title} className={card}>
                  <span className="grid size-10 place-items-center rounded-full bg-ember text-white">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <h3 className="m-0 text-[18px] font-extrabold">{v.title}</h3>
                  <p className="m-0 text-body text-ink-2">{v.text}</p>
                </li>
              );
            })}
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
