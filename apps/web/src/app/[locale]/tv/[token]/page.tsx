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
      <main
        data-theme="dark"
        className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-page p-8 text-center text-ink"
      >
        <h1 className="m-0 text-title text-ink">{t('offTitle')}</h1>
        <p className="m-0 text-[20px] font-semibold text-ink-2">{t('offDescription')}</p>
      </main>
    );
  return <TvBoard token={token} initial={board} locale={locale} />;
}
