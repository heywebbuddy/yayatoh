import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { finderPosterQuery } from '@yayatoh/seating';
import { roleCan } from '@yayatoh/tenancy';
import { EmptyState } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PrintButton } from '@/components/print-button.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'seatPoster' });
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/**
 * The "find your table" name list for the door (M1.5f): every seated guest A–Z with their table
 * and seat, printable (A4 or Letter). Organizer-only: it lists names, so it lives in the console
 * (outside its chrome, so only the list prints) and needs `attendees:read`.
 */
export default async function SeatPosterPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  if (!roleCan(data.role, 'attendees:read') || !data.modules.has('seat_finder')) notFound();
  const t = await getTranslations('seatPoster');
  const poster = await executeQuery(finderPosterQuery, { eventId: ev.id, locale }, data.ctx, ports).catch(
    (err) => {
      if (isDomainError(err) && (err.code === 'forbidden' || err.code === 'module_not_enabled')) notFound();
      throw err;
    },
  );
  // Letter headings (A, B, …) in the organizer's language; names keep their own script.
  const groups = new Map<string, typeof poster.people>();
  for (const p of poster.people) {
    const letter = (p.name.trim()[0] ?? '#').toLocaleUpperCase(locale);
    groups.set(letter, [...(groups.get(letter) ?? []), p]);
  }
  const seatText = (s: (typeof poster.people)[number]['seats'][number]) =>
    t(s.itemKind === 'table' ? 'tableSeat' : 'rowSeat', { item: s.itemLabel, seat: s.seatLabel });
  return (
    <main
      // Printed: always the light theme, whatever the screen uses (ADR 0022).
      data-theme="light"
      id="main"
      className="mx-auto flex min-h-dvh max-w-[190mm] flex-col gap-6 bg-surface px-4 py-10 text-ink print:py-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/o/${org}/e/${event}/seating/finder`} className="text-caption text-ink-2 underline">
          {t('back')}
        </Link>
        <PrintButton label={t('print')} />
      </div>
      <header className="flex flex-col gap-2 text-center">
        <p className="text-label uppercase tracking-[0.2em] text-ink-2">{ev.name}</p>
        <h1 className="text-[48px] leading-none font-extrabold tracking-[-0.04em]">{t('title')}</h1>
        <p className="text-body text-ink-2">{t('subtitle')}</p>
      </header>
      {poster.people.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <div className="columns-1 gap-8 sm:columns-2">
          {[...groups].map(([letter, people]) => (
            <section key={letter} aria-labelledby={`letter-${letter}`} className="mb-4 break-inside-avoid">
              <h2 id={`letter-${letter}`} className="border-b border-line pb-1 text-section">
                {letter}
              </h2>
              <ul className="flex list-none flex-col p-0">
                {people.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-body"
                  >
                    <span>{p.name}</span>
                    <span className="text-end font-mono tabular-nums">
                      {p.seats.map(seatText).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {poster.unseated > 0 ? (
        <p className="text-caption text-ink-2 print:hidden">{t('unseated', { count: poster.unseated })}</p>
      ) : null}
    </main>
  );
}
