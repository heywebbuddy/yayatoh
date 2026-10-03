import { sessionAttendanceQuery, sessionDoorChoicesQuery } from '@yayatoh/checkin';
import { eventRolesOf } from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { eventRoleCan, roleCan } from '@yayatoh/tenancy';
import { Button, buttonClass, Card, EmptyState, PageHeader, SectionHeader, StatusPill } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { SessionDoorForm } from '@/components/session-door-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createSessionDoorAction, setSelfCheckinAction } from './actions.ts';

/**
 * M5.6a session check-in: each session door with its room count, attendance, overrides and
 * dwell time, and its self check-in flyer; organizers add doors (one per session or more).
 */
export default async function SessionCheckinPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'onsite');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'onsite')) notFound();
  const t = await getTranslations();
  const base = `/o/${org}/e/${event}/onsite`;
  const back = (
    <Link href={base} className="self-start text-body underline">
      {t('sessionCheckin.back')}
    </Link>
  );
  const canScan =
    roleCan(data.role, 'checkin:scan') || eventRoleCan(await eventRolesOf(data.ctx, ev.id), 'checkin:scan');
  if (!canScan) {
    return (
      <>
        <PageHeader title={t('sessionCheckin.title')} />
        <EmptyState title={t('checkin.noAccessTitle')} description={t('checkin.noAccessDescription')} />
      </>
    );
  }
  const manage = can('events:write');
  const doors = await executeQuery(sessionAttendanceQuery, { eventId: ev.id }, data.ctx, ports);
  const sessions = manage
    ? await executeQuery(sessionDoorChoicesQuery, { eventId: ev.id }, data.ctx, ports)
    : [];
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const span = (a: Date, b: Date) => when.formatRange(a, b);
  return (
    <>
      <PageHeader title={t('sessionCheckin.title')} description={t('sessionCheckin.description')} />
      {back}
      <AutoRefresh seconds={15} />
      <section aria-labelledby="session-doors-heading" className="flex flex-col gap-3">
        <SectionHeader id="session-doors-heading" title={t('sessionCheckin.doors')} count={doors.length} />
        {doors.length === 0 ? (
          <EmptyState
            title={t('sessionCheckin.emptyTitle')}
            description={t(manage ? 'sessionCheckin.emptyManage' : 'sessionCheckin.emptyScan')}
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {doors.map((d) => {
              const full = d.capacity !== null && d.inRoom >= d.capacity;
              return (
                <li key={d.checkpointId}>
                  <Card className="flex flex-col gap-3" data-testid={`session-door-${d.name}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <h3 className="text-card">{d.name}</h3>
                        <p className="text-body text-ink-2">
                          {d.title} · {span(d.startsAt, d.endsAt)}
                          {d.roomName ? ` · ${d.roomName}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {d.archived ? (
                          <StatusPill tone="neutral" label={t('checkpoints.archived')} />
                        ) : full ? (
                          <StatusPill tone="waiting" label={t('sessionCheckin.full')} />
                        ) : null}
                        {d.enrollmentRequired ? (
                          <StatusPill tone="info" label={t('sessionCheckin.enrollmentRequired')} />
                        ) : null}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="flex flex-col">
                        <dt className="text-caption text-ink-2">{t('sessionCheckin.inRoom')}</dt>
                        <dd className="text-section tabular-nums" data-testid="in-room">
                          {d.capacity !== null
                            ? t('sessionCheckin.ofCapacity', {
                                count: formatNumber(d.inRoom, locale),
                                capacity: formatNumber(d.capacity, locale),
                              })
                            : formatNumber(d.inRoom, locale)}
                        </dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-caption text-ink-2">{t('sessionCheckin.attended')}</dt>
                        <dd className="text-section tabular-nums" data-testid="attended">
                          {formatNumber(d.attended, locale)}
                        </dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-caption text-ink-2">{t('sessionCheckin.overrides')}</dt>
                        <dd className="text-section tabular-nums" data-testid="overrides">
                          {formatNumber(d.overrides, locale)}
                        </dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-caption text-ink-2">{t('sessionCheckin.avgDwell')}</dt>
                        <dd className="text-section tabular-nums" data-testid="dwell">
                          {d.avgDwellMs === null
                            ? '—'
                            : t('sessionCheckin.minutes', { count: Math.round(d.avgDwellMs / 60_000) })}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                      <p className="min-w-0 flex-1 text-body text-ink-2">
                        {d.selfCheckinToken
                          ? t('sessionCheckin.selfOn', { count: d.selfCheckins })
                          : t('sessionCheckin.selfOff')}
                      </p>
                      {d.selfCheckinToken ? (
                        <Link
                          href={`${base}/sessions/${d.checkpointId}/flyer`}
                          className={buttonClass('secondary', 'sm')}
                          aria-label={t('sessionCheckin.printFlyerFor', { name: d.name })}
                        >
                          {t('sessionCheckin.printFlyer')}
                        </Link>
                      ) : null}
                      {manage ? (
                        <form
                          action={setSelfCheckinAction.bind(
                            null,
                            org,
                            event,
                            d.checkpointId,
                            !d.selfCheckinToken,
                          )}
                        >
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={t(
                              d.selfCheckinToken ? 'sessionCheckin.turnOffFor' : 'sessionCheckin.turnOnFor',
                              { name: d.name },
                            )}
                          >
                            {t(d.selfCheckinToken ? 'sessionCheckin.turnOff' : 'sessionCheckin.turnOn')}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {manage ? (
        <section aria-labelledby="session-door-add-heading" className="flex flex-col gap-3">
          <SectionHeader id="session-door-add-heading" title={t('sessionCheckin.setUp')} />
          {sessions.length === 0 ? (
            <EmptyState
              title={t('sessionCheckin.noSessionsTitle')}
              description={t('sessionCheckin.noSessionsDescription')}
              action={
                <Link href={`/o/${org}/e/${event}/sessions`} className={buttonClass('primary', 'md')}>
                  {t('sessionCheckin.openProgram')}
                </Link>
              }
            />
          ) : (
            <Card>
              <SessionDoorForm
                sessions={sessions.map((s) => ({
                  id: s.id,
                  label: `${s.title} · ${span(s.startsAt, s.endsAt)}${s.roomName ? ` · ${s.roomName}` : ''}`,
                }))}
                action={createSessionDoorAction.bind(null, org, event)}
              />
            </Card>
          )}
        </section>
      ) : null}
    </>
  );
}
