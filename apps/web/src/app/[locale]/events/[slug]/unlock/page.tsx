import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessCodeEntry } from '@/components/access-code-entry.tsx';
import { unlockEventAction } from '../actions.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'accessEntry' });
  return { title: t('title'), robots: { index: false } };
}

/**
 * Entering an access code for a private event (M1.4d). Shown for any address and never looks the
 * event up, so it can't reveal whether a private event exists; the code decides.
 */
export default async function UnlockEventPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('accessEntry');
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-[32px] leading-tight font-light tracking-[-0.04em]">{t('title')}</h1>
      <p className="text-body text-zinc-500">{t('gateDescription')}</p>
      <AccessCodeEntry action={unlockEventAction.bind(null, slug)} idPrefix="gate" />
    </main>
  );
}
