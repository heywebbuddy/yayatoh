import { Alert, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AttendeeNetworking } from '@/components/attendee-networking.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';

const SECTIONS = ['overview', 'events', 'tickets', 'schedule', 'networking'] as const;

/**
 * Read-only preview of the attendee portal for organizers: the portal as a sample attendee would
 * see it for this event. It reads no real attendee, order or profile and creates nothing; the
 * sample ticket and counts are made up and every link is inert.
 */
export default async function AttendeePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { locale, org, event } = await params;
  const { section: raw } = await searchParams;
  setRequestLocale(locale);
  const { event: ev } = await loadEvent(org, event, 'details');
  const t = await getTranslations('attendeeDashboard');
  const tp = await getTranslations('attendeePreview');
  const section = (SECTIONS as readonly string[]).includes(raw ?? '')
    ? (raw as (typeof SECTIONS)[number])
    : 'overview';
  const range = formatEventDateRange(ev.startsAt.toISOString(), ev.endsAt.toISOString(), {
    locale,
    currency: ev.currency,
    timeZone: ev.timezone,
  });
  const sample = (
    <Card className="flex min-w-0 flex-col gap-3">
      <h2 className="break-words text-section">{ev.name}</h2>
      <p className="text-body text-ink-2">{range}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusDot status="success" label={tp('sampleStatus')} />
        <span className="text-caption">{t('ticketCount', { count: 1 })}</span>
      </div>
    </Card>
  );
  return (
    <>
      <Alert tone="info" title={tp('banner')}>
        {tp('bannerDetail')}
      </Alert>
      <PageHeader title={tp('title')} description={tp('description')} />
      <nav aria-label={tp('sections')} className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <Link
            key={s}
            href={`/o/${org}/e/${event}/attendee-preview${s === 'overview' ? '' : `?section=${s}`}`}
            aria-current={s === section ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded-control px-4 py-2 text-body font-bold text-ink-2 hover:bg-surface-3 aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary-ink"
          >
            {t(`nav.${s}`)}
          </Link>
        ))}
      </nav>
      <section aria-label={t(`nav.${section}`)} className="flex flex-col gap-4">
        {section === 'networking' ? (
          <AttendeeNetworking
            preview
            events={[
              {
                eventId: ev.id,
                slug: ev.slug,
                name: ev.name,
                optedIn: true,
                meetings: true,
                lobby: true,
                waiting: { connections: 2, meetings: 1, chats: 3, lobby: 5 },
              },
            ]}
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">{sample}</div>
        )}
      </section>
    </>
  );
}
