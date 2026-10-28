import { buttonClass, cx } from '@yayatoh/ui';
import { ArrowUpRight, BarChart3, Clock, Rocket, ShieldCheck, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { HeroVideo } from '@/components/showcase/hero-video.tsx';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { Link } from '@/i18n/navigation.ts';
import { CountUp, MaskLines, Parallax, Rise, StickyShowcase } from './motion.tsx';

const FEATURES = [
  'ticketing',
  'checkout',
  'website',
  'checkin',
  'sponsors',
  'networking',
  'ai',
  'donations',
  'analytics',
  'marketing',
  'team',
  'languages',
] as const;
/** Real screens, captured from the running app with demo data (`public/organizers/shots`). */
const SHOT: Record<(typeof FEATURES)[number], string> = {
  ticketing: 'seating',
  checkout: 'checkout',
  website: 'website',
  checkin: 'checkin',
  sponsors: 'sponsors',
  networking: 'networking',
  ai: 'ai',
  donations: 'donations',
  analytics: 'analytics',
  marketing: 'marketing',
  team: 'team',
  languages: 'languages',
};
const BENEFITS = [
  { key: 'sell', icon: Rocket, tone: 'bg-lavender' },
  { key: 'time', icon: Clock, tone: 'bg-sand' },
  { key: 'pro', icon: Sparkles, tone: 'bg-blush' },
  { key: 'paid', icon: ShieldCheck, tone: 'bg-mint' },
  { key: 'know', icon: BarChart3, tone: 'bg-sky' },
] as const;
const TEMPLATES = [
  { key: 'gala', tone: 'bg-lavender' },
  { key: 'conference', tone: 'bg-sand' },
  { key: 'concert', tone: 'bg-blush' },
  { key: 'wedding', tone: 'bg-mint' },
  { key: 'tour', tone: 'bg-sky' },
] as const;
const TYPES = [
  { key: 'wedding', href: '/solutions/weddings', shot: 'website' },
  { key: 'gala', href: '/solutions/galas', shot: 'donations' },
  { key: 'concert', href: '/solutions/galas', shot: 'seating' },
  { key: 'conference', href: '/solutions/conferences', shot: 'sponsors' },
  { key: 'community', href: '/solutions/organizations', shot: 'marketing' },
  { key: 'tour', href: '/solutions/organizations', shot: 'ticketing' },
  { key: 'corporate', href: '/solutions/organizations', shot: 'analytics' },
] as const;

const SITE_HOST = 'yayatoh.com/o/webbuddy';
const eyebrow = 'm-0 text-caption font-bold tracking-widest text-ember uppercase';
const headBase =
  'm-0 font-display leading-[0.95] font-black tracking-[-0.04em] uppercase [overflow-wrap:anywhere]';
const bigHead = `${headBase} text-[clamp(2.2rem,7vw,5.5rem)]`;

function Frame({ src, alt, eager }: { src: string; alt: string; eager?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-line bg-surface-2 shadow-2xl">
      <div
        className="flex items-center gap-1.5 border-b border-line bg-surface px-4 py-2.5"
        aria-hidden="true"
      >
        <span className="size-2.5 rounded-full bg-ember" />
        <span className="size-2.5 rounded-full bg-flame" />
        <span className="size-2.5 rounded-full bg-lime" />
      </div>
      <img
        src={`/organizers/shots/${src}.jpg`}
        alt={alt}
        width={1440}
        height={900}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        className="block h-auto w-full"
      />
    </div>
  );
}

/**
 * The first half of /for-organizers: hero, marquee, benefits, the sticky feature showcase,
 * templates, the event-type word list and the website preview. Headlines rise through a mask and
 * pictures move with the scroll (framer-motion, applied after mount: no inline style in server
 * HTML); every text is plain server HTML.
 */
export async function LandingTop({
  moduleCount,
  video,
  tierCount,
}: {
  moduleCount: number;
  video: string | null;
  tierCount: number;
}) {
  const t = await getTranslations('forOrganizers');
  const words = t('marquee.words').split(' • ');
  const stats = [
    { n: moduleCount, label: t('stats.modules'), tone: 'bg-grape text-white' },
    { n: 13, label: t('stats.languages'), tone: 'bg-flame text-black' },
    { n: TEMPLATES.length, label: t('stats.templates'), tone: 'bg-sand text-black' },
    { n: tierCount, label: t('stats.plans'), tone: 'bg-blush text-black' },
  ];
  return (
    <>
      <header className="relative isolate grid min-h-[34rem] items-center gap-8 overflow-hidden rounded-[40px] border border-line bg-surface p-6 md:grid-cols-[1.15fr_0.85fr] md:p-14">
        {video ? (
          <HeroVideo
            src={video}
            title={t('hero.videoTitle')}
            playLabel={t('hero.play')}
            pauseLabel={t('hero.pause')}
          />
        ) : (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -end-24 -top-24 -z-10 size-[28rem] rounded-full bg-ember opacity-30 blur-3xl animate-breathe motion-reduce:animate-none"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-32 start-1/4 -z-10 size-80 rounded-full bg-grape opacity-25 blur-3xl animate-drift motion-reduce:animate-none"
            />
          </>
        )}
        <div className="flex flex-col items-start gap-6">
          <p className={eyebrow}>{t('hero.eyebrow')}</p>
          <MaskLines
            as="h1"
            lines={[t('hero.line1'), t('hero.line2'), t('hero.line3')]}
            className={cx(headBase, 'text-ink text-[clamp(2rem,5vw,4.4rem)]')}
          />
          <p className="m-0 max-w-xl text-[17px] leading-relaxed text-ink-2">{t('hero.lede')}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/for-organizers#apply" className={buttonClass('ember', 'lg')}>
              {t('hero.apply')}
            </Link>
            <Link href="/for-organizers?mode=demo#apply" className={buttonClass('secondary', 'lg')}>
              {t('hero.demo')}
            </Link>
          </div>
        </div>
        <div aria-hidden="true" className="relative hidden h-[26rem] md:block">
          <span className="absolute start-6 top-6 size-44 rounded-full bg-grape opacity-70 blur-2xl animate-drift motion-reduce:animate-none" />
          <span className="absolute end-4 bottom-4 size-52 rounded-full bg-ember opacity-60 blur-2xl animate-breathe motion-reduce:animate-none" />
          <Parallax distance={90} className="absolute start-0 top-0 w-[78%] -rotate-6">
            <Frame src="analytics" alt="" eager />
          </Parallax>
          <Parallax distance={-70} className="absolute end-0 top-24 w-[70%] rotate-3">
            <Frame src="seating" alt="" eager />
          </Parallax>
          <Parallax distance={50} className="absolute start-10 bottom-0 w-[55%] rotate-1">
            <Frame src="donations" alt="" eager />
          </Parallax>
        </div>
      </header>

      <section aria-label={t('marquee.label')} className="-mx-4 overflow-hidden md:-mx-6">
        <div
          className="flex w-max animate-marquee gap-10 whitespace-nowrap py-2 motion-reduce:animate-none"
          aria-hidden="true"
        >
          {[...words, ...words, ...words, ...words].map((w, i) => (
            <span
              key={i}
              className="font-display text-[clamp(1.6rem,4vw,3rem)] font-black text-ink-3 uppercase"
            >
              {w} <span className="text-ember">✦</span>
            </span>
          ))}
        </div>
        <p className="sr-only">{words.join(', ')}</p>
      </section>

      <section
        id="benefits"
        aria-labelledby="benefits-h"
        className="scroll-mt-28 rounded-[40px] bg-white p-6 text-black md:p-14"
      >
        <p className={eyebrow}>{t('benefits.eyebrow')}</p>
        <MaskLines
          id="benefits-h"
          lines={[t('benefits.line1'), t('benefits.line2')]}
          className={cx(bigHead, 'mt-4 text-black')}
        />
        <ul className="m-0 mt-10 grid list-none gap-4 p-0 md:grid-cols-6">
          {BENEFITS.map((b, i) => (
            <Reveal as="li" key={b.key} delay={i} className={cx(i < 2 ? 'md:col-span-3' : 'md:col-span-2')}>
              <article className={cx('flex h-full flex-col gap-3 rounded-[28px] p-7', b.tone)}>
                <b.icon aria-hidden="true" className="size-8" />
                <h3 className="m-0 font-display text-[24px] font-black uppercase">
                  {t(`benefits.${b.key}.title`)}
                </h3>
                <p className="m-0 text-body text-black/75">{t(`benefits.${b.key}.body`)}</p>
              </article>
            </Reveal>
          ))}
        </ul>
        <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-4">
          {stats.map((s) => (
            <li key={s.label} className={cx('flex flex-col gap-1 rounded-[28px] p-6', s.tone)}>
              <CountUp
                to={s.n}
                className="font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-none font-black"
              />
              <span className="text-body">{s.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="features" aria-labelledby="features-h" className="flex scroll-mt-28 flex-col gap-10">
        <div className="flex flex-col gap-4">
          <p className={eyebrow}>{t('showcase.eyebrow')}</p>
          <MaskLines
            id="features-h"
            lines={[t('showcase.line1'), t('showcase.line2')]}
            className={cx(bigHead, 'text-ink')}
          />
          <p className="m-0 max-w-2xl text-[17px] leading-relaxed text-ink-2">{t('showcase.lede')}</p>
        </div>
        <StickyShowcase
          label={t('showcase.list')}
          steps={FEATURES.map((k, i) => (
            <div key={k} className="flex flex-col gap-4">
              <p className="m-0 font-display text-[clamp(3rem,8vw,6rem)] leading-none font-black text-ember">
                {String(i + 1).padStart(2, '0')}
              </p>
              <h3 className="m-0 font-display text-[clamp(1.6rem,3.4vw,2.6rem)] leading-tight font-black text-ink uppercase">
                {t(`showcase.features.${k}.title`)}
              </h3>
              <p className="m-0 text-[17px] leading-relaxed text-ink-2">{t(`showcase.features.${k}.what`)}</p>
              <div>
                <p className="m-0 mb-2 text-caption font-bold tracking-widest text-ink-3 uppercase">
                  {t('showcase.how')}
                </p>
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                  {(['s1', 's2', 's3'] as const).map((s, n) => (
                    <li key={s} className="flex items-start gap-3 text-body text-ink">
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-ember-soft text-caption font-bold text-white">
                        {n + 1}
                      </span>
                      {t(`showcase.features.${k}.${s}`)}
                    </li>
                  ))}
                </ol>
              </div>
              <p className="m-0 rounded-[20px] border border-line bg-surface p-4 text-body text-ink">
                <strong>{t('showcase.outcome')}:</strong> {t(`showcase.features.${k}.outcome`)}
              </p>
            </div>
          ))}
          panels={FEATURES.map((k) => (
            <Frame key={k} src={SHOT[k]} alt={t(`showcase.features.${k}.title`)} />
          ))}
        />
      </section>

      <section
        id="templates"
        aria-labelledby="templates-h"
        className="flex scroll-mt-28 flex-col gap-8 rounded-[40px] bg-white p-6 text-black md:p-14"
      >
        <div className="flex flex-col gap-4">
          <p className={eyebrow}>{t('templates.eyebrow')}</p>
          <MaskLines
            id="templates-h"
            lines={[t('templates.line1'), t('templates.line2')]}
            className={cx(bigHead, 'text-black')}
          />
          <p className="m-0 max-w-2xl text-[17px] leading-relaxed text-black/70">{t('templates.lede')}</p>
        </div>
        <ul className="no-scrollbar m-0 flex list-none snap-x gap-4 overflow-x-auto p-0 pb-2">
          {TEMPLATES.map((x, i) => (
            <li key={x.key} className="w-[280px] shrink-0 snap-start md:w-[330px]">
              <Reveal delay={i % 5} className="h-full">
                <article
                  className={cx(
                    'group flex h-full min-h-[22rem] flex-col gap-4 rounded-[32px] p-7 transition-transform duration-300 hover:-translate-y-2 motion-reduce:transition-none',
                    x.tone,
                  )}
                >
                  <p className="m-0 font-display text-caption font-black tracking-widest uppercase opacity-70">
                    {t('templates.sets')}
                  </p>
                  <h3 className="m-0 font-display text-[28px] leading-tight font-black uppercase">
                    {t(`templates.${x.key}.name`)}
                  </h3>
                  <p className="m-0 text-body text-black/75">{t(`templates.${x.key}.body`)}</p>
                  <ul className="m-0 mt-auto flex list-none flex-wrap gap-2 p-0">
                    {(['tag1', 'tag2', 'tag3'] as const).map((g) => (
                      <li key={g} className="rounded-pill bg-white/70 px-3 py-1 text-caption font-bold">
                        {t(`templates.${x.key}.${g}`)}
                      </li>
                    ))}
                  </ul>
                  <span
                    aria-hidden="true"
                    className="inline-flex size-11 items-center justify-center self-end rounded-full bg-black text-white transition-transform group-hover:rotate-45 motion-reduce:transition-none"
                  >
                    <ArrowUpRight className="size-5" />
                  </span>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      <section id="types" aria-labelledby="types-h" className="flex scroll-mt-28 flex-col gap-8">
        <div className="flex flex-col gap-4">
          <p className={eyebrow}>{t('types.eyebrow')}</p>
          <MaskLines
            id="types-h"
            lines={[t('types.line1'), t('types.line2')]}
            className={cx(bigHead, 'text-ink')}
          />
        </div>
        <ol className="m-0 flex list-none flex-col p-0">
          {TYPES.map((x, i) => (
            <li key={x.key} className="border-t border-line last:border-b">
              <Rise delay={0.03 * i}>
                <Link
                  href={x.href}
                  className="group flex min-h-20 items-center gap-3 py-4 transition-colors hover:text-ember focus-visible:text-ember md:gap-8"
                >
                  <span className="w-10 shrink-0 font-display text-body font-black text-ink-3">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 font-display text-[clamp(1.5rem,7vw,6.5rem)] leading-none font-black text-ink uppercase transition-colors group-hover:text-ember">
                    {t(`types.${x.key}`)}
                  </span>
                  <img
                    src={`/organizers/shots/${x.shot}.jpg`}
                    alt=""
                    width={320}
                    height={200}
                    loading="lazy"
                    decoding="async"
                    className="hidden h-16 w-0 shrink-0 rounded-pill object-cover object-top opacity-0 transition-all duration-500 group-hover:w-40 group-hover:opacity-100 group-focus-visible:w-40 group-focus-visible:opacity-100 motion-reduce:transition-none md:block"
                  />
                  <span className="ms-auto inline-flex items-center gap-2 text-body font-bold text-ink-2">
                    <span className="hidden md:inline">{t('types.open')}</span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-6 transition-transform group-hover:rotate-45 motion-reduce:transition-none"
                    />
                  </span>
                </Link>
              </Rise>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="preview"
        aria-labelledby="preview-h"
        className="grid scroll-mt-28 items-center gap-10 rounded-[40px] bg-white p-6 text-black md:grid-cols-[0.9fr_1.1fr] md:p-14"
      >
        <div className="flex flex-col items-start gap-5">
          <p className={eyebrow}>{t('preview.eyebrow')}</p>
          <MaskLines
            id="preview-h"
            lines={[t('preview.line1'), t('preview.line2')]}
            className={cx(bigHead, 'text-black')}
          />
          <p className="m-0 max-w-md text-[17px] leading-relaxed text-black/70">{t('preview.lede')}</p>
          <a
            href="/organizers/webbuddy"
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-black px-6 font-bold text-white hover:bg-black/85"
          >
            {t('preview.open')}
            <ArrowUpRight aria-hidden="true" className="size-5" />
            <span className="sr-only">({t('preview.newTab')})</span>
          </a>
        </div>
        <div
          role="img"
          aria-label={t('preview.frameLabel')}
          className="relative h-[34rem] overflow-hidden rounded-[28px] border border-black/10 bg-black shadow-2xl"
        >
          <div
            className="absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 bg-black/80 px-4 py-2.5 backdrop-blur"
            aria-hidden="true"
          >
            <span className="size-2.5 rounded-full bg-ember" />
            <span className="size-2.5 rounded-full bg-flame" />
            <span className="size-2.5 rounded-full bg-lime" />
            <span className="ms-3 rounded-pill bg-white/10 px-3 py-0.5 text-caption text-white/70">
              {SITE_HOST}
            </span>
          </div>
          <Parallax distance={520} className="absolute inset-x-0 top-8">
            <img
              src="/organizers/shots/site-org.jpg"
              alt=""
              width={1440}
              height={1800}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full"
            />
          </Parallax>
        </div>
      </section>
    </>
  );
}
