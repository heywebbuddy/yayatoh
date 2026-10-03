import { attendeeLabelsQuery } from '@yayatoh/attendees';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import {
  eventSeatingQuery,
  seatAssignmentsQuery,
  seatGroupsQuery,
  seatingRulesQuery,
} from '@yayatoh/seating';
import { buttonClass, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeatAssignments } from '@/components/seat-assignments.tsx';
import { SeatGroups } from '@/components/seat-groups.tsx';
import { SeatingDatePicker } from '@/components/seating-dates.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { seatingDates } from '@/server/seating-dates.ts';
import {
  allocateGroupAction,
  assignSeatsAction,
  releaseGroupAction,
  seatGroupAction,
  unassignSeatAction,
} from '../actions.ts';

/**
 * Assign guests (M1.7d): the unseated queue, tables and rows with who sits there, and the plan
 * to drop guests on. Everything the plan does by dragging, the lists do by keyboard.
 */
export default async function AssignSeatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'seating')) notFound();
  const t = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  // Per-date charts (M1.7g): guests are seated on the chart the chosen date uses.
  const { dates, date } = await seatingDates(data, ev.id, sp.date);
  const dateId = date?.id ?? null;
  const [view, seating] = await Promise.all([
    executeQuery(seatAssignmentsQuery, { eventId: ev.id, occurrenceId: dateId }, data.ctx, ports),
    executeQuery(eventSeatingQuery, { eventId: ev.id, occurrenceId: dateId }, data.ctx, ports),
  ]);
  const rules = seating ? await executeQuery(seatingRulesQuery, { eventId: ev.id }, data.ctx, ports) : [];
  const [groups, labels] = seating
    ? await Promise.all([
        executeQuery(seatGroupsQuery, { eventId: ev.id, occurrenceId: dateId }, data.ctx, ports),
        data.modules.has('attendees')
          ? executeQuery(attendeeLabelsQuery, { eventId: ev.id }, data.ctx, ports)
          : Promise.resolve([]),
      ])
    : [[], []];
  const canWrite = can('seating:write');
  return (
    <>
      <PageHeader title={t('assign.title')} description={t('assign.description')} />
      <SeatingTabs
        base={base}
        active="assign"
        finder={data.modules.has('seat_finder')}
        guests={data.modules.has('guests')}
        date={dateId}
      />
      <SeatingDatePicker
        base={`${base}/assign`}
        dates={dates}
        selected={dateId}
        timeZone={ev.timezone}
        locale={locale}
      />
      {view && seating ? (
        <>
          <SeatAssignments
            view={view}
            doc={seating.doc}
            canWrite={canWrite}
            assign={assignSeatsAction.bind(null, org, event, dateId)}
            unassign={unassignSeatAction.bind(null, org, event, dateId)}
            rules={rules}
            timeZone={ev.timezone}
            startsAt={date?.startsAt ?? ev.startsAt}
            streamUrl={localizedPath(locale, `${base}/stream${dateId ? `?date=${dateId}` : ''}`)}
          />
          <SeatGroups
            groups={groups}
            items={view.items.map((i) => ({
              id: i.id,
              kind: i.kind,
              label: i.label,
              free: i.free,
              capacity: i.capacity,
            }))}
            labels={labels.map((l) => l.label)}
            canWrite={canWrite}
            allocate={allocateGroupAction.bind(null, org, event, dateId)}
            release={releaseGroupAction.bind(null, org, event, dateId)}
            seat={seatGroupAction.bind(null, org, event, dateId)}
          />
        </>
      ) : (
        <EmptyState
          title={t('assign.noPlan')}
          action={
            <Link href={base} className={buttonClass('secondary', 'sm')}>
              {t('assign.toPlan')}
            </Link>
          }
        />
      )}
    </>
  );
}
