'use client';

import { type FloorplanDoc, hitTest } from '@yayatoh/floorplan';
import type { GuestSeatingDto } from '@yayatoh/seating';
import { declinedSeated, unseatedOf, vipWarning } from '@yayatoh/seating/client';
import { Alert, Badge, Button, Select, StatusPill } from '@yayatoh/ui';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { GuestSeatingState } from '@/app/[locale]/o/[org]/e/[event]/seating/guests/actions.ts';
import { useRouter } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useRealtime } from '@/lib/use-realtime.ts';
import type { CanvasPlace } from './guest-seating-canvas.tsx';

// Konva needs the browser: the map loads on the client only.
const GuestSeatingCanvas = dynamic(() => import('./guest-seating-canvas.tsx'), { ssr: false });

const DRAG_TYPE = 'application/x-yayatoh-guests';
const field = 'field';

type Party = GuestSeatingDto['parties'][number];
type Guest = Party['guests'][number];
type Place = GuestSeatingDto['places'][number];
type Feedback = { tone: 'info' | 'success' | 'warning' | 'danger'; text: string; more?: string[] } | null;
type StatusFilter = 'all' | 'attending' | 'pending';

const STATUS_TONE = { attending: 'success', pending: 'waiting', declined: 'danger' } as const;

/**
 * The guest seating editor (M4.3a), three panes:
 *
 * - **Unseated** — parties with guests still to seat (RSVP and meal shown; declined guests leave
 *   the queue), searchable and filterable by reply and side. Tick a party (or single guests, or
 *   several parties: a group), choose a table and press "Seat selected guests"; or drag a party
 *   onto the map. "Can't fit" shows before anything is sent.
 * - **Map** — the chart with each table's fill and VIP zones; a drop target for pointer users and
 *   a way to pick a table. It is drawing only (hidden from assistive tech): everything it does
 *   is in the two panes beside it.
 * - **Table details** — who sits at the chosen table, by party, with meals, warnings (declined,
 *   VIP zone), "Move to…" and "Unseat"; the VIP zone switch.
 *
 * Live: the editor follows the guest list (`event.guests`: a plus-one added, a meal or an RSVP
 * changed) and the seating (`event.guest-seats`) and re-reads within a moment.
 */
export function GuestSeatingEditor({
  view,
  doc,
  canWrite,
  seat,
  unseat,
  setVip,
  streams,
}: {
  view: GuestSeatingDto;
  doc: FloorplanDoc;
  canWrite: boolean;
  seat: (input: { itemId: string; guestIds: string[] }) => Promise<GuestSeatingState>;
  unseat: (guestIds: string[]) => Promise<GuestSeatingState>;
  setVip: (input: { itemId: string; vip: boolean }) => Promise<GuestSeatingState>;
  streams: { guests: string | null; seats: string | null };
}) {
  const t = useTranslations('seating.guestSeating');
  const tRoot = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [side, setSide] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState('');
  const [detail, setDetail] = useState(view.places[0]?.itemId ?? '');
  const [hover, setHover] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ guestIds: string[]; name: string; itemId: string } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [dragHint, setDragHint] = useState('');
  /** The VIP switch shows the host's choice at once (the page re-reads after the change). */
  const [vipChoice, setVipChoice] = useState<Readonly<Record<string, boolean>>>({});
  const dragged = useRef<string[] | null>(null);
  const plan = useRef<HTMLDivElement>(null);
  const moveSelect = useRef<HTMLButtonElement>(null);

  // Live: re-read shortly after the guest list or the seating changes (coalesced).
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 500);
  }, [router]);
  useEffect(() => () => (refreshTimer.current ? clearTimeout(refreshTimer.current) : undefined), []);
  // The first snapshot of each stream is what the page already shows; a later one may not be.
  const snapshots = useRef({ guests: 0, seats: 0 });
  const onSnapshot = (k: 'guests' | 'seats') => () => {
    snapshots.current[k] += 1;
    if (snapshots.current[k] > 1) refreshSoon();
  };
  const guestsLive = useRealtime(streams.guests, ['snapshot', 'party', 'list'], {
    snapshot: onSnapshot('guests'),
    party: refreshSoon,
    list: refreshSoon,
  });
  const seatsLive = useRealtime(streams.seats, ['snapshot', 'seats'], {
    snapshot: onSnapshot('seats'),
    seats: refreshSoon,
  });
  const live =
    guestsLive === 'live' && seatsLive === 'live'
      ? 'live'
      : guestsLive === 'offline' || seatsLive === 'offline'
        ? 'offline'
        : 'connecting';

  const places = view.places;
  const byPlace = useMemo(() => new Map(places.map((p) => [p.itemId, p])), [places]);
  const guestById = useMemo(
    () => new Map(view.parties.flatMap((p) => p.guests.map((g) => [g.id, g] as const))),
    [view.parties],
  );
  const placeName = (p: Pick<Place, 'kind' | 'label'>) => t(`place.${p.kind}`, { label: p.label });
  const guestName = (g: Guest) => g.name ?? t('guest.guestOf', { name: g.guestOf ?? '?' });

  // The queue: parties with guests still to seat, filtered.
  const queue = useMemo(
    () =>
      view.parties.flatMap((p) => {
        const open = unseatedOf(p.guests);
        return open.length ? [{ party: p, open }] : [];
      }),
    [view.parties],
  );
  const queueIds = useMemo(() => new Set(queue.flatMap((q) => q.open.map((g) => g.id))), [queue]);
  const sides = useMemo(
    () => [...new Set(view.parties.map((p) => p.side).filter((s): s is string => !!s))].sort(),
    [view.parties],
  );
  const q = query.trim().toLowerCase();
  const shown = queue.flatMap(({ party, open }) => {
    if (side && party.side !== side) return [];
    const guests = open.filter((g) => status === 'all' || g.status === status);
    if (!guests.length) return [];
    const hit =
      !q ||
      party.name.toLowerCase().includes(q) ||
      guests.some((g) => guestName(g).toLowerCase().includes(q));
    return hit ? [{ party, guests }] : [];
  });
  // Someone seated meanwhile (a refresh) drops out of the selection.
  const selected = useMemo(() => new Set([...picked].filter((id) => queueIds.has(id))), [picked, queueIds]);
  const unseatedCount = queueIds.size;
  const chosen = target ? byPlace.get(target) : undefined;
  const cantFit = chosen && selected.size > chosen.free;

  const errorText = (r: GuestSeatingState) => {
    if (r.code === 'forbidden') return t('errors.forbidden');
    switch (r.reason) {
      case 'cant_fit':
        return t('errors.cantFit', { asked: r.asked ?? 0, fits: r.fits ?? 0 });
      case 'declined':
        return t('errors.declined');
      case 'unknown_guest':
        return t('errors.unknown');
      case 'no_plan':
        return t('errors.noPlan');
      default:
        return tRoot(errorMessageKey(r.code));
    }
  };
  const warningsText = (r: GuestSeatingState, place: Place) =>
    (r.warnings ?? []).map((w) =>
      t(`warnings.${w.kind}`, {
        party: view.parties.find((p) => p.id === w.partyId)?.name ?? '',
        place: placeName(place),
      }),
    );

  const doSeat = (
    guestIds: string[],
    itemId: string,
    opts: { moveName?: string; after?: () => void } = {},
  ) => {
    const place = byPlace.get(itemId);
    if (!place) return;
    startTransition(async () => {
      const r = await seat({ itemId, guestIds });
      if (r.ok) {
        const warnings = warningsText(r, place);
        setFeedback({
          tone: warnings.length ? 'warning' : 'success',
          text: opts.moveName
            ? t('done.moved', { name: opts.moveName, place: placeName(place) })
            : t('done.seated', { count: r.count ?? guestIds.length, place: placeName(place) }),
          more: warnings,
        });
        setPicked(new Set());
        setDetail(itemId);
        opts.after?.();
        router.refresh();
      } else setFeedback({ tone: 'danger', text: errorText(r) });
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selected.size) return setFeedback({ tone: 'danger', text: t('errors.noGuests') });
    if (!target) return setFeedback({ tone: 'danger', text: t('errors.noPlace') });
    doSeat([...selected], target);
  };

  const doUnseat = (guestIds: string[]) =>
    startTransition(async () => {
      const r = await unseat(guestIds);
      if (r.ok) {
        setFeedback({ tone: 'success', text: t('done.unseated', { count: r.count ?? guestIds.length }) });
        router.refresh();
      } else setFeedback({ tone: 'danger', text: errorText(r) });
    });

  // A fresh view from the server replaces any choice shown ahead of it.
  useEffect(() => setVipChoice({}), [places]);
  const doVip = (place: Place, vip: boolean) => {
    setVipChoice((c) => ({ ...c, [place.itemId]: vip }));
    startTransition(async () => {
      const r = await setVip({ itemId: place.itemId, vip });
      if (!r.ok) setVipChoice((c) => ({ ...c, [place.itemId]: !vip }));
      if (r.ok) {
        setFeedback({
          tone: 'success',
          text: t(vip ? 'done.vipOn' : 'done.vipOff', { place: placeName(place) }),
        });
        router.refresh();
      } else setFeedback({ tone: 'danger', text: errorText(r) });
    });
  };

  const onMove = (e: FormEvent) => {
    e.preventDefault();
    if (!moving) return;
    if (!moving.itemId) return setFeedback({ tone: 'danger', text: t('errors.noPlace') });
    doSeat(moving.guestIds, moving.itemId, { moveName: moving.name, after: () => setMoving(null) });
  };
  // Opening "Move to…" puts the keyboard on its table chooser.
  const movingKey = moving?.guestIds.join(',');
  useEffect(() => {
    if (movingKey) moveSelect.current?.focus();
  }, [movingKey]);

  const toggle = (ids: readonly string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setPicked(next);
  };

  // Drag and drop: the drop point is mapped from the page to the room (centimetres) and hit-tested.
  const placeAt = (clientX: number, clientY: number): string | null => {
    const canvas = plan.current?.querySelector('canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const scale = r.width / doc.width;
    if (!scale) return null;
    const hit = hitTest(doc, { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale });
    return hit && byPlace.has(hit.itemId) ? hit.itemId : null;
  };
  /** A party drags its ticked guests (with every other ticked guest: a group), else all of its own. */
  const dragIds = (open: readonly Guest[]) =>
    open.some((g) => selected.has(g.id)) ? [...selected] : open.map((g) => g.id);
  const onDragStart = (e: DragEvent, ids: string[]) => {
    dragged.current = ids;
    e.dataTransfer.setData(DRAG_TYPE, ids.join(','));
    e.dataTransfer.setData('text/plain', ids.join(','));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => {
    dragged.current = null;
    setHover(null);
    setDragHint('');
  };
  const onDragOver = (e: DragEvent) => {
    if (!canWrite) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const next = placeAt(e.clientX, e.clientY);
    if (next === hover) return;
    setHover(next);
    const p = next ? byPlace.get(next) : undefined;
    const count = dragged.current?.length ?? 0;
    setDragHint(
      p
        ? count > p.free
          ? t('map.dropCantFit', { place: placeName(p), count, free: p.free })
          : t('map.dropHere', { place: placeName(p), free: p.free })
        : '',
    );
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain');
    const ids = dragged.current ?? raw.split(',').filter((id) => guestById.has(id));
    const itemId = placeAt(e.clientX, e.clientY);
    onDragEnd();
    if (!ids.length) return;
    if (!itemId) return setFeedback({ tone: 'danger', text: t('errors.dropMiss') });
    const [only] = ids;
    const g = ids.length === 1 && only ? guestById.get(only) : undefined;
    doSeat(ids, itemId, g?.itemId ? { moveName: guestName(g) } : {});
  };
  // A click (or tap) on a table opens its details; the details chooser does the same by keyboard.
  const onPlanClick = (e: { clientX: number; clientY: number }) => {
    const id = placeAt(e.clientX, e.clientY);
    if (id) setDetail(id);
  };

  const canvasPlaces = useMemo(
    () =>
      new Map<string, CanvasPlace>(
        places.map((p) => [
          p.itemId,
          { itemId: p.itemId, taken: p.taken, seated: p.seated, capacity: p.capacity, vip: p.vip },
        ]),
      ),
    [places],
  );

  // Table details.
  const shownPlace = detail ? byPlace.get(detail) : undefined;
  const atPlace = shownPlace
    ? view.parties.flatMap((p) => {
        const here = p.guests.filter((g) => g.itemId === shownPlace.itemId);
        return here.length ? [{ party: p, guests: here }] : [];
      })
    : [];
  const meals = new Map<string, number>();
  for (const { guests } of atPlace)
    for (const g of guests) {
      const key = g.meal ?? '';
      meals.set(key, (meals.get(key) ?? 0) + 1);
    }
  const placeWarnings = shownPlace
    ? atPlace.flatMap(({ party, guests }) => [
        ...declinedSeated(guests).map((g) => t('details.warnDeclined', { name: guestName(g) })),
        ...(vipWarning(party.vip, shownPlace.vip) === 'vip_outside'
          ? [t('details.warnVipOutside', { party: party.name })]
          : vipWarning(party.vip, shownPlace.vip) === 'not_vip_inside'
            ? [t('details.warnNotVip', { party: party.name })]
            : []),
      ])
    : [];
  const placeOption = (p: Place) =>
    t(p.vip ? 'form.optionVip' : 'form.option', { place: placeName(p), free: p.free, capacity: p.capacity });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-body text-ink-2">
            {t('summary', { seated: view.counts.seated, unseated: unseatedCount })}
          </p>
          <StatusPill
            tone={live === 'live' ? 'success' : live === 'offline' ? 'danger' : 'waiting'}
            label={t(`live.${live}`)}
            live={live === 'live'}
          />
        </div>
        {canWrite ? null : <p className="m-0 text-caption text-ink-2">{t('readOnly')}</p>}
        {view.counts.declinedSeated ? (
          <Alert tone="warning" title={t('declinedSeated', { count: view.counts.declinedSeated })} />
        ) : null}
        <div aria-live="polite" aria-atomic="true">
          {feedback ? (
            <Alert tone={feedback.tone} title={feedback.text}>
              {feedback.more?.length ? (
                <ul className="m-0 list-none p-0">
                  {feedback.more.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,20rem)]">
        {/* Pane 1: the unseated queue. */}
        <section aria-labelledby="gs-queue-heading" data-live={live} className="flex min-w-0 flex-col gap-3">
          <h2 id="gs-queue-heading" className="m-0 text-card">
            {t('queue.title', { count: unseatedCount })}
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gs-search" className="text-[13px] font-bold text-ink">
              {t('queue.search')}
            </label>
            <input
              id="gs-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              className={field}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="gs-status" className="text-[13px] font-bold text-ink">
                {t('queue.status')}
              </label>
              <Select id="gs-status" value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                <option value="all">{t('queue.statusAll')}</option>
                <option value="attending">{t('status.attending')}</option>
                <option value="pending">{t('status.pending')}</option>
              </Select>
            </div>
            {sides.length ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="gs-side" className="text-[13px] font-bold text-ink">
                  {t('queue.side')}
                </label>
                <Select id="gs-side" value={side} onValueChange={(v) => setSide(v)}>
                  <option value="">{t('queue.sideAll')}</option>
                  {sides.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
          {canWrite && unseatedCount ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="m-0 text-caption text-ink-2">
                {t('queue.selected', { count: selected.size })}
              </p>
              {selected.size ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                  {t('queue.clear')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {unseatedCount === 0 ? (
            <p className="m-0 text-body text-ink-2">{t('queue.empty')}</p>
          ) : shown.length === 0 ? (
            <p className="m-0 text-body text-ink-2">{t('queue.noMatch')}</p>
          ) : (
            <ul
              aria-label={t('queue.list')}
              className="m-0 flex max-h-[32rem] list-none flex-col gap-2 overflow-y-auto p-0"
            >
              {shown.map(({ party, guests }) => {
                const open = queue.find((x) => x.party.id === party.id)?.open ?? guests;
                const all = guests.every((g) => selected.has(g.id));
                return (
                  <li
                    key={party.id}
                    data-testid={`queue-party-${party.id}`}
                    draggable={canWrite}
                    onDragStart={canWrite ? (e) => onDragStart(e, dragIds(open)) : undefined}
                    onDragEnd={onDragEnd}
                    className={`flex flex-col gap-1.5 rounded-tile border p-3 ${all && canWrite ? 'border-ink bg-surface-3' : 'border-line bg-surface'} ${canWrite ? 'cursor-grab' : ''}`}
                  >
                    <div className="flex min-h-6 items-center gap-2">
                      {canWrite ? (
                        <input
                          id={`gs-party-${party.id}`}
                          type="checkbox"
                          className="size-6 shrink-0"
                          checked={all}
                          onChange={(e) =>
                            toggle(
                              guests.map((g) => g.id),
                              e.currentTarget.checked,
                            )
                          }
                          aria-label={t('queue.selectParty', { party: party.name })}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-body font-bold">{party.name}</span>
                      {party.vip ? <Badge tone="brand">{t('vip')}</Badge> : null}
                      <span className="text-caption text-ink-2">
                        {t('queue.toSeat', { count: guests.length })}
                      </span>
                    </div>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0 ps-2">
                      {guests.map((g) => (
                        <li key={g.id} className="flex min-h-6 flex-wrap items-center gap-2">
                          {canWrite ? (
                            <input
                              id={`gs-guest-${g.id}`}
                              type="checkbox"
                              className="size-6 shrink-0"
                              checked={selected.has(g.id)}
                              onChange={(e) => toggle([g.id], e.currentTarget.checked)}
                            />
                          ) : null}
                          <label
                            htmlFor={canWrite ? `gs-guest-${g.id}` : undefined}
                            className="min-w-0 flex-1 text-body"
                          >
                            <span className="block truncate">{guestName(g)}</span>
                            <span className="block text-caption text-ink-2">
                              {g.meal ? t('guest.meal', { meal: g.meal }) : t('guest.noMeal')}
                              {g.ageClass !== 'adult' ? ` · ${t(`guest.${g.ageClass}`)}` : ''}
                            </span>
                          </label>
                          <StatusPill tone={STATUS_TONE[g.status]} label={t(`status.${g.status}`)} />
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}

          {canWrite ? (
            <form
              onSubmit={onSubmit}
              aria-labelledby="gs-form-heading"
              className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
            >
              <h3 id="gs-form-heading" className="m-0 text-body font-bold">
                {t('form.title')}
              </h3>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="gs-target" className="text-[13px] font-bold text-ink">
                  {t('form.table')}
                </label>
                <Select
                  id="gs-target"
                  value={target}
                  onValueChange={(v) => setTarget(v)}
                  aria-describedby={cantFit ? 'gs-cant-fit' : undefined}
                >
                  <option value="">{t('form.choose')}</option>
                  {places.map((p) => (
                    <option key={p.itemId} value={p.itemId}>
                      {placeOption(p)}
                    </option>
                  ))}
                </Select>
              </div>
              {cantFit && chosen ? (
                <p id="gs-cant-fit" className="m-0 text-caption font-bold text-warning">
                  {t('form.cantFit', { asked: selected.size, fits: chosen.free, place: placeName(chosen) })}
                </p>
              ) : null}
              <Button type="submit" disabled={pending} className="self-start">
                {pending ? t('form.submitting') : t('form.submit')}
              </Button>
            </form>
          ) : null}
        </section>

        {/* Pane 2: the map. */}
        <section aria-labelledby="gs-map-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="gs-map-heading" className="m-0 text-card">
            {t('map.title')}
          </h2>
          <p className="m-0 text-caption text-ink-2">{canWrite ? t('map.hint') : t('map.readOnlyHint')}</p>
          {/* A drop target and table picker for pointer users; the panes beside it do the same by keyboard. */}
          <div
            ref={plan}
            data-testid="guest-seating-map"
            onDragOver={onDragOver}
            onDragLeave={() => {
              setHover(null);
              setDragHint('');
            }}
            onDrop={canWrite ? onDrop : undefined}
            onPointerUp={onPlanClick}
            aria-hidden="true"
          >
            <GuestSeatingCanvas doc={doc} places={canvasPlaces} selected={detail || null} hover={hover} />
          </div>
          <p aria-live="polite" className="m-0 min-h-5 text-caption font-bold text-ink-2">
            {dragHint}
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-ink-2">
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-pill border border-line-strong bg-primary"
              />
              {t('map.guests')}
            </li>
            {places.some((p) => p.taken > 0) ? (
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block size-3 rounded-pill border border-line-strong bg-tag"
                />
                {t('map.tickets')}
              </li>
            ) : null}
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-pill border-2 border-warning-dot"
              />
              {t('map.vip')}
            </li>
          </ul>
        </section>

        {/* Pane 3: table details. */}
        <section aria-labelledby="gs-details-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="gs-details-heading" className="m-0 text-card">
            {t('details.title')}
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gs-detail" className="text-[13px] font-bold text-ink">
              {t('details.choose')}
            </label>
            <Select
              id="gs-detail"
              value={detail}
              onValueChange={(v) => {
                setDetail(v);
                setMoving(null);
              }}
            >
              {places.map((p) => (
                <option key={p.itemId} value={p.itemId}>
                  {placeOption(p)}
                </option>
              ))}
            </Select>
          </div>
          {shownPlace ? (
            <section
              aria-label={placeName(shownPlace)}
              data-testid="guest-seating-details"
              className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-body font-bold">{placeName(shownPlace)}</h3>
                {shownPlace.vip ? <Badge tone="brand">{t('details.vipZone')}</Badge> : null}
              </div>
              <p className="m-0 text-caption text-ink-2">
                {t('details.counts', {
                  seated: shownPlace.seated,
                  free: shownPlace.free,
                  capacity: shownPlace.capacity,
                })}
                {shownPlace.taken ? ` · ${t('details.tickets', { count: shownPlace.taken })}` : ''}
              </p>
              {shownPlace.sponsor ? (
                <p className="m-0 text-caption text-ink-2">
                  {t('details.sponsor', { name: shownPlace.sponsor })}
                </p>
              ) : null}
              {shownPlace.sectionVip ? (
                <p className="m-0 text-caption text-ink-2">{t('details.vipFromPlan')}</p>
              ) : canWrite ? (
                <label className="flex min-h-6 items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    className="size-6 shrink-0"
                    checked={vipChoice[shownPlace.itemId] ?? shownPlace.vip}
                    disabled={pending}
                    onChange={(e) => doVip(shownPlace, e.currentTarget.checked)}
                  />
                  {t('details.vipZone')}
                </label>
              ) : null}
              {placeWarnings.length ? (
                <Alert tone="warning" title={t('details.warnings')}>
                  <ul className="m-0 list-none p-0">
                    {placeWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {meals.size ? (
                <div className="flex flex-col gap-1">
                  <h4 className="m-0 text-caption font-bold text-ink">{t('details.meals')}</h4>
                  <ul className="m-0 flex list-none flex-wrap gap-x-3 p-0 text-caption text-ink-2">
                    {[...meals].map(([meal, count]) => (
                      <li key={meal}>
                        {t('details.mealCount', { meal: meal || t('details.noMeal'), count })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {atPlace.length === 0 ? (
                <p className="m-0 text-body text-ink-2">{t('details.empty')}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {atPlace.map(({ party, guests }) => (
                    <li
                      key={party.id}
                      draggable={canWrite}
                      onDragStart={
                        canWrite
                          ? (e) =>
                              onDragStart(
                                e,
                                guests.map((g) => g.id),
                              )
                          : undefined
                      }
                      onDragEnd={onDragEnd}
                      className={`flex flex-col gap-1.5 ${canWrite ? 'cursor-grab' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-body font-bold">{party.name}</span>
                        {party.vip ? <Badge tone="brand">{t('vip')}</Badge> : null}
                        {canWrite ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => doUnseat(guests.map((g) => g.id))}
                          >
                            {t('details.unseatParty', { party: party.name })}
                          </Button>
                        ) : null}
                      </div>
                      <ul className="m-0 flex list-none flex-col gap-1 p-0 ps-2">
                        {guests.map((g) => {
                          const name = guestName(g);
                          const isMoving = moving?.guestIds.length === 1 && moving.guestIds[0] === g.id;
                          return (
                            <li key={g.id} data-testid={`seated-${g.id}`} className="flex flex-col gap-1.5">
                              <div className="flex min-h-6 flex-wrap items-center gap-2 text-body">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{name}</span>
                                  <span className="block text-caption text-ink-2">
                                    {g.meal ? t('guest.meal', { meal: g.meal }) : t('guest.noMeal')}
                                  </span>
                                </span>
                                {g.status !== 'attending' ? (
                                  <StatusPill tone={STATUS_TONE[g.status]} label={t(`status.${g.status}`)} />
                                ) : null}
                                {canWrite ? (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      disabled={pending}
                                      aria-expanded={isMoving}
                                      aria-label={t('details.moveLabel', { name })}
                                      onClick={() =>
                                        setMoving(isMoving ? null : { guestIds: [g.id], name, itemId: '' })
                                      }
                                    >
                                      {t('details.move')}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      disabled={pending}
                                      aria-label={t('details.unseatLabel', { name })}
                                      onClick={() => doUnseat([g.id])}
                                    >
                                      {t('details.unseat')}
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                              {isMoving && moving ? (
                                <form
                                  onSubmit={onMove}
                                  aria-label={t('details.moveTo', { name })}
                                  className="flex flex-col gap-2 rounded-tile border border-line bg-surface-2 p-3"
                                >
                                  <label
                                    htmlFor={`gs-move-${g.id}`}
                                    className="text-[13px] font-bold text-ink"
                                  >
                                    {t('form.table')}
                                  </label>
                                  <Select
                                    ref={moveSelect}
                                    id={`gs-move-${g.id}`}
                                    value={moving.itemId}
                                    onValueChange={(v) => setMoving({ ...moving, itemId: v })}
                                  >
                                    <option value="">{t('form.choose')}</option>
                                    {places
                                      .filter((p) => p.itemId !== shownPlace.itemId)
                                      .map((p) => (
                                        <option key={p.itemId} value={p.itemId}>
                                          {placeOption(p)}
                                        </option>
                                      ))}
                                  </Select>
                                  <div className="flex flex-wrap gap-2">
                                    <Button type="submit" size="sm" disabled={pending}>
                                      {t('details.moveSubmit')}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setMoving(null)}
                                    >
                                      {t('details.cancel')}
                                    </Button>
                                  </div>
                                </form>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <p className="m-0 text-body text-ink-2">{t('details.none')}</p>
          )}
        </section>
      </div>
    </div>
  );
}
