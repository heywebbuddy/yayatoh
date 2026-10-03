import { listOccurrencesQuery } from '@yayatoh/events';
import {
  groupState,
  type InvitationMatrixDto,
  invitationMatrixQuery,
  type MatrixGuestDto,
  RESPONSE_STATUSES,
  SUB_EVENT_KINDS,
  type SubEventSummaryDto,
  subEventHistoryQuery,
  windowInputs,
} from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { listLayoutsQuery, type SubEventChartDto, subEventChartsQuery } from '@yayatoh/seating';
import { buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { listVenuesQuery } from '@yayatoh/venues';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  bulkInvitationAction,
  createSubEventAction,
  giveSubEventChartAction,
  moveSubEventAction,
  recordResponseAction,
  removeSubEventAction,
  removeSubEventChartAction,
  toggleInvitationsAction,
  updateSubEventAction,
} from './actions.ts';
import { type GridCell, type GridRow, InvitationGrid } from './invitation-grid.tsx';

type Search = { side?: string; tag?: string; vip?: string };

/** A disclosure whose content is a named region (so its forms can be found by name). */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="min-h-6 cursor-pointer py-0.5 text-caption text-ink-2 underline-offset-2 hover:underline">
        {summary}
      </summary>
      <section aria-label={summary} className="flex flex-col gap-3 pt-3">
        {children}
      </section>
    </details>
  );
}

const pill = 'rounded-pill px-2 py-px text-caption';
const control = 'field';

/**
 * Sub-events and invitations (M4.1c): the wedding's parts (ceremony, reception, rehearsal
 * dinner…) with their times in the event's zone, place, date and chart; the invitation matrix
 * (guests by party × sub-events); and the host's record of paper or typed answers. Hosts, co-hosts
 * and planners with `guests:write` edit; viewers read.
 */
export default async function SubEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'guests');
  if (!nav || !navIncludes(profile, data.modules, 'guests') || !can('guests:read')) notFound();
  const t = await getTranslations('subEvents');
  const tp = await getTranslations('parties');
  const canWrite = can('guests:write');
  const seating = data.modules.has('seating');
  const canSeat = seating && can('seating:write');

  const side = (sp.side ?? '').trim().slice(0, 40);
  const tag = (sp.tag ?? '').trim().slice(0, 40);
  const vip = sp.vip === 'yes' ? true : sp.vip === 'no' ? false : undefined;
  const filtered = !!(side || tag || vip !== undefined);
  const matrix: InvitationMatrixDto = await executeQuery(
    invitationMatrixQuery,
    { eventId: ev.id, side: side || undefined, tag: tag || undefined, vip },
    data.ctx,
    ports,
  );
  const subs = matrix.subEvents;
  const [dates, venues, charts, layouts, history] = await Promise.all([
    executeQuery(listOccurrencesQuery, { eventId: ev.id }, data.ctx, ports),
    canWrite ? executeQuery(listVenuesQuery, { eventId: ev.id }, data.ctx, ports) : Promise.resolve([]),
    seating && subs.length
      ? executeQuery(
          subEventChartsQuery,
          { eventId: ev.id, subEvents: subs.map((s) => ({ id: s.id, occurrenceId: s.occurrenceId })) },
          data.ctx,
          ports,
        )
      : Promise.resolve([] as SubEventChartDto[]),
    canSeat ? executeQuery(listLayoutsQuery, { eventId: ev.id }, data.ctx, ports) : Promise.resolve([]),
    executeQuery(subEventHistoryQuery, { eventId: ev.id, limit: 20 }, data.ctx, ports),
  ]);

  const n = (v: number) => formatNumber(v, locale);
  const dt = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const dateLabel = (id: string | null) => {
    const d = dates.find((x) => x.id === id);
    return d ? dt.format(d.startsAt) : null;
  };
  const everyGuest = new Map(matrix.parties.flatMap((p) => p.guests.map((g) => [g.id, g] as const)));
  const nameOf = (g: MatrixGuestDto) => {
    const full = [g.firstName, g.lastName].filter(Boolean).join(' ');
    if (full) return full;
    const host = g.hostGuestId ? everyGuest.get(g.hostGuestId) : undefined;
    return tp('guestOf', { name: host ? [host.firstName, host.lastName].filter(Boolean).join(' ') : '?' });
  };
  const subName = new Map(subs.map((s) => [s.id, s.name]));
  const answer = new Map(matrix.responses.map((r) => [`${r.subEventId}:${r.guestId}`, r]));
  const invited = new Map(Object.entries(matrix.invited).map(([k, v]) => [k, new Set(v)]));
  const shownGuests = matrix.parties.flatMap((p) => p.guests);

  const errors: Record<string, string> = {
    name: t('errors.name'),
    startsAt: t('errors.startsAt'),
    endsAt: t('errors.endsAt'),
    place: t('errors.place'),
    venueId: t('errors.venueId'),
    occurrenceId: t('errors.occurrenceId'),
    subEventId: t('errors.subEventId'),
    guestId: t('errors.guestId'),
    status: t('errors.status'),
    layoutId: t('errors.layoutId'),
    too_many_sub_events: t('errors.too_many_sub_events'),
    has_responses: t('errors.has_responses'),
    cannot_move: t('errors.cannot_move'),
    everyone_invited: t('errors.everyone_invited'),
    plus_one_follows_host: t('errors.plus_one_follows_host'),
    not_invited: t('errors.not_invited'),
    sub_event_has_chart: t('errors.sub_event_has_chart'),
    no_chart: t('errors.no_chart'),
  };

  const subEventFields = (s?: SubEventSummaryDto): FieldSpec[] => {
    const w = s ? windowInputs(s, ev.timezone) : null;
    return [
      {
        kind: 'text',
        name: 'name',
        label: t('name'),
        hint: t('nameHint'),
        required: true,
        maxLength: 120,
        defaultValue: s?.name,
      },
      {
        kind: 'select',
        name: 'kind',
        label: t('kind'),
        options: SUB_EVENT_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) })),
        defaultValue: s?.kind ?? 'ceremony',
      },
      {
        kind: 'datetime-local',
        name: 'startsAt',
        label: t('startsAt'),
        hint: t('timeHint', { zone: ev.timezone }),
        required: true,
        defaultValue: w?.start,
      },
      {
        kind: 'datetime-local',
        name: 'endsAt',
        label: t('endsAt'),
        required: true,
        defaultValue: w?.end,
      },
      {
        kind: 'text',
        name: 'place',
        label: t('place'),
        hint: t('placeHint'),
        maxLength: 200,
        defaultValue: s?.place ?? undefined,
      },
      ...(venues.length
        ? [
            {
              kind: 'select' as const,
              name: 'venueId',
              label: t('venue'),
              options: [
                { value: '', label: t('noVenue') },
                ...venues.map((v) => ({ value: v.id, label: v.name })),
              ],
              defaultValue: s?.venueId ?? '',
            },
          ]
        : []),
      ...(dates.length
        ? [
            {
              kind: 'select' as const,
              name: 'occurrenceId',
              label: t('date'),
              hint: t('dateHint'),
              options: [
                { value: '', label: t('noDate') },
                ...dates
                  .filter((d) => d.status === 'scheduled' || d.id === s?.occurrenceId)
                  .map((d) => ({ value: d.id, label: dt.format(d.startsAt) })),
              ],
              defaultValue: s?.occurrenceId ?? '',
            },
          ]
        : []),
      {
        kind: 'checkboxes',
        name: 'inviteAll',
        label: t('inviteAllLegend'),
        options: [{ value: '1', label: t('inviteAll') }],
        defaultValues: s?.inviteAll ? ['1'] : [],
      },
    ];
  };

  // The grid: a first row for whole sub-events, then each party and its guests.
  const readOnly = canWrite ? null : t('readOnly');
  const columnCells = subs.map<GridCell>((s) => ({
    label: filtered ? t('inviteShownTo', { name: s.name }) : t('inviteEveryoneTo', { name: s.name }),
    what: `${filtered ? t('shownRow') : t('everyoneRow')} · ${s.name}`,
    state: groupState(shownGuests.map((g) => invited.get(s.id)?.has(g.id) ?? false)),
    locked: readOnly ?? (s.inviteAll ? t('everyoneLocked') : shownGuests.length ? null : t('nobodyShown')),
    change: {
      subEventIds: [s.id],
      target: filtered
        ? { kind: 'filter', side: side || null, tag: tag || null, vip: vip ?? null }
        : { kind: 'all' },
    },
  }));
  const rows: GridRow[] = [
    { key: 'all', header: filtered ? t('shownRow') : t('everyoneRow'), level: 'all', cells: columnCells },
    ...matrix.parties.flatMap<GridRow>((p) => [
      {
        key: `party-${p.id}`,
        header: p.name,
        level: 'party',
        cells: subs.map<GridCell>((s) => ({
          label: t('invitePartyTo', { party: p.name, name: s.name }),
          what: `${p.name} · ${s.name}`,
          state: groupState(p.guests.map((g) => invited.get(s.id)?.has(g.id) ?? false)),
          locked: readOnly ?? (s.inviteAll ? t('everyoneLocked') : p.guests.length ? null : t('noGuests')),
          change: { subEventIds: [s.id], target: { kind: 'parties', partyIds: [p.id] } },
        })),
      },
      ...p.guests.map<GridRow>((g) => {
        const host = g.hostGuestId ? everyGuest.get(g.hostGuestId) : undefined;
        return {
          key: g.id,
          header: nameOf(g),
          level: g.kind === 'plus_one' ? 'plus_one' : 'guest',
          cells: subs.map<GridCell>((s) => {
            const r = answer.get(`${s.id}:${g.id}`);
            return {
              label: t('inviteGuestTo', { guest: nameOf(g), name: s.name }),
              what: `${nameOf(g)} · ${s.name}`,
              state: invited.get(s.id)?.has(g.id) ? 'all' : 'none',
              locked:
                readOnly ??
                (s.inviteAll
                  ? t('everyoneLocked')
                  : g.kind === 'plus_one'
                    ? t('followsHost', { name: host ? nameOf(host) : '?' })
                    : null),
              change: { subEventIds: [s.id], target: { kind: 'guests', guestIds: [g.id] } },
              response: r ? t(`responses.${r.status}`) : null,
            };
          }),
        };
      }),
    ]),
  ];
  const filterHref = (over: Partial<Search>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ side, tag, vip: sp.vip ?? '', ...over }))
      if (v) u.set(k, String(v));
    const s = u.toString();
    return `/o/${org}/e/${event}/guests/sub-events${s ? `?${s}` : ''}`;
  };
  const actorLabel = (actor: string) =>
    actor === `user:${data.session.userId}`
      ? tp('actors.you')
      : actor.startsWith('user:')
        ? tp('actors.member')
        : tp('actors.system');

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Link href={`/o/${org}/e/${event}/guests`} className="min-h-6 self-start py-1 text-caption underline">
        {t('backToGuests')}
      </Link>
      {canWrite ? null : <p className="text-body text-ink-2">{t('viewerNotice')}</p>}

      <section aria-labelledby="sub-events-heading" className="flex flex-col gap-3">
        <h2 id="sub-events-heading" className="text-section">
          {t('program')}
        </h2>
        {subs.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            description={canWrite ? t('emptyDescription') : t('emptyViewer')}
            action={
              canWrite ? (
                <Link
                  href={`/o/${org}/e/${event}/guests/sub-events#adding-sub-event`}
                  className={buttonClass('primary', 'md')}
                >
                  {t('emptyAction')}
                </Link>
              ) : (
                <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
                  {t('backToEvent')}
                </Link>
              )
            }
          />
        ) : (
          <ol className="flex list-none flex-col gap-3 p-0">
            {subs.map((s, i) => {
              const chart = charts.find((c) => c.subEventId === s.id);
              const venue = venues.find((v) => v.id === s.venueId);
              const linked = dateLabel(s.occurrenceId);
              return (
                <li key={s.id}>
                  <Card className="flex flex-col gap-3">
                    <section aria-labelledby={`sub-${s.id}-name`} className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 id={`sub-${s.id}-name`} className="text-body font-medium">
                          {s.name}
                        </h3>
                        <span className={`${pill} bg-surface-3 text-ink-2`}>{t(`kinds.${s.kind}`)}</span>
                        {s.inviteAll ? (
                          <span className={`${pill} bg-primary-soft text-primary-ink`}>
                            {t('everyoneInvited')}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-caption text-ink-2">
                        <time dateTime={s.startsAt.toISOString()}>
                          {dt.formatRange(s.startsAt, s.endsAt)}
                        </time>
                      </p>
                      {s.place || venue ? (
                        <p className="text-caption text-ink-2">
                          {t('placeValue', { place: [s.place, venue?.name].filter(Boolean).join(' · ') })}
                        </p>
                      ) : null}
                      {linked ? (
                        <p className="text-caption text-ink-2">{t('dateValue', { date: linked })}</p>
                      ) : null}
                      <p className="text-caption text-ink-2" data-testid={`sub-counts-${i}`}>
                        {t('counts', { invited: s.invited, attending: s.attending, declined: s.declined })}
                      </p>
                      {chart ? (
                        <p className="text-caption text-ink-2" data-testid={`sub-chart-${i}`}>
                          {chart.source === 'sub_event'
                            ? t('chart.own', { count: chart.seatCount })
                            : chart.source === 'date'
                              ? t('chart.date', {
                                  date: dateLabel(chart.chartKey) ?? '?',
                                  count: chart.seatCount,
                                })
                              : chart.source === 'event'
                                ? t('chart.event', { count: chart.seatCount })
                                : t('chart.none')}
                        </p>
                      ) : null}
                    </section>
                    {canWrite ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-3">
                          {i > 0 ? (
                            <ProgramForm
                              action={moveSubEventAction.bind(null, org, event, s.id, 'up')}
                              fields={[]}
                              idPrefix={`up-${s.id}`}
                              submitLabel={t('moveUp', { name: s.name })}
                              successLabel={t('moved')}
                              errors={errors}
                            />
                          ) : null}
                          {i < subs.length - 1 ? (
                            <ProgramForm
                              action={moveSubEventAction.bind(null, org, event, s.id, 'down')}
                              fields={[]}
                              idPrefix={`down-${s.id}`}
                              submitLabel={t('moveDown', { name: s.name })}
                              successLabel={t('moved')}
                              errors={errors}
                            />
                          ) : null}
                        </div>
                        <Disclosure summary={t('editNamed', { name: s.name })}>
                          <ProgramForm
                            action={updateSubEventAction.bind(null, org, event, s.id)}
                            fields={subEventFields(s)}
                            idPrefix={`sub-${s.id}-edit`}
                            submitLabel={t('save')}
                            successLabel={t('saved')}
                            errors={errors}
                          />
                          <ProgramForm
                            action={removeSubEventAction.bind(null, org, event, s.id)}
                            fields={
                              s.responses
                                ? [
                                    {
                                      kind: 'checkboxes',
                                      name: 'confirm',
                                      label: t('confirmLegend'),
                                      options: [
                                        { value: '1', label: t('confirmRemove', { count: s.responses }) },
                                      ],
                                    },
                                  ]
                                : []
                            }
                            idPrefix={`sub-${s.id}-remove`}
                            submitLabel={t('removeNamed', { name: s.name })}
                            successLabel={t('removed')}
                            errors={errors}
                          />
                        </Disclosure>
                      </div>
                    ) : null}
                    {canSeat && chart ? (
                      chart.source === 'sub_event' ? (
                        <ProgramForm
                          action={removeSubEventChartAction.bind(null, org, event, s.id)}
                          fields={[]}
                          idPrefix={`chart-${s.id}-remove`}
                          submitLabel={t('chart.useFallback', { name: s.name })}
                          successLabel={t('chart.removed')}
                          errors={errors}
                        />
                      ) : chart.source !== 'none' || layouts.length ? (
                        <Disclosure summary={t('chart.giveOwn', { name: s.name })}>
                          <ProgramForm
                            action={giveSubEventChartAction.bind(null, org, event, s.id, s.occurrenceId)}
                            fields={[
                              {
                                kind: 'select',
                                name: 'layoutId',
                                label: t('chart.from'),
                                hint: t('chart.fromHint'),
                                options: [
                                  ...(chart.source !== 'none'
                                    ? [{ value: '', label: t('chart.copyCurrent') }]
                                    : []),
                                  ...layouts.map((l) => ({
                                    value: l.id,
                                    label: t('chart.layoutOption', { name: l.name, count: l.seatCount }),
                                  })),
                                ],
                              },
                            ]}
                            idPrefix={`chart-${s.id}-give`}
                            submitLabel={t('chart.give')}
                            successLabel={t('chart.given')}
                            errors={errors}
                          />
                        </Disclosure>
                      ) : null
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {canWrite ? (
        <section id="adding-sub-event" aria-labelledby="adding-sub-event-heading">
          <Card size="panel" className="flex flex-col gap-3">
            <h2 id="adding-sub-event-heading" className="text-section">
              {t('add')}
            </h2>
            <p className="text-caption text-ink-2">{t('addHint')}</p>
            <ProgramForm
              action={createSubEventAction.bind(null, org, event)}
              fields={subEventFields()}
              idPrefix="new-sub-event"
              submitLabel={t('add')}
              successLabel={t('added')}
              errors={errors}
              reset
            />
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="matrix-heading" className="flex flex-col gap-3">
        <h2 id="matrix-heading" className="text-section">
          {t('matrix')}
        </h2>
        {subs.length === 0 || matrix.totalParties === 0 ? (
          <EmptyState
            title={t('matrixEmptyTitle')}
            description={subs.length === 0 ? t('matrixNoSubEvents') : t('matrixNoGuests')}
            action={
              subs.length === 0 ? (
                <Link
                  href={`/o/${org}/e/${event}/guests/sub-events#sub-events-heading`}
                  className={buttonClass('secondary', 'md')}
                >
                  {t('matrixToSubEvents')}
                </Link>
              ) : canWrite ? (
                <Link href={`/o/${org}/e/${event}/guests#new-party`} className={buttonClass('primary', 'md')}>
                  {t('matrixAddGuests')}
                </Link>
              ) : (
                <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
                  {t('backToEvent')}
                </Link>
              )
            }
          />
        ) : (
          <>
            <search aria-label={t('filters')}>
              <form
                key={`${side}|${tag}|${sp.vip ?? ''}`}
                method="get"
                className="flex flex-wrap items-end gap-3"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="matrix-side" className="text-[13px] font-bold text-ink">
                    {tp('side')}
                  </label>
                  <select id="matrix-side" name="side" defaultValue={side} className={control}>
                    <option value="">{tp('anySide')}</option>
                    {matrix.sides.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="matrix-tag" className="text-[13px] font-bold text-ink">
                    {tp('tag')}
                  </label>
                  <select id="matrix-tag" name="tag" defaultValue={tag} className={control}>
                    <option value="">{tp('anyTag')}</option>
                    {matrix.tags.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="matrix-vip" className="text-[13px] font-bold text-ink">
                    {tp('vip')}
                  </label>
                  <select
                    id="matrix-vip"
                    name="vip"
                    defaultValue={sp.vip === 'yes' || sp.vip === 'no' ? sp.vip : ''}
                    className={control}
                  >
                    <option value="">{tp('vipAny')}</option>
                    <option value="yes">{tp('vipOnly')}</option>
                    <option value="no">{tp('vipNot')}</option>
                  </select>
                </div>
                <button type="submit" className="field">
                  {tp('apply')}
                </button>
                {filtered ? (
                  <Link
                    href={filterHref({ side: '', tag: '', vip: '' })}
                    className="min-h-6 py-2 text-caption underline"
                  >
                    {tp('clear')}
                  </Link>
                ) : null}
              </form>
            </search>
            <p role="status" className="text-caption text-ink-2">
              {filtered
                ? t('showingFiltered', { parties: matrix.parties.length, guests: shownGuests.length })
                : t('showingAll', { parties: matrix.parties.length, guests: shownGuests.length })}
            </p>
            {matrix.parties.length === 0 ? (
              <EmptyState
                title={tp('noMatchTitle')}
                description={tp('noMatchDescription')}
                action={
                  <Link
                    href={`/o/${org}/e/${event}/guests/sub-events#matrix-heading`}
                    className={buttonClass('primary', 'md')}
                  >
                    {tp('showAll')}
                  </Link>
                }
              />
            ) : (
              <>
                <InvitationGrid
                  caption={t('gridCaption')}
                  columns={subs.map((s) => ({
                    id: s.id,
                    name: s.name,
                    detail: t('columnCounts', { invited: n(s.invited), attending: n(s.attending) }),
                  }))}
                  rows={rows}
                  toggle={toggleInvitationsAction.bind(null, org, event)}
                />
                {canWrite ? (
                  <section aria-labelledby="bulk-heading" className="flex flex-col gap-2">
                    <h3 id="bulk-heading" className="text-body font-medium">
                      {t('bulk')}
                    </h3>
                    <p className="text-caption text-ink-2">
                      {filtered ? t('bulkHintFiltered') : t('bulkHint')}
                    </p>
                    <ProgramForm
                      action={bulkInvitationAction.bind(null, org, event, {
                        side: side || null,
                        tag: tag || null,
                        vip: vip ?? null,
                      })}
                      fields={[
                        {
                          kind: 'select',
                          name: 'subEventId',
                          label: t('bulkSubEvent'),
                          options: [
                            { value: '', label: t('chooseSubEvent') },
                            ...subs.map((s) => ({ value: s.id, label: s.name })),
                          ],
                        },
                        {
                          kind: 'select',
                          name: 'change',
                          label: t('bulkChange'),
                          options: [
                            { value: 'invite', label: t('bulkInvite') },
                            { value: 'uninvite', label: t('bulkUninvite') },
                          ],
                        },
                      ]}
                      idPrefix="bulk"
                      submitLabel={t('bulkApply', { count: shownGuests.length })}
                      successLabel={t('bulkDone')}
                      errors={errors}
                    />
                  </section>
                ) : null}
              </>
            )}
          </>
        )}
      </section>

      {canWrite && subs.length && shownGuests.length ? (
        <section aria-labelledby="response-heading">
          <Card size="panel" className="flex flex-col gap-3">
            <h2 id="response-heading" className="text-section">
              {t('record')}
            </h2>
            <p className="text-caption text-ink-2">{t('recordHint')}</p>
            <ProgramForm
              action={recordResponseAction.bind(null, org, event)}
              fields={[
                {
                  kind: 'select',
                  name: 'guestId',
                  label: t('guest'),
                  options: [
                    { value: '', label: t('chooseGuest') },
                    ...matrix.parties.flatMap((p) =>
                      p.guests.map((g) => ({
                        value: g.id,
                        label: t('guestOption', { guest: nameOf(g), party: p.name }),
                      })),
                    ),
                  ],
                },
                {
                  kind: 'select',
                  name: 'subEventId',
                  label: t('subEvent'),
                  options: [
                    { value: '', label: t('chooseSubEvent') },
                    ...subs.map((s) => ({ value: s.id, label: s.name })),
                  ],
                },
                {
                  kind: 'select',
                  name: 'status',
                  label: t('response'),
                  options: [
                    { value: '', label: t('chooseResponse') },
                    ...RESPONSE_STATUSES.map((r) => ({ value: r, label: t(`responses.${r}`) })),
                    { value: 'clear', label: t('clearResponse') },
                  ],
                },
                {
                  kind: 'select',
                  name: 'source',
                  label: tp('source'),
                  hint: tp('sourceHint'),
                  options: [
                    { value: 'paper', label: tp('sources.paper') },
                    { value: 'manual', label: tp('sources.manual') },
                  ],
                },
              ]}
              idPrefix="response"
              submitLabel={t('recordSubmit')}
              successLabel={t('recorded')}
              errors={errors}
            />
          </Card>
        </section>
      ) : null}

      {history.length ? (
        <section aria-labelledby="sub-history-heading" className="flex flex-col gap-2">
          <h2 id="sub-history-heading" className="text-section">
            {t('history')}
          </h2>
          <ol className="flex list-none flex-col gap-1 p-0">
            {history.map((h) => {
              const g = h.guestId ? everyGuest.get(h.guestId) : undefined;
              const sName = h.subEventId ? subName.get(h.subEventId) : undefined;
              return (
                <li key={h.id} className="text-caption text-ink-2">
                  {tp(`actions.${h.action}`)}
                  {sName ? ` · ${sName}` : ''}
                  {g ? ` · ${nameOf(g)}` : ''} · {tp(`sources.${h.source}`)} · {actorLabel(h.actor)} ·{' '}
                  <time dateTime={h.at.toISOString()}>{dt.format(h.at)}</time>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </>
  );
}
