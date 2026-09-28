import { checkoutTarget, publicEventBySlug, publicOccurrences } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { finderResultQuery } from '@yayatoh/seating';
import { EmptyState, Label, PageHeader } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeatFinder } from '@/components/seat-finder.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { humanCheckWidget, openVenueMap, pendingCode, verifiedCode } from '@/server/seat-finder.ts';
import { codeFlowAction, findByNameAction, resetFinderAction } from './actions.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'seatFinder' });
  const ev = await publicEventBySlug(slug);
  return { title: ev ? `${t('title')} · ${ev.name}` : t('title') };
}

/**
 * The public seat finder (M1.7e), `/events/{slug}/seat-finder` — where printed posters' QR codes
 * and the legacy `/events/{slug}/attendee` link lead. Guests look themselves up and see their
 * seats on the venue map; the page never lists anyone.
 */
export default async function SeatFinderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { locale, slug } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const ev = await publicEventBySlug(slug);
  if (!ev) notFound();
  const t = await getTranslations();
  const target = await checkoutTarget(slug);
  // Multi-date events (M1.7g): a date may have its own seating chart; the guest picks the date.
  const dates = (await publicOccurrences(slug)).filter((d) => d.status === 'scheduled');
  const date = dates.find((d) => d.id === sp.date) ?? null;
  const map = target ? await openVenueMap(target.orgId, target.eventId, date?.id ?? null) : null;
  const day = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const when = formatEventDateRange(ev.startsAt.toISOString(), ev.endsAt.toISOString(), {
    locale,
    currency: ev.currency,
    timeZone: ev.timezone,
  });
  const header = (
    <PageHeader
      eyebrow={<Label>{t('seatFinder.eyebrow')}</Label>}
      title={ev.name}
      description={[when, ev.venueName].filter(Boolean).join(' · ')}
    />
  );
  if (!target || !map)
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        {header}
        <EmptyState
          title={t('seatFinder.closedTitle')}
          description={t('seatFinder.closedDescription')}
          action={
            <Link href={`/events/${slug}`} className="text-body underline">
              {t('seatFinder.toEvent')}
            </Link>
          }
        />
      </main>
    );
  const [viewId, codeId] =
    map.mode === 'code'
      ? await Promise.all([verifiedCode(target.eventId), pendingCode(target.eventId)])
      : [null, null];
  const verified = viewId
    ? await executeQuery(
        finderResultQuery,
        { eventId: target.eventId, codeId: viewId, occurrenceId: date?.id ?? null },
        createCtx({ orgId: target.orgId }),
        ports,
      ).catch((err) => {
        if (isDomainError(err) && err.code === 'not_found') return null;
        throw err;
      })
    : null;
  const initialStep = codeId ? 'code' : 'email';
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      {header}
      {dates.length > 1 ? (
        <nav aria-label={t('seatingDates.finderLabel')} className="flex flex-col gap-1.5">
          <p className="text-caption text-zinc-600">{t('seatingDates.finderIntro')}</p>
          <ul className="flex list-none flex-wrap gap-1.5">
            {dates.map((d) => {
              const on = date?.id === d.id;
              return (
                <li key={d.id}>
                  <Link
                    href={`/events/${slug}/seat-finder?date=${d.id}`}
                    aria-current={on ? 'page' : undefined}
                    className={`inline-flex min-h-9 items-center rounded-pill border px-3.5 text-[13px] ${on ? 'border-ink bg-ink text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    {day.format(d.startsAt)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      <SeatFinder
        key={`${map.mode}:${date?.id ?? ''}`}
        mode={map.mode}
        initialStep={initialStep}
        verified={verified}
        doc={map.doc}
        challenge={humanCheckWidget()}
        codeFlow={codeFlowAction.bind(null, slug)}
        byName={findByNameAction.bind(null, slug, date?.id ?? null)}
        reset={resetFinderAction.bind(null, slug)}
      />
      <Link href={`/events/${slug}`} className="self-start text-caption text-zinc-600 underline">
        {t('seatFinder.toEvent')}
      </Link>
    </main>
  );
}
