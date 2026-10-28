import { publicPlanTiers } from '@yayatoh/billing';
import { platformTestimonials } from '@yayatoh/cms';
import { formatMoney, money } from '@yayatoh/kernel';
import { buttonClass, cx } from '@yayatoh/ui';
import {
  BarChart3,
  Check,
  Globe,
  HeartHandshake,
  type LucideIcon,
  MessagesSquare,
  Minus,
  Palette,
  ScanLine,
  Sparkles,
  Store,
  Ticket,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApplyForm } from '@/components/organizers/apply-form.tsx';
import { HeroVideo } from '@/components/showcase/hero-video.tsx';
import { Reveal } from '@/components/showcase/reveal.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { Link } from '@/i18n/navigation.ts';
import { humanCheckWidget } from '@/server/human-check.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';
import { applyAction } from './actions.ts';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ mode?: string; plan?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const req = await requestHost();
  const t = await getTranslations({ locale, namespace: 'forOrganizers' });
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: '/for-organizers',
    title: t('meta.title'),
    description: t('meta.description'),
    image: `${req.origin}/api/og/home`,
  });
}

/** The tour, in order. `modules`: the plan features that deliver it (the first one gates the badge). */
const FEATURES: readonly { key: string; icon: LucideIcon }[] = [
  { key: 'ticketing', icon: Ticket },
  { key: 'website', icon: Palette },
  { key: 'checkin', icon: ScanLine },
  { key: 'sponsors', icon: Store },
  { key: 'networking', icon: MessagesSquare },
  { key: 'ai', icon: Sparkles },
  { key: 'donations', icon: HeartHandshake },
  { key: 'analytics', icon: BarChart3 },
];
const SOLUTIONS = ['conferences', 'galas', 'weddings', 'festivals', 'nonprofits', 'agencies'] as const;
const WHITE_LABEL = ['domain', 'branding', 'site', 'agency', 'api'] as const;
const STEPS = ['apply', 'review', 'invite', 'launch'] as const;
const FAQ = ['cost', 'review', 'whiteLabel', 'payments', 'data', 'migrate'] as const;
/** Plan tiers as sold: catalog key → the landing column and the form's plan value. */
const TIERS = [
  { key: 'tier_starter', id: 'starter' },
  { key: 'tier_pro', id: 'pro' },
  { key: 'tier_agency', id: 'white_label' },
  { key: 'tier_enterprise', id: 'enterprise' },
] as const;
/** Feature switches compared across the plans: real module keys of `billing.plan_modules`. */
const COMPARE = [
  'ticketing',
  'seating',
  'advanced_seating',
  'website',
  'registration',
  'checkin',
  'sessions',
  'speakers',
  'sponsors',
  'exhibitors',
  'chat',
  'ai',
  'donations',
  'analytics_pro',
  'integrations',
  'api_access',
  'whitelabel',
  'agency',
  'virtual',
] as const;
const HIGHLIGHTS = ['ticketing', 'website', 'checkin', 'chat', 'ai', 'donations'] as const;

const section = 'flex scroll-mt-28 flex-col gap-8';
const h2 =
  'text-ink m-0 max-w-3xl font-display text-[28px] leading-[1.05] font-black tracking-[-0.03em] uppercase md:text-[40px] [overflow-wrap:anywhere]';
const eyebrow = 'm-0 text-caption font-bold tracking-widest text-ember uppercase';
const lede = 'm-0 max-w-2xl text-[17px] leading-relaxed text-ink-2';
const card = 'text-ink rounded-[28px] border border-line bg-surface p-6';

/** A product "screenshot" stand-in: a window with the feature's own icon and animated bars. */
function Shot({ icon: Icon, tone }: { icon: LucideIcon; tone: number }) {
  const widths = ['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3'];
  return (
    <div
      aria-hidden="true"
      className="relative flex flex-col gap-3 overflow-hidden rounded-[20px] border border-line bg-surface-3 p-4"
    >
      <span className="absolute -end-10 -top-10 size-32 rounded-full bg-ember opacity-20 blur-2xl animate-breathe motion-reduce:animate-none" />
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-control bg-ember-soft text-white">
          <Icon className="size-5" />
        </span>
        <span className={cx('h-3 rounded-pill bg-line', widths[tone % 4])} />
      </div>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx('h-2.5 rounded-pill bg-line/70', widths[(tone + i + 1) % 4])} />
      ))}
    </div>
  );
}

export default async function ForOrganizersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('forOrganizers');
  const [tiers, quotes] = await Promise.all([publicPlanTiers(), platformTestimonials()]);
  const tierOf = (key: string) => tiers.find((x) => x.key === key);
  const has = (key: string, m: string) => tierOf(key)?.modules.includes(m) ?? false;
  const moduleCount = new Set(tiers.flatMap((x) => x.modules)).size;
  const initialMode = sp.mode === 'demo' ? 'demo' : 'apply';
  const planIds = ['starter', 'pro', 'white_label', 'enterprise'];
  const initialPlan = planIds.includes(sp.plan ?? '') ? (sp.plan as string) : 'unsure';
  const videoUrl = process.env.ORGANIZER_VIDEO_URL?.trim();
  const video = videoUrl && /^https:\/\//.test(videoUrl) ? videoUrl : null;
  /** What staff set in Plans & billing: only a plan switched on there shows prices (month and year, one currency). */
  const price = (key: string) => {
    const tier = tierOf(key);
    if (!tier?.active) return { state: 'pending' as const };
    if (tier.prices.length === 0) return { state: 'custom' as const };
    const currency = tier.prices.some((x) => x.currency === 'USD')
      ? 'USD'
      : (tier.prices[0]?.currency ?? 'USD');
    const fmt = (interval: 'month' | 'year') => {
      const x = tier.prices.find((y) => y.interval === interval && y.currency === currency);
      return x ? formatMoney(money(x.unitAmountMinor, x.currency), locale) : null;
    };
    return { state: 'priced' as const, month: fmt('month'), year: fmt('year') };
  };
  return (
    <ShowcaseShell>
      <header className="relative isolate flex min-h-[28rem] flex-col justify-end gap-6 overflow-hidden rounded-[36px] border border-line bg-surface p-6 md:p-12">
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
              className="pointer-events-none absolute -end-24 -top-24 -z-10 size-96 rounded-full bg-ember opacity-30 blur-3xl animate-breathe motion-reduce:animate-none"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-32 start-1/3 -z-10 size-72 rounded-full bg-rose opacity-20 blur-3xl animate-drift motion-reduce:animate-none"
            />
          </>
        )}
        <p className={eyebrow}>{t('hero.eyebrow')}</p>
        <h1 className="m-0 text-ink max-w-4xl font-display text-[34px] leading-[1.02] font-black tracking-[-0.03em] uppercase animate-rise motion-reduce:animate-none md:text-[64px] [overflow-wrap:anywhere]">
          {t('hero.title')}
        </h1>
        <p className={lede}>{t('hero.lede')}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/for-organizers#apply" className={buttonClass('ember', 'lg')}>
            {t('hero.apply')}
          </Link>
          <Link href="/for-organizers?mode=demo#apply" className={buttonClass('secondary', 'lg')}>
            {t('hero.demo')}
          </Link>
        </div>
      </header>

      <Reveal as="section" className={section}>
        <p className={eyebrow}>{t('trust.eyebrow')}</p>
        <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-4">
          {[
            [String(moduleCount), t('trust.modules')],
            ['13', t('trust.languages')],
            [String(SOLUTIONS.length), t('trust.eventTypes')],
            [String(TIERS.length), t('trust.plans')],
          ].map(([v, l]) => (
            <li key={l} className={card}>
              <p className="m-0 font-display text-[36px] leading-none font-black">{v}</p>
              <p className="m-0 mt-2 text-body text-ink-2">{l}</p>
            </li>
          ))}
        </ul>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t('trust.builtFor')}>
          {SOLUTIONS.map((s) => (
            <li
              key={s}
              className="inline-flex min-h-10 items-center rounded-pill border border-line px-4 text-body text-ink-2"
            >
              {t(`solutions.${s}.name`)}
            </li>
          ))}
        </ul>
      </Reveal>

      <section id="features" aria-labelledby="features-h" className={section}>
        <Reveal className="flex flex-col gap-3">
          <p className={eyebrow}>{t('features.eyebrow')}</p>
          <h2 id="features-h" className={h2}>
            {t('features.title')}
          </h2>
          <p className={lede}>{t('features.lede')}</p>
        </Reveal>
        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {FEATURES.map((f, i) => (
            <Reveal as="li" key={f.key}>
              <article className={cx('grid items-center gap-6 md:grid-cols-2', card)}>
                <div className={cx('flex flex-col gap-3', i % 2 ? 'md:order-2' : '')}>
                  <h3 className="m-0 font-display text-[22px] font-black uppercase">
                    {t(`features.${f.key}.title`)}
                  </h3>
                  <p className="m-0 text-body text-ink-2">{t(`features.${f.key}.how`)}</p>
                  <p className="m-0 text-body">
                    <strong>{t('features.benefit')}</strong> {t(`features.${f.key}.benefit`)}
                  </p>
                </div>
                <Shot icon={f.icon} tone={i} />
              </article>
            </Reveal>
          ))}
        </ol>
      </section>

      <section id="solutions" aria-labelledby="solutions-h" className={section}>
        <Reveal className="flex flex-col gap-3">
          <p className={eyebrow}>{t('solutions.eyebrow')}</p>
          <h2 id="solutions-h" className={h2}>
            {t('solutions.title')}
          </h2>
        </Reveal>
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s, i) => (
            <Reveal as="li" key={s} delay={i % 3}>
              <article className={cx(card, 'h-full')}>
                <h3 className="m-0 font-display text-[20px] font-black uppercase">
                  {t(`solutions.${s}.name`)}
                </h3>
                <p className="m-0 mt-2 text-body text-ink-2">{t(`solutions.${s}.body`)}</p>
              </article>
            </Reveal>
          ))}
        </ul>
      </section>

      <section id="white-label" aria-labelledby="wl-h" className={section}>
        <Reveal className="flex flex-col gap-3">
          <p className={eyebrow}>{t('whiteLabel.eyebrow')}</p>
          <h2 id="wl-h" className={h2}>
            {t('whiteLabel.title')}
          </h2>
          <p className={lede}>{t('whiteLabel.lede')}</p>
        </Reveal>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 lg:grid-cols-3">
          {WHITE_LABEL.map((k, i) => (
            <Reveal as="li" key={k} delay={i % 3}>
              <article className={cx(card, 'h-full')}>
                <Globe aria-hidden="true" className="mb-3 size-6 text-ember" />
                <h3 className="m-0 font-display text-[18px] font-black uppercase">
                  {t(`whiteLabel.${k}.title`)}
                </h3>
                <p className="m-0 mt-2 text-body text-ink-2">{t(`whiteLabel.${k}.body`)}</p>
              </article>
            </Reveal>
          ))}
        </ul>
      </section>

      <section id="how" aria-labelledby="how-h" className={section}>
        <Reveal className="flex flex-col gap-3">
          <p className={eyebrow}>{t('how.eyebrow')}</p>
          <h2 id="how-h" className={h2}>
            {t('how.title')}
          </h2>
        </Reveal>
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s} delay={i}>
              <div className={cx(card, 'h-full')}>
                <p className="m-0 font-display text-[40px] leading-none font-black text-ember">{i + 1}</p>
                <h3 className="m-0 mt-3 font-display text-[18px] font-black uppercase">
                  {t(`how.${s}.title`)}
                </h3>
                <p className="m-0 mt-2 text-body text-ink-2">{t(`how.${s}.body`)}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      <section id="plans" aria-labelledby="plans-h" className={section}>
        <Reveal className="flex flex-col gap-3">
          <p className={eyebrow}>{t('plans.eyebrow')}</p>
          <h2 id="plans-h" className={h2}>
            {t('plans.title')}
          </h2>
          <p className={lede}>{t('plans.lede')}</p>
        </Reveal>
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
          {TIERS.map((p, i) => {
            const pr = price(p.key);
            return (
              <Reveal as="li" key={p.id} delay={i}>
                <article
                  className={cx(card, 'flex h-full flex-col gap-4', p.id === 'pro' ? 'border-ember' : '')}
                >
                  <h3 className="m-0 font-display text-[22px] font-black uppercase">
                    {t(`plans.${p.id}.name`)}
                  </h3>
                  <p className="m-0 text-body text-ink-2">{t(`plans.${p.id}.body`)}</p>
                  <div className="flex flex-col gap-1">
                    <p className="m-0 font-display text-[28px] font-black">
                      {pr.state === 'priced' && (pr.month || pr.year)
                        ? pr.month
                          ? t('plans.perMonth', { price: pr.month })
                          : t('plans.perYear', { price: pr.year ?? '' })
                        : pr.state === 'custom'
                          ? t('plans.custom')
                          : t('plans.onApproval')}
                    </p>
                    {pr.state === 'priced' && pr.month && pr.year ? (
                      <p className="m-0 text-caption text-ink-2">{t('plans.orYearly', { price: pr.year })}</p>
                    ) : null}
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {HIGHLIGHTS.filter((m) => has(p.key, m)).map((m) => (
                      <li key={m} className="flex items-start gap-2 text-body">
                        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ember" />
                        {t(`modules.${m}`)}
                      </li>
                    ))}
                    {p.id === 'white_label' || p.id === 'enterprise'
                      ? (['whitelabel', 'agency'] as const)
                          .filter((m) => has(p.key, m))
                          .map((m) => (
                            <li key={m} className="flex items-start gap-2 text-body">
                              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ember" />
                              {t(`modules.${m}`)}
                            </li>
                          ))
                      : null}
                  </ul>
                  <Link
                    href={`/for-organizers?plan=${p.id}#apply`}
                    className={cx(
                      buttonClass(p.id === 'pro' ? 'ember' : 'secondary', 'md'),
                      'mt-auto self-start',
                    )}
                  >
                    {t('plans.choose', { plan: t(`plans.${p.id}.name`) })}
                  </Link>
                </article>
              </Reveal>
            );
          })}
        </ul>
        <p className="m-0 max-w-3xl text-caption text-ink-2">{t('plans.note')}</p>
      </section>

      <section id="compare" aria-labelledby="compare-h" className={section}>
        <Reveal className="flex flex-col gap-3">
          <h2 id="compare-h" className={h2}>
            {t('compare.title')}
          </h2>
        </Reveal>
        <section
          className="overflow-x-auto rounded-[28px] border border-line"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable)
          tabIndex={0}
          aria-label={t('compare.title')}
        >
          <table className="text-ink w-full min-w-[40rem] border-collapse text-start text-body">
            <thead>
              <tr className="text-caption text-ink-2">
                <th scope="col" className="px-4 py-3 text-start font-normal">
                  {t('compare.feature')}
                </th>
                {TIERS.map((p) => (
                  <th key={p.id} scope="col" className="px-4 py-3 text-center font-bold text-ink">
                    {t(`plans.${p.id}.name`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((m) => (
                <tr key={m} className="border-t border-line">
                  <th scope="row" className="px-4 py-3 text-start font-normal">
                    {t(`modules.${m}`)}
                  </th>
                  {TIERS.map((p) => (
                    <td key={p.id} className="px-4 py-3 text-center">
                      {has(p.key, m) ? (
                        <>
                          <Check aria-hidden="true" className="mx-auto size-5 text-ember" />
                          <span className="sr-only">{t('compare.included')}</span>
                        </>
                      ) : (
                        <>
                          <Minus aria-hidden="true" className="mx-auto size-5 text-ink-3" />
                          <span className="sr-only">{t('compare.notIncluded')}</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>

      <section id="stories" aria-labelledby="stories-h" className={section}>
        <Reveal className="flex flex-col gap-3">
          <p className={eyebrow}>{t('stories.eyebrow')}</p>
          <h2 id="stories-h" className={h2}>
            {t('stories.title')}
          </h2>
        </Reveal>
        {quotes.length === 0 ? (
          <p className={cx(card, 'm-0 text-body text-ink-2')}>{t('stories.empty')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 lg:grid-cols-3">
            {quotes.slice(0, 6).map((q) => (
              <Reveal as="li" key={q.id}>
                <figure className={cx(card, 'm-0 h-full')}>
                  <blockquote className="m-0 text-body">“{q.quote}”</blockquote>
                  <figcaption className="mt-3 text-caption text-ink-2">
                    {q.name}
                    {q.role ? ` · ${q.role}` : ''}
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </ul>
        )}
      </section>

      <section id="faq" aria-labelledby="faq-h" className={section}>
        <Reveal className="flex flex-col gap-3">
          <h2 id="faq-h" className={h2}>
            {t('faq.title')}
          </h2>
        </Reveal>
        <div className="flex max-w-3xl flex-col gap-2">
          {FAQ.map((k) => (
            <details
              key={k}
              className="group rounded-[20px] text-ink border border-line bg-surface px-5 py-3"
            >
              <summary className="min-h-10 cursor-pointer py-2 text-body font-bold marker:content-none">
                {t(`faq.${k}.q`)}
              </summary>
              <p className="m-0 pb-2 text-body text-ink-2">{t(`faq.${k}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      <section
        id="apply"
        aria-labelledby="apply-h"
        className={cx(section, 'rounded-[36px] border border-line bg-surface p-6 md:p-12')}
      >
        <div className="flex flex-col gap-3">
          <p className={eyebrow}>{t('form.eyebrow')}</p>
          <h2 id="apply-h" className={h2}>
            {t('form.title')}
          </h2>
          <p className={lede}>{t('form.lede')}</p>
        </div>
        <ApplyForm
          action={applyAction}
          humanCheck={humanCheckWidget()}
          initialMode={initialMode}
          initialPlan={initialPlan}
        />
      </section>
    </ShowcaseShell>
  );
}
