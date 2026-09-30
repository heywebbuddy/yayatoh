import type { PublicOccurrenceDto } from '@yayatoh/events';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

/**
 * M1.4b: the public date picker of a multi-date event. Plain links (`?date=<id>#passes`), so it
 * works without JavaScript and by keyboard; sold-out, cancelled and past dates are listed but not
 * selectable. Times are in the event's timezone.
 */
export async function DatePicker({
  slug,
  dates,
  chosen,
  locale,
  timeZone,
  now,
  waitlist = false,
}: {
  slug: string;
  dates: readonly PublicOccurrenceDto[];
  chosen: string | null;
  locale: string;
  timeZone: string;
  now: Date;
  /** M3.10a: a sold-out date links to its waitlist. */
  waitlist?: boolean;
}) {
  const t = await getTranslations('publicEvent');
  const tw = await getTranslations('waitlist');
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const shown = dates.filter((d) => d.endsAt > now).slice(0, 120);
  return (
    <nav aria-labelledby="dates-heading" className="flex flex-col gap-3">
      <h2 id="dates-heading" className="text-[28px] font-normal tracking-[-0.03em]">
        {t('chooseDate')}
      </h2>
      <p className="text-caption text-zinc-500">
        {t('datesTimezone', { timezone: timeZone.replace(/_/g, ' ') })}
      </p>
      {shown.length === 0 ? (
        <p className="text-body text-zinc-600">{t('noUpcomingDates')}</p>
      ) : (
        <ul className="flex list-none flex-wrap gap-2 p-0">
          {shown.map((d) => {
            const label = fmt.formatRange(d.startsAt, d.endsAt);
            const unavailable =
              d.status === 'cancelled' ? t('dateCancelled') : d.soldOut ? t('dateSoldOut') : null;
            const current = d.id === chosen;
            return (
              <li key={d.id}>
                {unavailable ? (
                  <span className="inline-flex min-h-11 flex-col justify-center rounded-card border border-zinc-200 bg-zinc-50 px-4 py-2 text-caption text-zinc-500">
                    <span id={`date-${d.id}`} className="line-through">
                      {label}
                    </span>
                    <span>{unavailable}</span>
                    {waitlist && d.status === 'scheduled' && d.soldOut ? (
                      <Link
                        href={`/events/${slug}/waitlist?date=${d.id}`}
                        // Named like the pass links; the date it is for is its description.
                        aria-describedby={`date-${d.id}`}
                        className="inline-flex min-h-6 items-center text-zinc-900 underline underline-offset-2"
                      >
                        {tw('joinLink')}
                      </Link>
                    ) : null}
                  </span>
                ) : (
                  <Link
                    href={`/events/${slug}?date=${d.id}#passes`}
                    aria-current={current ? 'true' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-card border px-4 py-2 text-body ${current ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400'}`}
                  >
                    {label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
