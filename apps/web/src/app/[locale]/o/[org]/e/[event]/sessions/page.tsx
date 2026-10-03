import { liveSessionsQuery } from '@yayatoh/engagement';
import { listOccurrencesQuery } from '@yayatoh/events';
import { executeQuery, utcToZonedInput } from '@yayatoh/kernel';
import { agendaQuery, groupByDay, type SessionDto } from '@yayatoh/program';
import { Button, buttonClass, Card, EmptyState, Label, PageHeader, StatusPill } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AgendaPublishing,
  AgendaWarnings,
  SessionAgendaForm,
  SessionAgendaLine,
  TypesAndGroups,
} from '@/components/agenda-console.tsx';
import { ActionButtonForm } from '@/components/portal-admin-forms.tsx';
import { type FieldSpec, ProgramForm, ScheduleWarning } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { agendaWarningMessages } from '@/server/agenda.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage, warningMessages } from '@/server/program.ts';
import { placeDraftSessionAction } from '../speakers/cfp/actions.ts';
import {
  createRoomAction,
  createSessionAction,
  createTrackAction,
  deleteRoomAction,
  deleteSessionAction,
  deleteTrackAction,
  updateSessionAction,
} from './actions.ts';

/**
 * Sessions (M1.4f): the agenda as a keyboard-friendly list grouped by day in the event's
 * timezone, with conflict warnings, plus rooms and tracks. List mode is the accessible
 * alternative to any grid.
 */
export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, ev, program, canWrite, canReadPeople } = await loadProgramPage(org, event, 'sessions');
  const t = await getTranslations();
  const tp = await getTranslations('program');
  const tcfp = await getTranslations('cfp');
  const dates = (await executeQuery(listOccurrencesQuery, { eventId: ev.id }, data.ctx, ports)).filter(
    (d) => d.status === 'scheduled',
  );
  // M5.2a: agenda v2 (types, included/optional, groups, capacity counter, publishing).
  const agenda = await executeQuery(agendaQuery, { eventId: ev.id }, data.ctx, ports);
  const agendaMessages = await agendaWarningMessages(agenda.warnings, program, agenda);
  // M5.7a: sessions with live polls and Q&A on.
  const live = new Set(await executeQuery(liveSessionsQuery, { eventId: ev.id }, data.ctx, ports));
  const tl = await getTranslations('engagement.moderator');
  const tz = ev.timezone;
  const time = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const dayLabel = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const dateLabel = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const isPublic =
    ['published', 'postponed', 'cancelled', 'completed'].includes(ev.status) && ev.visibility !== 'private';
  const errors = {
    title: tp('errors.title'),
    startsAt: tp('errors.startsAt'),
    endsAt: tp('errors.endsAt'),
    capacity: tp('errors.capacity'),
    // M5.2b: a capacity below the places people hold.
    capacity_below_enrolled: tp('errors.capacityBelowEnrolled'),
    outside_date: tp('errors.outside_date'),
    cancelled: tp('errors.cancelled'),
    unknown: tp('errors.unknown'),
    too_many: tp('errors.too_many'),
    name: tp('errors.name'),
    'conflict.name': tp('errors.nameTaken'),
  };
  const sessionFields = (s?: SessionDto): FieldSpec[] => [
    {
      kind: 'text',
      name: 'title',
      label: tp('sessionTitle'),
      required: true,
      maxLength: 160,
      defaultValue: s?.title,
    },
    ...(dates.length > 0
      ? [
          {
            kind: 'select' as const,
            name: 'occurrenceId',
            label: tp('date'),
            hint: tp('dateHint'),
            defaultValue: s?.occurrenceId ?? '',
            options: [
              { value: '', label: tp('anyDate') },
              ...dates.map((d) => ({ value: d.id, label: dateLabel.format(d.startsAt) })),
            ],
          },
        ]
      : []),
    {
      kind: 'datetime-local',
      name: 'startsAt',
      label: tp('startsAt'),
      required: true,
      hint: tp('timeHint', { timezone: tz.replace(/_/g, ' ') }),
      defaultValue: s ? utcToZonedInput(s.startsAt, tz) : undefined,
    },
    {
      kind: 'datetime-local',
      name: 'endsAt',
      label: tp('endsAt'),
      required: true,
      defaultValue: s ? utcToZonedInput(s.endsAt, tz) : undefined,
    },
    {
      kind: 'select',
      name: 'roomId',
      label: tp('room'),
      defaultValue: s?.roomId ?? '',
      options: [
        { value: '', label: tp('noRoom') },
        ...program.rooms.map((r) => ({ value: r.id, label: r.name })),
      ],
    },
    {
      kind: 'select',
      name: 'trackId',
      label: tp('track'),
      defaultValue: s?.trackId ?? '',
      options: [
        { value: '', label: tp('noTrack') },
        ...program.tracks.map((r) => ({ value: r.id, label: r.name })),
      ],
    },
    {
      kind: 'checkboxes',
      name: 'speakerIds',
      label: tp('speakers'),
      defaultValues: s?.speakerIds ?? [],
      options: program.speakers.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      kind: 'number',
      name: 'capacity',
      label: tp('capacity'),
      hint: tp('capacityHint'),
      defaultValue: s?.capacity ? String(s.capacity) : undefined,
    },
    {
      kind: 'textarea',
      name: 'description',
      label: tp('description'),
      hint: tp('markdownHint'),
      defaultValue: s?.description,
    },
  ];
  const days = groupByDay(program.sessions, tz);
  const allWarnings = await warningMessages(program.warnings, program);
  const nameOf = (list: readonly { id: string; name: string }[], id: string | null) =>
    list.find((x) => x.id === id)?.name ?? null;
  return (
    <>
      <PageHeader
        title={t('nav.sessions')}
        description={tp('sessionsSubtitle')}
        actions={
          isPublic || canWrite || canReadPeople ? (
            <div className="flex flex-wrap items-center gap-3">
              {canReadPeople ? (
                <Link href={`/o/${org}/e/${event}/engagement`} className={buttonClass('secondary')}>
                  {t('engagement.scores.link')}
                </Link>
              ) : null}
              {/* M5.8a: networking (directory, connections, meetings). */}
              <Link href={`/o/${org}/e/${event}/networking`} className={buttonClass('secondary')}>
                {t('networking.console.link')}
              </Link>
              {canWrite ? (
                <Link href={`/o/${org}/e/${event}/sessions/import`} className={buttonClass('secondary')}>
                  {t('agenda.import.link')}
                </Link>
              ) : null}
              {isPublic ? (
                <Link
                  href={`/events/${ev.slug}#agenda`}
                  className="inline-flex min-h-10 items-center underline underline-offset-2"
                >
                  {t('dashboard.previewPage')}
                </Link>
              ) : null}
            </div>
          ) : undefined
        }
      />
      {canWrite ? null : <p className="text-body text-ink-2">{tp('viewerNotice')}</p>}
      <AgendaPublishing
        org={org}
        event={event}
        agenda={agenda}
        locale={locale}
        timeZone={tz}
        canWrite={canWrite}
      />
      {program.warnings.length > 0 ? (
        <section aria-labelledby="conflicts-heading" className="flex flex-col gap-2">
          <h2 id="conflicts-heading" className="text-section">
            {tp('conflicts', { count: program.warnings.length })}
          </h2>
          <ul className="flex list-none flex-col gap-2 p-0">
            {allWarnings.map((w, i) => (
              <li key={`${i}-${w}`}>
                <ScheduleWarning>{w}</ScheduleWarning>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <AgendaWarnings messages={agendaMessages} />
      <section aria-labelledby="agenda-heading" className="flex flex-col gap-3">
        <h2 id="agenda-heading" className="text-section">
          {tp('agenda')}
        </h2>
        <p className="text-caption text-ink-2">{tp('timesIn', { timezone: tz.replace(/_/g, ' ') })}</p>
        {days.length === 0 ? (
          <EmptyState title={tp('emptySessionsTitle')} description={tp('emptySessionsDescription')} />
        ) : (
          days.map((d) => (
            <section key={d.day} aria-labelledby={`day-${d.day}`} className="flex flex-col gap-2">
              <h3 id={`day-${d.day}`} className="text-body font-medium">
                {dayLabel.format(new Date(`${d.day}T00:00:00Z`))}
              </h3>
              <ol className="flex list-none flex-col gap-2 p-0">
                {d.items.map((s) => {
                  const mine = program.warnings.filter((w) => w.sessionId === s.id || w.otherId === s.id);
                  const room = nameOf(program.rooms, s.roomId);
                  const track = nameOf(program.tracks, s.trackId);
                  const people = s.speakerIds
                    .map((id) => nameOf(program.speakers, id))
                    .filter((n): n is string => Boolean(n));
                  return (
                    <li key={s.id}>
                      <Card className="flex flex-col gap-2" data-session={s.title}>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-mono text-caption text-ink-2">
                            {time.format(s.startsAt)}–{time.format(s.endsAt)}
                          </span>
                          <h4 className="text-body font-medium">{s.title}</h4>
                          {mine.length > 0 ? <Label>{tp('conflictLabel')}</Label> : null}
                          {live.has(s.id) ? <Label>{tl('liveLabel')}</Label> : null}
                          {s.draft ? <StatusPill tone="waiting" label={tcfp('draftSession')} /> : null}
                        </div>
                        {s.draft ? (
                          // M5.3b: an accepted proposal waits here (placeholder time) until placed.
                          <div className="flex flex-col gap-2">
                            <p className="m-0 text-caption text-ink-2">{tcfp('draftSessionHint')}</p>
                            {canWrite ? (
                              <ActionButtonForm
                                action={placeDraftSessionAction.bind(null, org, event, s.id)}
                                label={tcfp('placeSession', { title: s.title })}
                                successLabel={tcfp('placed')}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        <p className="text-caption text-ink-2">
                          {[room, track, people.join(', ')].filter(Boolean).join(' · ') || tp('noDetails')}
                        </p>
                        <Link
                          href={`/o/${org}/e/${event}/sessions/${s.id}/live`}
                          aria-label={tl('openFor', { title: s.title })}
                          className="inline-flex min-h-6 items-center self-start text-caption underline underline-offset-2"
                        >
                          {tl('title')}
                        </Link>
                        <SessionAgendaLine
                          details={agenda.sessions.find((d) => d.sessionId === s.id)}
                          agenda={agenda}
                          roomTooSmall={agenda.warnings.some(
                            (w) => w.kind === 'room_too_small' && w.sessionId === s.id,
                          )}
                        />
                        {canWrite ? (
                          <details className="border-t border-line pt-2">
                            <summary className="min-h-6 cursor-pointer text-caption text-ink-2">
                              {tp('editSession', { title: s.title })}
                            </summary>
                            <div className="flex flex-col gap-3 pt-3">
                              <ProgramForm
                                action={updateSessionAction.bind(null, org, event, s.id)}
                                fields={sessionFields(s)}
                                idPrefix={`session-${s.id}`}
                                submitLabel={tp('saveSession')}
                                successLabel={tp('sessionSaved')}
                                errors={errors}
                              />
                              <SessionAgendaForm
                                org={org}
                                event={event}
                                sessionId={s.id}
                                title={s.title}
                                details={agenda.sessions.find((d) => d.sessionId === s.id)}
                                agenda={agenda}
                              />
                              <form action={deleteSessionAction.bind(null, org, event, s.id)}>
                                <Button type="submit" variant="ghost" size="sm">
                                  {tp('deleteNamed', { name: s.title })}
                                </Button>
                              </form>
                            </div>
                          </details>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
        {canWrite ? (
          <section aria-labelledby="add-session-heading">
            <Card size="panel" className="flex flex-col gap-3">
              <h3 id="add-session-heading" className="text-section">
                {tp('addSession')}
              </h3>
              <ProgramForm
                action={createSessionAction.bind(null, org, event)}
                fields={sessionFields()}
                idPrefix="new-session"
                submitLabel={tp('addSession')}
                successLabel={tp('sessionAdded')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        ) : null}
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(
          [
            ['rooms', program.rooms, createRoomAction, deleteRoomAction],
            ['tracks', program.tracks, createTrackAction, deleteTrackAction],
          ] as const
        ).map(([kind, list, create, remove]) => (
          <section key={kind} aria-labelledby={`${kind}-heading`} className="flex flex-col gap-3">
            <h2 id={`${kind}-heading`} className="text-section">
              {tp(kind)}
            </h2>
            {list.length === 0 ? (
              <p className="text-body text-ink-2">{tp(`${kind}Empty`)}</p>
            ) : (
              <ul className="flex list-none flex-col gap-1 p-0">
                {list.map((x) => (
                  <li
                    key={x.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1"
                  >
                    <span className="text-body">
                      {x.name}
                      {'capacity' in x && x.capacity ? (
                        <span className="text-caption text-ink-2">
                          {' '}
                          · {tp('seats', { count: x.capacity })}
                        </span>
                      ) : null}
                    </span>
                    {canWrite ? (
                      <form action={remove.bind(null, org, event, x.id)}>
                        <Button type="submit" variant="ghost" size="sm">
                          {tp('deleteNamed', { name: x.name })}
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canWrite ? (
              <Card className="flex flex-col gap-3">
                <ProgramForm
                  action={create.bind(null, org, event)}
                  fields={[
                    {
                      kind: 'text',
                      name: 'name',
                      label: tp(kind === 'rooms' ? 'roomName' : 'trackName'),
                      required: true,
                      maxLength: 80,
                    },
                    ...(kind === 'rooms'
                      ? [
                          {
                            kind: 'number' as const,
                            name: 'capacity',
                            label: tp('capacity'),
                            hint: tp('capacityHint'),
                          },
                        ]
                      : []),
                  ]}
                  idPrefix={`new-${kind}`}
                  submitLabel={tp(kind === 'rooms' ? 'addRoom' : 'addTrack')}
                  successLabel={tp(kind === 'rooms' ? 'roomAdded' : 'trackAdded')}
                  errors={errors}
                  reset
                />
              </Card>
            ) : null}
          </section>
        ))}
      </div>
      <TypesAndGroups org={org} event={event} agenda={agenda} program={program} canWrite={canWrite} />
    </>
  );
}
