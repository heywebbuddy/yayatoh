import { LOCALES } from '@yayatoh/contracts';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark.tsx';
import { Link } from '@/i18n/navigation.ts';
import { SOLUTION_KEYS } from './solutions.ts';

const col = 'flex flex-col gap-3';
const colTitle = 'font-display text-label font-black tracking-[0.12em] text-ink uppercase';
const colLink = 'inline-flex min-h-6 items-center text-body text-ink-2 hover:text-ink';

/**
 * The showcase footer: wordmark and app badges, menu / solutions / resources columns, the
 * language links, and the huge glowing wordmark across the very bottom.
 */
export async function ShowcaseFooter({ children }: { children?: ReactNode }) {
  const t = await getTranslations('showcase');
  const m = await getTranslations('market');
  const home = await getTranslations('home');
  return (
    <footer className="relative mt-24 overflow-hidden border-t border-line">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 pt-14 md:px-6">
        {children}
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div className={col}>
            <p className="inline-flex items-center gap-2 font-display text-[22px] font-black tracking-[-0.03em] uppercase">
              <BrandMark className="size-8" />
              {t('wordmark')}
            </p>
            <p className="max-w-xs text-body text-ink-2">{t('footer.tagline')}</p>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {(['appStore', 'googlePlay'] as const).map((k) => (
                <li
                  key={k}
                  className="inline-flex min-h-11 flex-col justify-center rounded-control border border-line px-4 leading-tight"
                >
                  <span className="text-[10px] font-bold tracking-wide text-ink-3 uppercase">
                    {t('footer.soon')}
                  </span>
                  <span className="text-body font-extrabold">{t(`footer.${k}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label={t('footer.menu')} className={col}>
            <h2 className={colTitle}>{t('footer.menu')}</h2>
            <Link href="/events" className={colLink}>
              {t('events')}
            </Link>
            <Link href="/venues" className={colLink}>
              {t('footer.venues')}
            </Link>
            <Link href="/series" className={colLink}>
              {t('footer.series')}
            </Link>
            <Link href="/my-tickets" className={colLink}>
              {t('myTickets')}
            </Link>
            <Link href="/pricing" className={colLink}>
              {t('pricing')}
            </Link>
          </nav>
          <nav aria-label={t('solutionsLabel')} className={col}>
            <h2 className={colTitle}>{t('solutionsLabel')}</h2>
            {SOLUTION_KEYS.map((k) => (
              <Link key={k} href={`/solutions/${k}`} className={colLink}>
                {t(`solutions.${k}.name`)}
              </Link>
            ))}
            <Link href="/features" className={colLink}>
              {t('footer.features')}
            </Link>
          </nav>
          <nav aria-label={t('footer.resources')} className={col}>
            <h2 className={colTitle}>{t('footer.resources')}</h2>
            <Link href="/help" className={colLink}>
              {t('footer.help')}
            </Link>
            <Link href="/contact" className={colLink}>
              {m('contact')}
            </Link>
            <Link href="/status" className={colLink}>
              {m('status')}
            </Link>
            <Link href="/privacy" className={colLink}>
              {home('privacyLink')}
            </Link>
            <Link href="/sub-processors" className={colLink}>
              {home('subProcessorsLink')}
            </Link>
          </nav>
        </div>
        <nav aria-label={m('language')}>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption">
            {LOCALES.map((l) => (
              <li key={l}>
                <a
                  href={`/lang/${l}`}
                  hrefLang={l}
                  lang={l}
                  className="inline-flex min-h-6 items-center text-ink-2 hover:text-ink"
                >
                  {new Intl.DisplayNames([l], { type: 'language' }).of(l) ?? l}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {/* The huge glowing wordmark. Decorative: the real one is in the column above. */}
      <p
        aria-hidden="true"
        className="animate-glow pointer-events-none mt-6 -mb-[0.16em] text-center font-display text-[15.5vw] leading-none font-black tracking-[-0.05em] text-ember uppercase select-none drop-shadow-[0_0_40px_var(--color-ember)]"
      >
        {t('wordmark')}
      </p>
    </footer>
  );
}
