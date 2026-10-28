import type { PublicEntrySummaryDto } from '@yayatoh/cms';
import { buttonClass } from '@yayatoh/ui';
import {
  Armchair,
  BarChart3,
  CalendarPlus,
  Handshake,
  Megaphone,
  Network,
  QrCode,
  ScanLine,
  Sparkles,
  Ticket,
  TrendingUp,
  Users,
} from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { Reveal } from './reveal.tsx';

const H2 =
  'font-display text-[26px] leading-none font-black tracking-[-0.02em] uppercase md:text-[34px] [overflow-wrap:anywhere]';

/** Published posts of the marketplace content org, newest first; hidden when there are none. */
export async function BlogSection({
  posts,
  base,
  locale,
}: {
  posts: readonly (Pick<PublicEntrySummaryDto, 'slug' | 'title' | 'excerpt' | 'publishedAt'> & {
    coverUrl?: string | null;
  })[];
  base: string;
  locale: string;
}) {
  if (posts.length === 0) return null;
  const t = await getTranslations('homeSections.blog');
  const f = await getFormatter({ locale });
  return (
    <section aria-labelledby="home-blog" className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <h2 id="home-blog" className={H2}>
          {t('title')}
        </h2>
        <Link href="/blogs" className="shrink-0 text-body underline underline-offset-4">
          {t('all')}
        </Link>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
        {posts.slice(0, 3).map((p, i) => (
          <Reveal as="li" key={p.slug} delay={i}>
            <Link
              href={`${base}/blogs/${p.slug}`}
              className="group flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-5 transition duration-300 hover:-translate-y-1 hover:border-ember motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              {p.coverUrl ? (
                <img
                  src={p.coverUrl}
                  alt=""
                  loading="lazy"
                  className="aspect-[16/9] w-full rounded-tile object-cover"
                />
              ) : null}
              <time dateTime={p.publishedAt.toISOString()} className="text-caption text-ink-2">
                {f.dateTime(p.publishedAt, { dateStyle: 'medium' })}
              </time>
              <h3 className="text-[19px] leading-snug font-extrabold [overflow-wrap:anywhere]">{p.title}</h3>
              {p.excerpt ? <p className="line-clamp-3 text-body text-ink-2">{p.excerpt}</p> : null}
            </Link>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

export interface QuoteItem {
  readonly key: string;
  readonly quote: string;
  readonly name: string;
  readonly role: string | null;
  readonly photoUrl?: string | null;
  readonly rating?: number | null;
  readonly lang?: string;
}

/** Quotes edited by staff in the admin console (or, as a fallback, the content org's sections). */
export async function TestimonialsSection({ items }: { items: readonly QuoteItem[]; locale?: string }) {
  if (items.length === 0) return null;
  const t = await getTranslations('homeSections.testimonials');
  return (
    <section aria-labelledby="home-quotes" className="flex flex-col gap-6">
      <h2 id="home-quotes" className={H2}>
        {t('title')}
      </h2>
      <ul className="no-scrollbar m-0 flex list-none snap-x gap-4 overflow-x-auto p-0 pb-2">
        {items.map((s) => (
          <li
            key={s.key}
            lang={s.lang}
            className="flex w-[min(86vw,380px)] shrink-0 snap-start flex-col justify-between gap-5 rounded-card border border-line bg-surface p-6"
          >
            <figure className="m-0 flex flex-col gap-4">
              {s.rating ? (
                <p
                  className="m-0 text-[18px] tracking-widest text-ember"
                  role="img"
                  aria-label={t('rating', { count: s.rating })}
                >
                  {'★'.repeat(s.rating)}
                  <span className="text-line-strong">{'★'.repeat(5 - s.rating)}</span>
                </p>
              ) : null}
              <blockquote className="m-0 text-[17px] leading-relaxed text-ink [overflow-wrap:anywhere]">
                <span className="block font-display text-[38px] leading-none text-ember" aria-hidden="true">
                  &ldquo;
                </span>
                {s.quote}
              </blockquote>
              <figcaption className="flex items-center gap-3">
                {s.photoUrl ? (
                  <img
                    src={s.photoUrl}
                    alt=""
                    loading="lazy"
                    className="size-11 shrink-0 rounded-full object-cover"
                  />
                ) : null}
                <span className="flex flex-col">
                  <span className="font-extrabold">{s.name}</span>
                  {s.role ? <span className="text-caption text-ink-2">{s.role}</span> : null}
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STEP_ICONS = [CalendarPlus, Megaphone, ScanLine, TrendingUp] as const;

export async function HowItWorks() {
  const t = await getTranslations('homeSections.how');
  return (
    <section aria-labelledby="home-how" className="flex flex-col gap-6">
      <h2 id="home-how" className={H2}>
        {t('title')}
      </h2>
      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {(['s1', 's2', 's3', 's4'] as const).map((k, i) => {
          const Icon = STEP_ICONS[i] ?? CalendarPlus;
          return (
            <Reveal as="li" key={k} delay={i}>
              <div className="relative flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-5">
                <span className="font-display text-[44px] leading-none font-black text-ember/40">
                  {i + 1}
                </span>
                <Icon aria-hidden="true" className="size-6 text-ember" />
                <h3 className="text-[18px] font-extrabold">{t(`${k}.title`)}</h3>
                <p className="text-body text-ink-2">{t(`${k}.desc`)}</p>
              </div>
            </Reveal>
          );
        })}
      </ol>
    </section>
  );
}

const FEATURES = [
  ['ticketing', Ticket],
  ['seating', Armchair],
  ['checkin', QrCode],
  ['networking', Network],
  ['ai', Sparkles],
  ['sponsors', Handshake],
  ['analytics', BarChart3],
] as const;

export async function FeatureGrid() {
  const t = await getTranslations('homeSections.features');
  return (
    <section aria-labelledby="home-features" className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <h2 id="home-features" className={H2}>
          {t('title')}
        </h2>
        <Link href="/features" className="shrink-0 text-body underline underline-offset-4">
          &rarr;
        </Link>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(([k, Icon], i) => (
          <Reveal as="li" key={k} delay={i % 4}>
            <div className="group flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-5 transition duration-300 hover:-translate-y-1 hover:border-ember motion-reduce:transition-none motion-reduce:hover:translate-y-0">
              <span className="grid size-11 place-items-center rounded-full bg-ember text-white">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="text-[18px] font-extrabold">{t(`${k}.title`)}</h3>
              <p className="text-body text-ink-2">{t(`${k}.desc`)}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

/** Real counts from the listings; hidden while they would look small. */
export async function StatsBand({ events, organizers }: { events: number; organizers: number }) {
  if (events < 12 || organizers < 3) return null;
  const t = await getTranslations('homeSections.stats');
  const f = await getFormatter();
  const rows = [
    { n: events, label: t('events'), Icon: Ticket },
    { n: organizers, label: t('organizers'), Icon: Users },
  ];
  return (
    <section aria-label={t('events')} className="rounded-card border border-line bg-surface p-6">
      <dl className="m-0 grid grid-cols-2 gap-6 text-center">
        {rows.map(({ n, label, Icon }) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <Icon aria-hidden="true" className="size-6 text-ember" />
            <dd className="m-0 font-display text-[34px] leading-none font-black text-ember md:text-[48px]">
              {f.number(n)}+
            </dd>
            <dt className="text-caption text-ink-2">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

export async function TrustedBy({
  organizers,
}: {
  organizers: readonly { slug: string; name: string; href: string }[];
}) {
  if (organizers.length < 3) return null;
  const t = await getTranslations('homeSections.trusted');
  return (
    <section aria-labelledby="home-trusted" className="flex flex-col items-center gap-4 text-center">
      <h2 id="home-trusted" className="text-caption font-bold tracking-widest text-ink-2 uppercase">
        {t('title')}
      </h2>
      <ul className="m-0 flex list-none flex-wrap justify-center gap-3 p-0">
        {organizers.map((o) => (
          <li key={o.slug}>
            <Link
              href={o.href}
              className="inline-block rounded-full border border-line bg-surface px-4 py-2 text-[15px] font-extrabold transition-colors hover:border-ember"
            >
              {o.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function HomeFaq() {
  const t = await getTranslations('homeSections.faq');
  return (
    <section aria-labelledby="home-faq" className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h2 id="home-faq" className={H2}>
        {t('title')}
      </h2>
      <div className="flex flex-col gap-3">
        {(['1', '2', '3', '4', '5'] as const).map((n) => (
          <details key={n} className="group rounded-card border border-line bg-surface p-5 open:border-ember">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-extrabold [&::-webkit-details-marker]:hidden">
              {t(`q${n}`)}
              <span aria-hidden="true" className="text-ember transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 text-body text-ink-2">{t(`a${n}`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export async function FinalCta() {
  const t = await getTranslations('homeSections.cta');
  return (
    <section
      aria-labelledby="home-cta"
      className="flex flex-col items-center gap-5 rounded-[36px] bg-ember-soft p-8 text-center text-white md:p-14"
    >
      <h2 id="home-cta" className={`${H2} max-w-2xl`}>
        {t('title')}
      </h2>
      <p className="max-w-lg text-[17px] text-white/90">{t('lede')}</p>
      <Link href="/signup" className={buttonClass('white', 'lg')}>
        {t('button')}
      </Link>
    </section>
  );
}
