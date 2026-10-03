import { type MeetingDto, meetingIcs, myMeetingQuery } from '@yayatoh/engagement';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';
import { loadNetworkPage } from '@/server/networking.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * An agreed meeting as a calendar file (M5.8a), for either of its two people only (their proved
 * address). Times in UTC; the calendar shows them in the reader's zone.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; slug: string; meeting: string }> },
) {
  const { locale: raw, slug, meeting } = await params;
  const locale = routing.locales.find((l) => l === raw) ?? routing.defaultLocale;
  const p = UUID.test(meeting) ? await loadNetworkPage(slug) : null;
  if (p?.kind !== 'member') return new Response('Not found', { status: 404 });
  let m: MeetingDto;
  try {
    m = await executeQuery(myMeetingQuery, { ...p.at, meetingId: meeting }, p.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return new Response('Not found', { status: 404 });
    throw err;
  }
  const t = await getTranslations({ locale, namespace: 'networking.ics' });
  const place = m.tableNo ? t('placeTable', { place: m.location.name, table: m.tableNo }) : m.location.name;
  const body = meetingIcs({
    uid: `meeting-${m.id}@yayatoh`,
    startsAt: m.slot.startsAt,
    endsAt: m.slot.endsAt,
    stamp: new Date(),
    summary: t('summary', { name: m.person.displayName }),
    location: place,
    description: t('description', { event: p.target.eventName, place }),
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="meeting-${m.id}.ics"`,
      'cache-control': 'private, no-store',
    },
  });
}
