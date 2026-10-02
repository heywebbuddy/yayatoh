import { listAttendeesQuery } from '@yayatoh/attendees';
import {
  AGE_CLASSES,
  type GuestDto,
  guestListQuery,
  type HistoryEntryDto,
  type PartyWithGuestsDto,
  partyHistoryQuery,
} from '@yayatoh/guests';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, navIncludes, navLabelKey, PROFILES } from '@yayatoh/platform';
import { Avatar, AvatarStack, buttonClass, Card, EmptyState, PageHeader, Pagination, Tag } from '@yayatoh/ui';
import { Plus, Search as SearchIcon } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Crumbs } from '@/components/crumbs.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  addGuestAction,
  addPlusOneAction,
  createPartyAction,
  moveGuestAction,
  removeGuestAction,
  removePartyAction,
  updateGuestAction,
  updatePartyAction,
} from './actions.ts';

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f-]{36}$/;

type Search = { q?: string; side?: string; tag?: string; vip?: string; page?: string; history?: string };

/** A disclosure whose content is a named region (so its forms can be found by name). */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-[10px] px-2 text-caption font-bold text-primary-ink hover:bg-surface-3">
        {summary}
      </summary>
      <section aria-label={summary} className="flex flex-col gap-3 pt-3">
        {children}
      </section>
    </details>
  );
}

const pill = 'rounded-pill px-2.5 py-0.5 text-caption font-bold';
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/**
 * Guests (M4.1a): the parties (households) of a wedding or gala and the guests in each, with
 * placeholder plus-ones. Replaces the "coming soon" section for profiles whose navigation lists
 * `guests`. Organizer roles with `attendees:write` edit; viewers read.
 */
export default async function GuestsPage({
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
  const t = await getTranslations();
  const tp = await getTranslations('parties');
  const canWrite = can('guests:write');

  const q = (sp.q ?? '').trim().slice(0, 100);
  const side = (sp.side ?? '').trim().slice(0, 40);
  const tag = (sp.tag ?? '').trim().slice(0, 40);
  const vip = sp.vip === 'yes' ? true : sp.vip === 'no' ? false : undefined;
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.page ?? '1', 10) || 1));
  const filtered = !!(q || side || tag || vip !== undefined);
  const list = await executeQuery(
    guestListQuery,
    {
      eventId: ev.id,
      search: q || undefined,
      side: side || undefined,
      tag: tag || undefined,
      vip,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    data.ctx,
    ports,
  );
  const historyFor = sp.history && UUID.test(sp.history) ? sp.history : null;
  const history: HistoryEntryDto[] =
    historyFor && list.parties.some((p) => p.id === historyFor)
      ? await executeQuery(partyHistoryQuery, { eventId: ev.id, partyId: historyFor }, data.ctx, ports)
      : [];
  // Guest-list entries (M1.8) a guest can be linked to.
  const entries =
    canWrite && data.modules.has('attendees')
      ? (
          await executeQuery(
            listAttendeesQuery,
            { eventId: ev.id, status: 'active', limit: 500 },
            data.ctx,
            ports,
          )
        ).items
      : [];

  const n = (v: number) => formatNumber(v, locale);
  const everyGuest = new Map(list.parties.flatMap((p) => p.guests.map((g) => [g.id, g] as const)));
  const nameOf = (g: GuestDto) => {
    const full = [g.firstName, g.lastName].filter(Boolean).join(' ');
    if (full) return full;
    const host = g.hostGuestId ? everyGuest.get(g.hostGuestId) : undefined;
    return tp('guestOf', { name: host ? [host.firstName, host.lastName].filter(Boolean).join(' ') : '?' });
  };
  const errors: Record<string, string> = {
    name: tp('errors.name'),
    envelopeName: tp('errors.envelopeName'),
    side: tp('errors.side'),
    tags: tp('errors.tags'),
    notes: tp('errors.notes'),
    firstName: tp('errors.firstName'),
    lastName: tp('errors.lastName'),
    meal: tp('errors.meal'),
    dietary: tp('errors.private'),
    accessibility: tp('errors.private'),
    address: tp('errors.private'),
    attendeeId: tp('errors.attendeeId'),
    'conflict.attendeeId': tp('errors.attendeeTaken'),
    toPartyId: tp('errors.toPartyId'),
    isPrimary: tp('errors.isPrimary'),
    party_full: tp('errors.partyFull'),
    too_many: tp('errors.tooMany'),
    host_has_plus_one: tp('errors.hasPlusOne'),
    host_is_plus_one: tp('errors.plusOneOfPlusOne'),
    plus_one_moves_with_host: tp('errors.plusOneMoves'),
  };
  const sourceField: FieldSpec = {
    kind: 'select',
    name: 'source',
    label: tp('source'),
    hint: tp('sourceHint'),
    options: [
      { value: 'manual', label: tp('sources.manual') },
      { value: 'paper', label: tp('sources.paper') },
    ],
  };
  const partyFields = (p?: PartyWithGuestsDto): FieldSpec[] => [
    {
      kind: 'text',
      name: 'name',
      label: tp('partyName'),
      hint: tp('partyNameHint'),
      required: true,
      maxLength: 120,
      defaultValue: p?.name,
    },
    {
      kind: 'text',
      name: 'envelopeName',
      label: tp('envelopeName'),
      hint: tp('envelopeHint'),
      maxLength: 200,
      defaultValue: p?.envelopeName ?? undefined,
    },
    {
      kind: 'text',
      name: 'side',
      label: tp('side'),
      hint: tp('sideHint'),
      maxLength: 40,
      defaultValue: p?.side ?? undefined,
      suggestions: list.sides,
    },
    {
      kind: 'checkboxes',
      name: 'vip',
      label: tp('vipLegend'),
      options: [{ value: '1', label: tp('vip') }],
      defaultValues: p?.vip ? ['1'] : [],
    },
    { kind: 'text', name: 'tags', label: tp('tags'), hint: tp('tagsHint'), defaultValue: p?.tags.join(', ') },
    {
      kind: 'textarea',
      name: 'notes',
      label: tp('notes'),
      hint: tp('notesHint'),
      rows: 2,
      defaultValue: p?.notes,
    },
    sourceField,
  ];
  const guestFields = (g?: GuestDto, plusOne = false): FieldSpec[] => [
    {
      kind: 'text',
      name: 'firstName',
      label: tp('firstName'),
      required: !plusOne,
      maxLength: 80,
      defaultValue: g?.firstName ?? undefined,
      ...(plusOne ? { hint: tp('plusOneNameHint') } : {}),
    },
    {
      kind: 'text',
      name: 'lastName',
      label: tp('lastName'),
      maxLength: 80,
      defaultValue: g?.lastName ?? undefined,
    },
    {
      kind: 'select',
      name: 'ageClass',
      label: tp('ageClass'),
      options: AGE_CLASSES.map((a) => ({ value: a, label: tp(`ages.${a}`) })),
      defaultValue: g?.ageClass ?? 'adult',
    },
    {
      kind: 'text',
      name: 'meal',
      label: tp('meal'),
      hint: tp('mealHint'),
      maxLength: 80,
      defaultValue: g?.meal ?? undefined,
    },
    {
      kind: 'textarea',
      name: 'dietary',
      label: tp('dietary'),
      hint: tp('privateHint'),
      rows: 2,
      defaultValue: g?.dietary ?? undefined,
    },
    {
      kind: 'textarea',
      name: 'accessibility',
      label: tp('accessibility'),
      hint: tp('privateHint'),
      rows: 2,
      defaultValue: g?.accessibility ?? undefined,
    },
    {
      kind: 'textarea',
      name: 'address',
      label: tp('address'),
      hint: tp('privateHint'),
      rows: 3,
      defaultValue: g?.address ?? undefined,
    },
    ...(entries.length
      ? [
          {
            kind: 'select' as const,
            name: 'attendeeId',
            label: tp('linkedEntry'),
            hint: tp('linkedEntryHint'),
            options: [
              { value: '', label: tp('notLinked') },
              ...entries.map((e) => ({ value: e.id, label: `${e.name} · ${e.email}` })),
            ],
            defaultValue: g?.attendeeId ?? '',
          },
        ]
      : []),
    ...(plusOne
      ? []
      : [
          {
            kind: 'checkboxes' as const,
            name: 'isPrimary',
            label: tp('primaryLegend'),
            options: [{ value: '1', label: tp('primary') }],
            defaultValues: g?.isPrimary ? ['1'] : [],
          },
        ]),
    sourceField,
  ];
  const filterHref = (over: Partial<Search>) => {
    const u = new URLSearchParams();
    const merged = { q, side, tag, vip: sp.vip ?? '', page: '', ...over };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, String(v));
    const s = u.toString();
    return `/o/${org}/e/${event}/guests${s ? `?${s}` : ''}`;
  };
  const when = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: ev.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  const actorLabel = (actor: string) =>
    actor === `user:${data.session.userId}`
      ? tp('actors.you')
      : actor.startsWith('user:')
        ? tp('actors.member')
        : tp('actors.system');
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const counts: [string, number][] = [
    [tp('counts.parties'), list.counts.parties],
    [tp('counts.guests'), list.counts.guests],
    [tp('counts.adults'), list.counts.adults],
    [tp('counts.children'), list.counts.children],
    [tp('counts.infants'), list.counts.infants],
    [tp('counts.plusOnesPending'), list.counts.plusOnesPending],
  ];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: t(navLabelKey(profile, nav)) },
            ]}
          />
        }
        title={t(navLabelKey(profile, nav))}
        tag={<Tag>{t(`profiles.${profile}`)}</Tag>}
        description={tp('subtitle')}
        actions={
          canWrite ? (
            <a href="#add-party-heading" className={buttonClass('primary')}>
              <Plus aria-hidden="true" strokeWidth={2.4} />
              {tp('addParty')}
            </a>
          ) : undefined
        }
      />
      {canWrite ? null : <p className="text-body text-ink-2">{tp('viewerNotice')}</p>}

      <section aria-labelledby="guest-counts-heading" className="flex flex-col gap-3">
        <h2 id="guest-counts-heading" className="sr-only">
          {tp('summary')}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {counts.map(([label, value], i) => (
            <Card
              key={label}
              className={`flex flex-col gap-1.5 ${i === 0 ? 'bg-success-soft' : i === counts.length - 1 && value > 0 ? 'bg-warning-soft' : ''}`}
            >
              <dt className="text-[13px] font-bold text-ink-2">{label}</dt>
              <dd className="m-0 text-[30px] leading-none font-extrabold tracking-[-0.04em] text-ink tabular-nums">
                {n(value)}
              </dd>
            </Card>
          ))}
        </dl>
        {list.counts.vipParties ? (
          <p className="text-caption text-ink-2">{tp('vipCount', { count: list.counts.vipParties })}</p>
        ) : null}
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="parties-heading" className="flex min-w-0 flex-col gap-3.5">
          <h2 id="parties-heading" className="m-0 text-card">
            {tp('parties')}
          </h2>
          {list.counts.parties > 0 ? (
            <search aria-label={tp('filters')}>
              <form
                // Remount on navigation: uncontrolled fields would keep the previous filters' values.
                key={`${q}|${side}|${tag}|${sp.vip ?? ''}`}
                method="get"
                className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 glass"
              >
                <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                  <label htmlFor="guest-search" className="text-[13px] font-bold text-ink">
                    {tp('search')}
                  </label>
                  <span className="relative flex">
                    <SearchIcon
                      aria-hidden="true"
                      className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-2"
                      strokeWidth={2}
                    />
                    <input
                      id="guest-search"
                      name="q"
                      type="search"
                      defaultValue={q}
                      maxLength={100}
                      className="field w-full ps-10"
                    />
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="guest-side" className="text-[13px] font-bold text-ink">
                    {tp('side')}
                  </label>
                  <select id="guest-side" name="side" defaultValue={side} className="field">
                    <option value="">{tp('anySide')}</option>
                    {list.sides.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="guest-tag" className="text-[13px] font-bold text-ink">
                    {tp('tag')}
                  </label>
                  <select id="guest-tag" name="tag" defaultValue={tag} className="field">
                    <option value="">{tp('anyTag')}</option>
                    {list.tags.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="guest-vip" className="text-[13px] font-bold text-ink">
                    {tp('vip')}
                  </label>
                  <select
                    id="guest-vip"
                    name="vip"
                    defaultValue={sp.vip === 'yes' || sp.vip === 'no' ? sp.vip : ''}
                    className="field"
                  >
                    <option value="">{tp('vipAny')}</option>
                    <option value="yes">{tp('vipOnly')}</option>
                    <option value="no">{tp('vipNot')}</option>
                  </select>
                </div>
                <button type="submit" className={buttonClass('secondary')}>
                  {tp('apply')}
                </button>
                {filtered ? (
                  <Link href={`/o/${org}/e/${event}/guests`} className="min-h-6 py-2 text-caption underline">
                    {tp('clear')}
                  </Link>
                ) : null}
              </form>
            </search>
          ) : null}
          {list.counts.parties > 0 ? (
            <p role="status" className="text-caption text-ink-2">
              {filtered ? tp('matching', { count: list.total }) : tp('showing', { count: list.total })}
            </p>
          ) : null}

          {list.counts.parties === 0 ? (
            <EmptyState
              title={tp('emptyTitle')}
              description={canWrite ? tp('emptyDescription') : tp('emptyViewer')}
            />
          ) : list.parties.length === 0 ? (
            <EmptyState title={tp('noMatchTitle')} description={tp('noMatchDescription')} />
          ) : (
            <ol className="flex list-none flex-col gap-3 p-0">
              {list.parties.map((p) => {
                const moveTargets = list.partyOptions.filter((o) => o.id !== p.id);
                return (
                  <li key={p.id} id={`party-${p.id}`}>
                    <Card className="flex flex-col gap-3">
                      <section aria-labelledby={`party-${p.id}-name`} className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          {p.guests.length ? (
                            <AvatarStack
                              people={p.guests.map((g) => ({
                                name: nameOf(g),
                                initials: initials(nameOf(g)),
                              }))}
                              label={tp('guestsOf', { party: p.name })}
                              size={38}
                            />
                          ) : null}
                          <h3
                            id={`party-${p.id}-name`}
                            className="m-0 text-[16px] font-extrabold tracking-[-0.01em]"
                          >
                            {p.name}
                          </h3>
                          {p.vip ? (
                            <span className={`${pill} bg-brand-soft text-brand-ink`}>{tp('vip')}</span>
                          ) : null}
                          {p.side ? (
                            <span className={`${pill} bg-surface-3 text-ink-2`}>
                              {tp('sideValue', { side: p.side })}
                            </span>
                          ) : null}
                          <span className="text-caption text-ink-2">
                            {tp('guestCount', { count: p.guests.length })}
                          </span>
                        </div>
                        {p.envelopeName ? (
                          <p className="text-caption text-ink-2">
                            {tp('envelopeValue', { name: p.envelopeName })}
                          </p>
                        ) : null}
                        {p.tags.length ? (
                          <ul aria-label={tp('tags')} className="flex list-none flex-wrap gap-1.5 p-0">
                            {p.tags.map((x) => (
                              <li key={x} className={`${pill} bg-surface-3 text-ink-2`}>
                                {x}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {p.notes ? (
                          <p className="text-caption whitespace-pre-line text-ink-2">{p.notes}</p>
                        ) : null}
                        {p.guests.length === 0 ? (
                          <p className="text-caption text-ink-2">{tp('noGuestsInParty')}</p>
                        ) : (
                          <ul
                            aria-label={tp('guestsOf', { party: p.name })}
                            className="flex list-none flex-col gap-2 p-0"
                          >
                            {p.guests.map((g) => {
                              const name = nameOf(g);
                              const unnamed = !g.firstName;
                              const hasPlusOne = p.guests.some((x) => x.hostGuestId === g.id);
                              return (
                                <li
                                  key={g.id}
                                  className="flex flex-col gap-1.5 rounded-tile border border-line bg-surface-2 p-3 data-[plus=true]:ms-6"
                                  data-plus={g.kind === 'plus_one'}
                                >
                                  <span className="flex flex-wrap items-center gap-2">
                                    <Avatar initials={initials(name)} label={name} size={28} decorative />
                                    <span className="text-body font-semibold">{name}</span>
                                    {g.isPrimary ? (
                                      <span className={`${pill} bg-surface-3 text-ink-2`}>
                                        {tp('primary')}
                                      </span>
                                    ) : null}
                                    {g.ageClass !== 'adult' ? (
                                      <span className={`${pill} bg-surface-3 text-ink-2`}>
                                        {tp(`ages.${g.ageClass}`)}
                                      </span>
                                    ) : null}
                                    {g.kind === 'plus_one' ? (
                                      <span className={`${pill} bg-primary-soft text-primary-ink`}>
                                        {unnamed ? tp('plusOnePending') : tp('plusOne')}
                                      </span>
                                    ) : null}
                                  </span>
                                  {g.meal || g.dietary || g.accessibility || g.address ? (
                                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption text-ink-2">
                                      {(
                                        [
                                          ['meal', g.meal],
                                          ['dietary', g.dietary],
                                          ['accessibility', g.accessibility],
                                          ['address', g.address],
                                        ] as const
                                      ).map(([k, v]) =>
                                        v ? (
                                          <div key={k} className="contents">
                                            <dt>{tp(k)}</dt>
                                            <dd className="whitespace-pre-line text-ink">{v}</dd>
                                          </div>
                                        ) : null,
                                      )}
                                    </dl>
                                  ) : null}
                                  {canWrite ? (
                                    <Disclosure summary={tp('editNamed', { name })}>
                                      <ProgramForm
                                        action={updateGuestAction.bind(null, org, event, g.id)}
                                        fields={guestFields(g, g.kind === 'plus_one')}
                                        idPrefix={`guest-${g.id}`}
                                        submitLabel={tp('save')}
                                        successLabel={tp('saved')}
                                        errors={errors}
                                      />
                                      {g.kind === 'guest' && !hasPlusOne ? (
                                        <ProgramForm
                                          action={addPlusOneAction.bind(null, org, event, g.id)}
                                          fields={[]}
                                          idPrefix={`plus-${g.id}`}
                                          submitLabel={tp('addPlusOneFor', { name })}
                                          successLabel={tp('plusOneAdded')}
                                          errors={errors}
                                        />
                                      ) : null}
                                      {g.kind === 'guest' && moveTargets.length ? (
                                        <ProgramForm
                                          action={moveGuestAction.bind(null, org, event, g.id)}
                                          fields={[
                                            {
                                              kind: 'select',
                                              name: 'toPartyId',
                                              label: tp('moveTo', { name }),
                                              hint: hasPlusOne ? tp('moveHintPlusOne') : undefined,
                                              options: [
                                                { value: '', label: tp('choosePartyOption') },
                                                ...moveTargets.map((o) => ({ value: o.id, label: o.name })),
                                              ],
                                            },
                                          ]}
                                          idPrefix={`move-${g.id}`}
                                          submitLabel={tp('move')}
                                          successLabel={tp('moved')}
                                          errors={errors}
                                        />
                                      ) : null}
                                      <ProgramForm
                                        action={removeGuestAction.bind(null, org, event, g.id)}
                                        fields={[]}
                                        idPrefix={`remove-${g.id}`}
                                        submitLabel={
                                          hasPlusOne
                                            ? tp('removeWithPlusOne', { name })
                                            : tp('removeNamed', { name })
                                        }
                                        successLabel={tp('removed')}
                                        errors={errors}
                                      />
                                    </Disclosure>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {canWrite ? (
                          <div className="flex flex-col gap-2">
                            <Disclosure summary={tp('addGuestTo', { party: p.name })}>
                              <ProgramForm
                                action={addGuestAction.bind(null, org, event, p.id)}
                                fields={guestFields()}
                                idPrefix={`add-${p.id}`}
                                submitLabel={tp('addGuest')}
                                successLabel={tp('guestAdded')}
                                errors={errors}
                                reset
                              />
                            </Disclosure>
                            <Disclosure summary={tp('editNamed', { name: p.name })}>
                              <ProgramForm
                                action={updatePartyAction.bind(null, org, event, p.id)}
                                fields={partyFields(p)}
                                idPrefix={`party-${p.id}-edit`}
                                submitLabel={tp('save')}
                                successLabel={tp('saved')}
                                errors={errors}
                              />
                              <ProgramForm
                                action={removePartyAction.bind(null, org, event, p.id)}
                                fields={[]}
                                idPrefix={`party-${p.id}-remove`}
                                submitLabel={tp('removeParty', { name: p.name, count: p.guests.length })}
                                successLabel={tp('removed')}
                                errors={errors}
                              />
                            </Disclosure>
                          </div>
                        ) : null}
                        {historyFor === p.id ? (
                          <section aria-labelledby={`history-${p.id}`} className="flex flex-col gap-2">
                            <h4 id={`history-${p.id}`} className="text-caption font-medium text-ink-2">
                              {tp('historyOf', { party: p.name })}
                            </h4>
                            <ol className="flex list-none flex-col gap-1 p-0">
                              {history.map((h) => {
                                const g = h.guestId ? everyGuest.get(h.guestId) : undefined;
                                return (
                                  <li key={h.id} className="text-caption text-ink-2">
                                    {tp(`actions.${h.action}`)}
                                    {g ? ` · ${nameOf(g)}` : ''} · {tp(`sources.${h.source}`)} ·{' '}
                                    {actorLabel(h.actor)} ·{' '}
                                    <time dateTime={h.at.toISOString()}>{when(h.at)}</time>
                                  </li>
                                );
                              })}
                            </ol>
                            <Link
                              href={filterHref({ page: page > 1 ? String(page) : '' })}
                              className="min-h-6 self-start py-1 text-caption underline"
                            >
                              {tp('hideHistory')}
                            </Link>
                          </section>
                        ) : (
                          <Link
                            href={`${filterHref({ page: page > 1 ? String(page) : '', history: p.id })}#party-${p.id}`}
                            className="min-h-6 self-start py-1 text-caption underline"
                          >
                            {tp('showHistory', { party: p.name })}
                          </Link>
                        )}
                      </section>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
          {pages > 1 ? (
            <Pagination
              label={tp('pagination')}
              link={Link}
              previous={{
                href: page > 1 ? filterHref({ page: String(page - 1) }) : null,
                label: tp('previous'),
              }}
              next={{ href: page < pages ? filterHref({ page: String(page + 1) }) : null, label: tp('next') }}
              status={tp('pageOf', { page, pages })}
            />
          ) : null}
        </section>
        {canWrite ? (
          <section aria-labelledby="add-party-heading" className="xl:sticky xl:top-4">
            <Card size="panel" className="flex scroll-mt-4 flex-col gap-3">
              <h2 id="add-party-heading" className="m-0 text-card">
                {tp('addParty')}
              </h2>
              <p className="text-caption text-ink-2">{tp('addPartyHint')}</p>
              <ProgramForm
                action={createPartyAction.bind(null, org, event)}
                fields={partyFields()}
                idPrefix="new-party"
                submitLabel={tp('addParty')}
                successLabel={tp('partyAdded')}
                errors={errors}
                reset
              />
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
