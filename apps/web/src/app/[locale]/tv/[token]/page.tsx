import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TvBoard } from '@/components/command-center/tv-board.tsx';
import { tvBoard } from '@/server/tv.ts';

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * TV mode (M3.3a): a full-screen, read-only Command Center board for a venue screen, opened by a
 * display link (no sign-in). Large type, refreshed every few seconds; no money and no people.
 */
export default async function TvPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tv');
  const board = await tvBoard(token);
  if (!board)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-900 p-8 text-center text-white">
        <h1 className="text-[40px] font-light">{t('offTitle')}</h1>
        <p className="text-section text-zinc-300">{t('offDescription')}</p>
      </main>
    );
  return <TvBoard token={token} initial={board} locale={locale} />;
}
