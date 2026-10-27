import { buttonClass } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SiteSections } from '@/components/marketing/site-sections.tsx';
import { JaggedCircle } from '@/components/showcase/hero.tsx';
import { ShowcaseShell } from '@/components/showcase/shell.tsx';
import { isSolutionKey, SOLUTION_KEYS, SOLUTIONS } from '@/components/showcase/solutions.ts';
import { Link } from '@/i18n/navigation.ts';
import { cachedSections, platformContentOrg } from '@/server/help.ts';
import { pageLocale } from '@/server/locale.ts';
import { requestHost } from '@/server/request-origin.ts';
import { apexOrigin, publicMetadata } from '@/server/seo.ts';

type Props = { params: Promise<{ locale: string; vertical: string }> };

export function generateStaticParams() {
  return SOLUTION_KEYS.map((vertical) => ({ vertical }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, vertical } = await params;
  if (!isSolutionKey(vertical)) return {};
  const t = await getTranslations({ locale, namespace: 'showcase.solutions' });
  const req = await requestHost();
  return publicMetadata({
    req,
    locale,
    canonicalOrigin: apexOrigin(req),
    path: `/solutions/${vertical}`,
    title: t(`${vertical}.metaTitle`),
    description: t(`${vertical}.lede`),
    image: `${req.origin}/api/og/home`,
  });
}

/**
 * A vertical landing page (`/solutions/organizations|weddings|galas|conferences`): what Yayatoh
 * does for that kind of event, the features that really exist for it, and where to start. Copy
 * lives in the message files; the platform CMS can add its own blocks beneath the features by
 * publishing "features" sections whose slug starts with `solutions-{vertical}`.
 */
export default async function SolutionPage({ params }: Props) {
  const { locale, vertical } = await params;
  pageLocale(locale);
  if (!isSolutionKey(vertical)) notFound();
  const solution = SOLUTIONS[vertical];
  const t = await getTranslations('showcase.solutions');
  const ts = await getTranslations('showcase');
  const Icon = solution.icon;
  const content = await platformContentOrg(await requestHost());
  const cms = content
    ? (await cachedSections(content.orgId, 'features', locale)).filter((s) =>
        s.slug.startsWith(`solutions-${vertical}`),
      )
    : [];
  return (
    <ShowcaseShell>
      <section
        aria-labelledby="solution-title"
        className="grid items-center gap-10 pt-10 md:grid-cols-[1.15fr_1fr] md:pt-16"
      >
        <div className="flex flex-col items-start gap-6">
          <p className="rounded-pill border border-line px-3.5 py-1.5 text-label font-extrabold tracking-[0.12em] text-ink-2 uppercase">
            {t(`${vertical}.name`)}
          </p>
          <h1
            id="solution-title"
            className="font-display text-[clamp(32px,5.4vw,68px)] leading-[0.98] font-black tracking-[-0.04em] text-balance uppercase"
          >
            {t(`${vertical}.title`)}
          </h1>
          <p className="max-w-xl text-[17px] text-ink-2">{t(`${vertical}.lede`)}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClass('ember', 'lg', 'px-8')}>
              {t('createEvent')}
            </Link>
            <Link href="/features" className={buttonClass('secondary', 'lg', 'rounded-pill px-6')}>
              {t('seeFeatures')}
            </Link>
          </div>
        </div>
        <JaggedCircle className="mx-auto w-[min(70vw,380px)]">
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <Icon aria-hidden="true" className="size-[34%]" strokeWidth={1.5} />
          </div>
        </JaggedCircle>
      </section>

      <section aria-labelledby="solution-features" className="flex flex-col gap-8">
        <h2
          id="solution-features"
          className="font-display text-[26px] leading-none font-black tracking-[-0.02em] uppercase md:text-[34px]"
        >
          {t('featuresTitle')}
        </h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {solution.features.map((f) => {
            const FIcon = f.icon;
            return (
              <li
                key={f.key}
                className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6 transition-transform duration-200 hover:-translate-y-1 motion-reduce:transition-none"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-12 items-center justify-center rounded-pill bg-ember text-white"
                >
                  <FIcon className="size-6" strokeWidth={2} />
                </span>
                <h3 className="text-[18px] font-extrabold">{t(`${vertical}.features.${f.key}.title`)}</h3>
                <p className="text-body text-ink-2">{t(`${vertical}.features.${f.key}.desc`)}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="solution-steps" className="flex flex-col gap-8">
        <h2
          id="solution-steps"
          className="font-display text-[26px] leading-none font-black tracking-[-0.02em] uppercase md:text-[34px]"
        >
          {t('stepsTitle')}
        </h2>
        <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
          {(['one', 'two', 'three'] as const).map((k, i) => (
            <li key={k} className="flex flex-col gap-3 rounded-card bg-surface-2 p-6">
              <span className="font-display text-[44px] leading-none font-black text-ember">{i + 1}</span>
              <h3 className="text-[18px] font-extrabold">{t(`${vertical}.steps.${k}.title`)}</h3>
              <p className="text-body text-ink-2">{t(`${vertical}.steps.${k}.desc`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {cms.length > 0 ? <SiteSections sections={cms} layout="stack" locale={locale} /> : null}

      <section
        aria-labelledby="solution-cta"
        className="flex flex-col items-center gap-5 rounded-[36px] bg-ember-soft p-8 text-center text-white md:p-14"
      >
        <h2
          id="solution-cta"
          className="font-display text-[28px] leading-[1.02] font-black tracking-[-0.03em] uppercase md:text-[44px]"
        >
          {t('ctaTitle')}
        </h2>
        <p className="max-w-lg text-[16px] text-white/85">{t('ctaLede')}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/signup" className={buttonClass('white', 'lg', 'px-8')}>
            {t('createEvent')}
          </Link>
          <Link href="/pricing" className={buttonClass('inverse', 'lg', 'rounded-pill px-6')}>
            {ts('pricing')}
          </Link>
        </div>
      </section>
    </ShowcaseShell>
  );
}
