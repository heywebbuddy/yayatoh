import { GUESTS_CHANNEL } from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey, realtimeChannelName } from '@yayatoh/platform';
import { GUEST_SEATS_CHANNEL, guestSeatingQuery } from '@yayatoh/seating';
import { buttonClass, EmptyState, filterChipClass, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GuestSeatingEditor } from '@/components/guest-seating/guest-seating-editor.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { seatGuestsAction, setVipTableAction, unseatGuestsAction } from './actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Seat guests (M4.3a): the guest list's parties at the tables of the event plan, or of the chart
 * a sub-event uses (`?sub=`). Three panes: the unseated queue, the map and the table details.
 * Only for orgs with the guests module (weddings; galas whose tables are named).
 */
export default async function GuestSeatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ sub?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'seating')) notFound();
  if (!data.modules.has('guests') || !can('guests:read')) notFound();
  const t = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  const subEventId = sp.sub && UUID.test(sp.sub) ? sp.sub : null;
  const view = await executeQuery(guestSeatingQuery, { eventId: ev.id, subEventId }, data.ctx, ports).catch(
    (err: { code?: string }) => {
      if (err.code === 'not_found') notFound();
      throw err;
    },
  );
  const here = `${base}/guests`;
  const chartName = subEventId
    ? (view.subEvents.find((s) => s.id === subEventId)?.name ?? '')
    : t('guestSeating.chart.event');
  return (
    <>
      <PageHeader title={t('guestSeating.title')} description={t('guestSeating.description')} />
      <SeatingTabs base={base} active="guests" finder={data.modules.has('seat_finder')} guests />
      {view.subEvents.length ? (
        <nav aria-label={t('guestSeating.chart.label')}>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {[{ id: null, name: t('guestSeating.chart.event') }, ...view.subEvents].map((s) => {
              const on = s.id === subEventId;
              return (
                <li key={s.id ?? 'event'}>
                  <Link
                    href={s.id ? `${here}?sub=${s.id}` : here}
                    aria-current={on ? 'page' : undefined}
                    className={filterChipClass(on)}
                  >
                    {s.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      {!view.doc ? (
        <EmptyState
          title={t('guestSeating.noPlan', { chart: chartName })}
          description={t('guestSeating.noPlanHint')}
          action={
            <Link href={base} className={buttonClass('secondary', 'sm')}>
              {t('guestSeating.toPlan')}
            </Link>
          }
        />
      ) : view.parties.length === 0 ? (
        <EmptyState
          title={t('guestSeating.noGuests')}
          description={t('guestSeating.noGuestsHint')}
          action={
            <Link href={`/o/${org}/e/${event}/guests`} className={buttonClass('secondary', 'sm')}>
              {t('guestSeating.toGuests')}
            </Link>
          }
        />
      ) : (
        <GuestSeatingEditor
          view={view}
          doc={view.doc}
          canWrite={can('seating:write')}
          seat={seatGuestsAction.bind(null, org, event, subEventId)}
          unseat={unseatGuestsAction.bind(null, org, event, subEventId)}
          setVip={setVipTableAction.bind(null, org, event, subEventId)}
          streams={{
            guests: realtimeUrl(realtimeChannelName(GUESTS_CHANNEL, data.org.id, ev.id)),
            seats: realtimeUrl(realtimeChannelName(GUEST_SEATS_CHANNEL, data.org.id, ev.id)),
          }}
        />
      )}
    </>
  );
}
