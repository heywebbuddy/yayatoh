'use client';

import { Button, buttonClass } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/** Anything that throws on a public page: a designed message, a retry and a way home. */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string; code?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  return (
    <main id="main" className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 md:px-6">
      <div className="relative isolate flex flex-col gap-4 overflow-hidden rounded-[36px] border border-line bg-surface p-6 md:p-12">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -end-24 -top-24 -z-10 size-72 rounded-full bg-ember opacity-30 blur-3xl"
        />
        <h1 className="m-0 max-w-3xl font-display text-[32px] leading-[1.05] font-black tracking-[-0.03em] uppercase md:text-[48px] [overflow-wrap:anywhere]">
          {t(errorMessageKey(error.code))}
        </h1>
        {error.digest ? (
          <p className="m-0 text-ink-2">{t('errors.reference', { id: error.digest })}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={reset}>
            {t('actions.tryAgain')}
          </Button>
          <Link href="/" className={buttonClass('secondary')}>
            {t('notFound.home')}
          </Link>
        </div>
      </div>
    </main>
  );
}
