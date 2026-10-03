import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { guestSeatingQuery, solverSetupQuery } from '@yayatoh/seating';
import { buttonClass, EmptyState, filterChipClass, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SeatingSolver } from '@/components/seating-solver/seating-solver.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  acceptProposalAction,
  addSolverRuleAction,
  removeSolverRuleAction,
  updateSolverRuleAction,
} from './actions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Seating rules and the solver (M6.12a): the event's rules, then a proposal for everyone still
 * in the queue (the tabu search runs in a Web Worker), reviewed and edited as a list, accepted a
 * table at a time or all at once. Guests already seated are never moved. For orgs with the
 * guests and ai_seating modules; the chart chooser is the guest seating editor's (`?sub=`).
 */
export default async function SeatingSolverPage({
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
  if (!data.modules.has('guests') || !data.modules.has('ai_seating') || !can('guests:read')) notFound();
  const t = await getTranslations('seating');
  const base = `/o/${org}/e/${event}/seating`;
  const subEventId = sp.sub && UUID.test(sp.sub) ? sp.sub : null;
  const notFoundOnMissing = (err: { code?: string }) => {
    if (err.code === 'not_found') notFound();
    throw err;
  };
  const [view, problem] = await Promise.all([
    executeQuery(guestSeatingQuery, { eventId: ev.id, subEventId }, data.ctx, ports).catch(notFoundOnMissing),
    executeQuery(solverSetupQuery, { eventId: ev.id, subEventId }, data.ctx, ports).catch(notFoundOnMissing),
  ]);
  const here = `${base}/solver`;
  const chartName = subEventId
    ? (view.subEvents.find((s) => s.id === subEventId)?.name ?? '')
    : t('guestSeating.chart.event');
  return (
    <>
      <PageHeader title={t('solver.title')} description={t('solver.description')} />
      <SeatingTabs base={base} active="solver" finder={data.modules.has('seat_finder')} guests solver />
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
        <SeatingSolver
          view={view}
          problem={problem}
          canWrite={can('seating:write')}
          editorHref={subEventId ? `${base}/guests?sub=${subEventId}` : `${base}/guests`}
          addRule={addSolverRuleAction.bind(null, org, event)}
          updateRule={updateSolverRuleAction.bind(null, org, event)}
          removeRule={removeSolverRuleAction.bind(null, org, event)}
          accept={acceptProposalAction.bind(null, org, event, subEventId)}
        />
      )}
    </>
  );
}
