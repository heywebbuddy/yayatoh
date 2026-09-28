import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';
import type { SeatingDate } from '@/server/seating-dates.ts';

/**
 * Which chart the seating view shows (M1.7g): the event plan (every date without a chart of its
 * own) or one date. Plain links with `aria-current`, so they work by keyboard and without script.
 */
export function SeatingDatePicker({
  base,
  dates,
  selected,
  timeZone,
  locale,
}: {
  base: string;
  dates: readonly SeatingDate[];
  selected: string | null;
  timeZone: string;
  locale: string;
}) {
  const t = useTranslations('seatingDates');
  if (dates.length === 0) return null;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const link = (href: string, on: boolean, label: string, note: string) => (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={`inline-flex min-h-9 flex-col justify-center rounded-card border px-3 py-1 text-start text-[13px] ${on ? 'border-ink bg-ink text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
    >
      <span>{label}</span>
      <span className={on ? 'text-white' : 'text-zinc-500'}>{note}</span>
    </Link>
  );
  return (
    <nav aria-label={t('label')} className="flex flex-col gap-2">
      <p className="text-caption text-zinc-600">{t('intro')}</p>
      <ul className="flex list-none flex-wrap gap-1.5">
        <li>{link(base, selected === null, t('eventPlan'), t('eventPlanNote'))}</li>
        {dates.map((d) => (
          <li key={d.id}>
            {link(
              `${base}?date=${d.id}`,
              selected === d.id,
              when.format(d.startsAt),
              d.cancelled ? t('cancelled') : d.own ? t('ownChart') : t('usesPlan'),
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
