import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { currentTheme } from '@/server/theme.ts';
import { BrandMark } from './brand-mark.tsx';
import { ThemeSwitch } from './theme-switch.tsx';

/** The sign-in and onboarding frame (ADR 0022): the wordmark home and the theme switch. */
export async function AuthBar() {
  const t = await getTranslations('brand');
  const theme = await currentTheme();
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
      <Link
        href="/"
        className="inline-flex min-h-10 items-center gap-2.5 rounded-control text-[19px] font-extrabold tracking-[-0.03em] text-ink"
      >
        <BrandMark className="size-7" />
        {t('wordmark')}
      </Link>
      <ThemeSwitch initial={theme} />
    </div>
  );
}
