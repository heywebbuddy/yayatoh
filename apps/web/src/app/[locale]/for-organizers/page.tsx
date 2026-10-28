import { publicPlanTiers } from '@yayatoh/billing';
import { platformTestimonials } from '@yayatoh/cms';
import { formatMoney, money } from '@yayatoh/kernel';
import { buttonClass, cx } from '@yayatoh/ui';
import { Check, Globe, Minus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ApplyForm } from '@/components/organizers/apply-form.tsx';
import { LandingTop } from '@/components/organizers/landing-top.tsx';
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
      <LandingTop moduleCount={moduleCount} video={video} tierCount={TIERS.length} />

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
          className="relative w-full min-w-0 overflow-x-auto rounded-[28px] border border-line"
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
