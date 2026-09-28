import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { eventSeatingQuery, seatAssignmentsQuery, seatingRulesQuery } from '@yayatoh/seating';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeatAssignments } from '@/components/seat-assignments.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { localizedPath } from '@/lib/seo/urls.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { assignSeatsAction, unassignSeatAction } from '../actions.ts';

/**
 * Assign guests (M1.7d): the unseated queue, tables and rows with who sits there, and the plan
 * to drop guests on. Everything the plan does by dragging, the lists do by keyboard.
 */
export default async function AssignSeatsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'seating')) notFound();
  const t = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  const [view, seating] = await Promise.all([
    executeQuery(seatAssignmentsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(eventSeatingQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  const rules = seating ? await executeQuery(seatingRulesQuery, { eventId: ev.id }, data.ctx, ports) : [];
  return (
    <>
      <PageHeader title={t('assign.title')} description={t('assign.description')} />
      <SeatingTabs base={base} active="assign" finder={data.modules.has('seat_finder')} />
      {view && seating ? (
        <SeatAssignments
          view={view}
          doc={seating.doc}
          canWrite={roleCan(data.role, 'events:write')}
          assign={assignSeatsAction.bind(null, org, event)}
          unassign={unassignSeatAction.bind(null, org, event)}
          rules={rules}
          startsAt={ev.startsAt}
          timeZone={ev.timezone}
          streamUrl={localizedPath(locale, `${base}/stream`)}
        />
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
