import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { qrPath } from '@yayatoh/pdf';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrintButton } from '@/components/print-button.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { openVenueMap } from '@/server/seat-finder.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'seatFinderPoster' });
  const ev = await publicEventBySlug(slug);
  return { title: ev ? `${t('pageTitle')} · ${ev.name}` : t('pageTitle') };
}

/**
 * The seat-finder poster (M1.7e): print it (A4 or Letter) for the entrance. Its QR code is the
 * stable seat finder address, which works for as long as the event exists; the legacy
 * `/events/{slug}/attendee` address on older posters leads to the same place.
 */
export default async function SeatFinderPosterPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const ev = await publicEventBySlug(slug);
  if (!ev) notFound();
  const t = await getTranslations('seatFinderPoster');
  const target = await checkoutTarget(slug);
  const map = target ? await openVenueMap(target.orgId, target.eventId) : null;
  // The locale-neutral address: the phone's own language decides the page's (proxy).
  const origin = (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_ORIGIN ??
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const url = `${origin}/events/${ev.slug}/seat-finder`;
  const qr = qrPath(url);
  const when = formatEventDateRange(ev.startsAt.toISOString(), ev.endsAt.toISOString(), {
    locale,
    currency: ev.currency,
    timeZone: ev.timezone,
  });
  return (
    <main
      // Printed: always the light theme, whatever the screen uses (ADR 0022).
      data-theme="light"
      id="main"
      className="mx-auto flex min-h-dvh max-w-[190mm] flex-col items-center gap-6 bg-surface px-4 py-10 text-center text-ink print:min-h-0 print:py-0"
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/events/${ev.slug}/seat-finder`} className="text-caption text-ink-2 underline">
          {t('back')}
        </Link>
        <PrintButton label={t('print')} />
      </div>
      {map ? null : (
        <p
          role="note"
          className="w-full rounded-card border border-line px-4 py-3 text-body text-ink-2 print:hidden"
        >
          {t('closedNote')}
        </p>
      )}
      <p className="text-label uppercase tracking-[0.2em] text-ink-2">{ev.name}</p>
      <h1 className="text-[56px] leading-none font-extrabold tracking-[-0.04em] sm:text-[72px]">
        {t('title')}
      </h1>
      <p className="text-[18px] text-ink-2">{[when, ev.venueName].filter(Boolean).join(' · ')}</p>
      <svg
        role="img"
        aria-label={t('qrLabel', { url })}
        data-testid="poster-qr"
        data-url={url}
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        shapeRendering="crispEdges"
        className="aspect-square w-full max-w-[110mm] text-black"
      >
        <rect width={qr.size} height={qr.size} className="fill-white" />
        <path d={qr.d} fill="currentColor" />
      </svg>
      <ol className="flex list-none flex-col gap-2 p-0 text-[20px]">
        <li>{t('step1')}</li>
        <li>{map?.mode === 'name' ? t('step2Name') : t('step2Code')}</li>
        <li>{t('step3')}</li>
      </ol>
      <p className="text-body text-ink-2">
        {t('orVisit')} <span className="font-mono break-all text-ink">{url}</span>
      </p>
    </main>
  );
}
