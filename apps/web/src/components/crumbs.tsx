import { Breadcrumb, type Crumb } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';

/** The PageHeader breadcrumb with locale-aware links (ADR 0022). */
export async function Crumbs({ items }: { items: readonly Crumb[] }) {
  const t = await getTranslations('shell');
  return <Breadcrumb label={t('breadcrumb')} items={items} link={Link} />;
}

/** "Sat 18 Jul 2027 · 6:30–11:30 PM CDT" in the event's time zone (CLAUDE.md time rules). */
export function eventWhen(ev: { startsAt: Date; endsAt: Date; timezone: string }, locale: string): string {
  const f = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return f.formatRange(ev.startsAt, ev.endsAt);
}
