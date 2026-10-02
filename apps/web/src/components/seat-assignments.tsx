'use client';

import { type FloorplanDoc, hitTest } from '@yayatoh/floorplan';
import type { AssignSeatState, SeatAssignmentsDto } from '@yayatoh/seating';
import { activeAdaRule, type SeatingRule } from '@yayatoh/seating/client';
import { Alert, Button, Card } from '@yayatoh/ui';
import dynamic from 'next/dynamic';
import { useFormatter, useTranslations } from 'next-intl';
import {
  type DragEvent,
  type FormEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { AssignState } from '@/app/[locale]/o/[org]/e/[event]/seating/actions.ts';
import { useRouter } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useSeatStream } from '@/lib/use-seat-stream.ts';

// Konva needs the browser: the plan loads on the client only.
const AssignmentCanvas = dynamic(() => import('./assignment-canvas.tsx'), { ssr: false });

/** The queue shows this many names at once; search finds the rest. */
const SHOWN = 200;
const DRAG_TYPE = 'application/x-yayatoh-attendees';
const field = 'field';

type Feedback = { tone: 'info' | 'danger'; text: string } | null;
type Target = { itemId: string; seatId: string | null };
type Item = SeatAssignmentsDto['items'][number];
type Seat = Item['seats'][number];
type Moving = { attendeeId: string; name: string; itemId: string; seatId: string; override: boolean };

/**
 * Seat guests (M1.7d). The unseated queue (search, tick names), a table/row and seat chooser
 * and "Seat them" do everything by keyboard; dragging a name (or the ticked names) onto a table
 * or seat of the plan does the same with a pointer. Each table lists who sits there, with Remove
 * and "Move to…" (M1.7f); a seated guest can also be dragged — their name from the table list,
 * or their seat on the plan (mouse, pen or touch) — to another table or seat.
 *
 * Seating rules (M1.7f): while accessible seats are kept back, seating someone in one warns; when
 * the rule is enforced, the organizer confirms the guest needs it. The page follows the seat
 * stream, so seats bought or held meanwhile show without a reload.
 */
export function SeatAssignments({
  view,
  doc,
  canWrite,
  assign,
  unassign,
  rules = [],
  startsAt,
  timeZone,
  streamUrl = null,
}: {
  view: SeatAssignmentsDto;
  doc: FloorplanDoc;
  canWrite: boolean;
  assign: (input: {
    attendeeIds: string[];
    itemId: string;
    seatUuid?: string | null;
    overrideRules?: boolean;
  }) => Promise<AssignState>;
  unassign: (attendeeId: string) => Promise<AssignState>;
  rules?: readonly SeatingRule[];
  startsAt?: Date;
  timeZone?: string;
  streamUrl?: string | null;
}) {
  const t = useTranslations('seating');
  const tRoot = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [itemId, setItemId] = useState('');
  const [seatId, setSeatId] = useState('');
  const [override, setOverride] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [hover, setHover] = useState<Target | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const dragged = useRef<string[] | null>(null);
  const pointerDrag = useRef<{ attendeeId: string; name: string; from: Target } | null>(null);
  const plan = useRef<HTMLDivElement>(null);
  const moveSelect = useRef<HTMLSelectElement>(null);

  // Live (M1.7f): seats held, bought or given meanwhile show without a reload.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 1_000);
  }, [router]);
  useEffect(() => () => (refreshTimer.current ? clearTimeout(refreshTimer.current) : undefined), []);
  // The first snapshot is what the page already shows; a later one (after a gap) may not be.
  const snapshots = useRef(0);
  useSeatStream(streamUrl, {
    onSnapshot: () => {
      snapshots.current += 1;
      if (snapshots.current > 1) refreshSoon();
    },
    onDelta: refreshSoon,
    onRefresh: refreshSoon,
  });

  const ada = startsAt ? activeAdaRule(rules, new Date(startsAt), new Date()) : null;
  const when = (iso: string | Date) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    });

  const itemName = (i: { kind: 'row' | 'table'; label: string }) =>
    t(`prices.item.${i.kind}`, { label: i.label });
  const items = view.items;
  const byItem = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const seatById = useMemo(
    () => new Map(items.flatMap((i) => i.seats.map((s) => [s.seatUuid, s] as const))),
    [items],
  );
  const unseatedIds = useMemo(() => new Set(view.unseated.map((p) => p.id)), [view.unseated]);
  const seatedGuests = useMemo(
    () =>
      new Map(
        items.flatMap((i) =>
          i.seats.flatMap((s) =>
            s.person && !s.person.byTicket ? [[s.person.attendeeId, s.person.name] as const] : [],
          ),
        ),
      ),
    [items],
  );
  // Someone seated meanwhile (a refresh) drops out of the selection.
  const selected = useMemo(
    () => new Set([...picked].filter((id) => unseatedIds.has(id))),
    [picked, unseatedIds],
  );
  const q = query.trim().toLowerCase();
  const matching = q
    ? view.unseated.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
    : view.unseated;
  const shown = matching.slice(0, SHOWN);
  const chosen = itemId ? byItem.get(itemId) : undefined;
  const choicesAt = (i: Item | undefined, keep: string | null = null) =>
    i?.seats.filter((s) => s.state === 'free' || s.state === 'reserved' || s.seatUuid === keep) ?? [];
  const seatChoices = choicesAt(chosen);
  const seatState = useMemo(
    () =>
      Object.fromEntries(items.flatMap((i) => i.seats.map((s) => [s.seatUuid, s.state]))) as Record<
        string,
        AssignSeatState
      >,
    [items],
  );
  const taken = (i: Item) => i.seats.filter((s) => s.person).length;
  const occupancy = useMemo(
    () =>
      Object.fromEntries(items.map((i) => [i.id, `${i.seats.filter((s) => s.person).length}/${i.capacity}`])),
    [items],
  );
  /** A kept-back accessible seat (seating rules): labelled as such where seats are chosen. */
  const kept = (s: Seat | undefined) => Boolean(ada && s?.accessible);
  const seatOption = (s: Seat) => {
    const base = s.state === 'reserved' ? t('assign.form.seatKept', { label: s.label }) : s.label;
    return kept(s) ? t('assign.form.seatAccessible', { label: base }) : base;
  };
  const needsConfirm = (id: string) => ada?.severity === 'enforce' && kept(seatById.get(id));

  const errorText = (r: AssignState) => {
    if (r.code === 'forbidden') return t('assign.errors.forbidden');
    switch (r.reason) {
      case 'not_enough_seats':
        return t('assign.errors.notEnough', { asked: r.asked ?? 0, fits: r.fits ?? 0 });
      case 'seat_taken':
        return t('assign.errors.seatTaken');
      case 'seat_blocked':
        return t('assign.errors.seatBlocked');
      case 'seats_taken':
        return t('assign.errors.seatsTaken');
      case 'seated_by_ticket':
        return t('assign.errors.seatedByTicket');
      case 'attendee_cancelled':
        return t('assign.errors.cancelled');
      case 'seat_rule':
        return t('assign.errors.adaEnforced');
      default:
        return tRoot(errorMessageKey(r.code));
    }
  };

  const seat = (
    ids: string[],
    target: Target,
    opts: { move?: { name: string }; override?: boolean; after?: () => void } = {},
  ) => {
    const item = byItem.get(target.itemId);
    if (!item) return;
    startTransition(async () => {
      const r = await assign({
        attendeeIds: ids,
        itemId: target.itemId,
        // A drop of several people on one seat seats them at its table.
        seatUuid: ids.length === 1 ? target.seatId : null,
        overrideRules: opts.override === true,
      });
      if (r.ok) {
        const done = opts.move
          ? t('assign.moved', { name: opts.move.name, item: itemName(item) })
          : t('assign.done', { count: r.count ?? ids.length, item: itemName(item) });
        const warning = r.adaWarning
          ? ` ${t('assign.adaWarning', { count: r.adaWarning.seats.length, seats: r.adaWarning.seats.join(', '), date: when(r.adaWarning.releaseAt) })}`
          : '';
        setFeedback({ tone: 'info', text: done + warning });
        setPicked(new Set());
        setSeatId('');
        setOverride(false);
        opts.after?.();
        router.refresh();
      } else setFeedback({ tone: 'danger', text: errorText(r) });
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selected.size) return setFeedback({ tone: 'danger', text: t('assign.errors.noPeople') });
    if (!itemId) return setFeedback({ tone: 'danger', text: t('assign.errors.noItem') });
    if (seatId && selected.size > 1)
      return setFeedback({ tone: 'danger', text: t('assign.errors.onePerSeat') });
    seat([...selected], { itemId, seatId: seatId || null }, { override });
  };

  const onMove = (e: FormEvent) => {
    e.preventDefault();
    if (!moving) return;
    if (!moving.itemId) return setFeedback({ tone: 'danger', text: t('assign.errors.noItem') });
    seat(
      [moving.attendeeId],
      { itemId: moving.itemId, seatId: moving.seatId || null },
      { move: { name: moving.name }, override: moving.override, after: () => setMoving(null) },
    );
  };
  // Opening "Move to…" puts the keyboard on its table chooser.
  useEffect(() => {
    if (moving) moveSelect.current?.focus();
  }, [moving?.attendeeId]);

  const remove = (attendeeId: string, name: string) =>
    startTransition(async () => {
      const r = await unassign(attendeeId);
      if (r.ok) {
        setFeedback({ tone: 'info', text: t('assign.removed', { name }) });
        router.refresh();
      } else setFeedback({ tone: 'danger', text: errorText(r) });
    });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  // Drag and drop: the drop point is mapped from the page to the room (centimetres) and hit-tested.
  const targetAt = (clientX: number, clientY: number): Target | null => {
    const canvas = plan.current?.querySelector('canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const scale = r.width / doc.width;
    if (!scale) return null;
    const hit = hitTest(doc, { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale });
    return hit && byItem.has(hit.itemId) ? hit : null;
  };
  const onDragStart = (e: DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    dragged.current = ids;
    e.dataTransfer.setData(DRAG_TYPE, ids.join(','));
    e.dataTransfer.setData('text/plain', ids.join(','));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent) => {
    if (!canWrite) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const next = targetAt(e.clientX, e.clientY);
    if (next?.itemId !== hover?.itemId || next?.seatId !== hover?.seatId) setHover(next);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setHover(null);
    const raw = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain');
    const ids = dragged.current ?? raw.split(',').filter((id) => unseatedIds.has(id) || seatedGuests.has(id));
    dragged.current = null;
    if (!ids.length) return;
    const target = targetAt(e.clientX, e.clientY);
    if (!target) return setFeedback({ tone: 'danger', text: t('assign.errors.dropMiss') });
    const [only] = ids;
    const name = ids.length === 1 && only ? seatedGuests.get(only) : undefined;
    seat(ids, target, name ? { move: { name } } : {});
  };

  // Moving a seated guest on the plan itself: press on their seat, drag, release on another table
  // or seat (mouse, pen or touch). "Move to…" in the table list does the same by keyboard.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canWrite || e.button > 0) return;
    const from = targetAt(e.clientX, e.clientY);
    const person = from?.seatId ? seatById.get(from.seatId)?.person : null;
    if (!from || !person || person.byTicket) return;
    pointerDrag.current = { attendeeId: person.attendeeId, name: person.name, from };
    e.currentTarget.setPointerCapture(e.pointerId);
    setHover(from);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointerDrag.current) return;
    const next = targetAt(e.clientX, e.clientY);
    if (next?.itemId !== hover?.itemId || next?.seatId !== hover?.seatId) setHover(next);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = pointerDrag.current;
    pointerDrag.current = null;
    if (!d) return;
    setHover(null);
    const target = targetAt(e.clientX, e.clientY);
    // Released where it started (or nowhere): nothing moves.
    if (!target || (target.itemId === d.from.itemId && target.seatId === d.from.seatId)) return;
    seat([d.attendeeId], target, { move: { name: d.name } });
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-2">
        {t('assign.summary', { seated: view.seatedCount, unseated: view.unseated.length })}
      </p>
      {canWrite ? null : <p className="text-caption text-ink-2">{t('assign.readOnly')}</p>}
      {ada ? (
        <p className="text-caption text-ink-2">
          {t(ada.severity === 'enforce' ? 'assign.adaEnforcedNote' : 'assign.adaNote', {
            date: when(ada.releaseAt),
          })}
        </p>
      ) : null}
      <div aria-live="polite" aria-atomic="true">
        {feedback ? <Alert tone={feedback.tone} title={feedback.text} /> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section aria-labelledby="queue-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="queue-heading" className="text-section">
            {t('assign.queue.title', { count: view.unseated.length })}
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="queue-search" className="text-caption text-ink-2">
              {t('assign.queue.search')}
            </label>
            <input
              id="queue-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              className={field}
            />
          </div>
          {canWrite && view.unseated.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="text-caption text-ink-2">
                {t('assign.queue.selected', { count: selected.size })}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPicked(new Set([...selected, ...shown.map((p) => p.id)]))}
              >
                {t('assign.queue.selectShown')}
              </Button>
              {selected.size ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                  {t('assign.queue.clear')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {view.unseated.length === 0 ? (
            <p className="text-body text-ink-2">{t('assign.queue.empty')}</p>
          ) : matching.length === 0 ? (
            <p className="text-body text-ink-2">{t('assign.queue.noMatch', { q: query.trim() })}</p>
          ) : (
            <ul
              aria-label={t('assign.queue.list')}
              className="flex max-h-[28rem] list-none flex-col gap-1.5 overflow-y-auto"
            >
              {shown.map((p) => (
                <li
                  key={p.id}
                  draggable={canWrite}
                  onDragStart={canWrite ? (e) => onDragStart(e, p.id) : undefined}
                  onDragEnd={() => {
                    dragged.current = null;
                    setHover(null);
                  }}
                  className={`flex min-h-10 items-center gap-2 rounded-pill border px-3 ${selected.has(p.id) ? 'border-ink bg-surface-3' : 'border-line bg-surface'} ${canWrite ? 'cursor-grab' : ''}`}
                >
                  {canWrite ? (
                    <input
                      id={`q-${p.id}`}
                      type="checkbox"
                      className="size-5 shrink-0"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  ) : null}
                  <label htmlFor={canWrite ? `q-${p.id}` : undefined} className="flex min-w-0 flex-col py-1">
                    <span className="truncate text-body">{p.name}</span>
                    <span className="truncate text-caption text-ink-2">{p.email}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {matching.length > SHOWN ? (
            <p className="text-caption text-ink-2">
              {t('assign.queue.more', { shown: SHOWN, total: matching.length })}
            </p>
          ) : null}

          {canWrite ? (
            <form
              onSubmit={onSubmit}
              aria-labelledby="seat-form-heading"
              className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
            >
              <h3 id="seat-form-heading" className="text-body font-medium">
                {t('assign.form.title')}
              </h3>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assign-item" className="text-caption text-ink-2">
                  {t('assign.form.item')}
                </label>
                <select
                  id="assign-item"
                  value={itemId}
                  onChange={(e) => {
                    setItemId(e.currentTarget.value);
                    setSeatId('');
                    setOverride(false);
                  }}
                  className={field}
                >
                  <option value="">{t('assign.form.choose')}</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {t('assign.form.option', { item: itemName(i), free: i.free, capacity: i.capacity })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assign-seat" className="text-caption text-ink-2">
                  {t('assign.form.seat')}
                </label>
                <select
                  id="assign-seat"
                  value={seatId}
                  onChange={(e) => {
                    setSeatId(e.currentTarget.value);
                    setOverride(false);
                  }}
                  disabled={!chosen}
                  className={field}
                >
                  <option value="">{t('assign.form.anySeat')}</option>
                  {seatChoices.map((s) => (
                    <option key={s.seatUuid} value={s.seatUuid}>
                      {seatOption(s)}
                    </option>
                  ))}
                </select>
              </div>
              {seatId && needsConfirm(seatId) ? (
                <label className="flex min-h-6 items-start gap-2 text-body">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0"
                    checked={override}
                    onChange={(e) => setOverride(e.currentTarget.checked)}
                  />
                  {t('assign.form.needsAccessible')}
                </label>
              ) : null}
              <Button type="submit" disabled={pending} className="self-start">
                {pending ? t('assign.form.submitting') : t('assign.form.submit')}
              </Button>
            </form>
          ) : null}
        </section>

        <section aria-labelledby="plan-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="plan-heading" className="text-section">
            {t('assign.canvas.title')}
          </h2>
          <p id="plan-hint" className="text-caption text-ink-2">
            {canWrite ? t('assign.canvas.hint') : t('assign.canvas.readOnlyHint')}
          </p>
          {/* A drop target for pointer users; the queue, the form and "Move to…" do the same by keyboard. */}
          <div
            ref={plan}
            data-testid="assignment-plan"
            onDragOver={onDragOver}
            onDragLeave={() => setHover(null)}
            onDrop={canWrite ? onDrop : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              pointerDrag.current = null;
              setHover(null);
            }}
            className={canWrite ? 'touch-none' : undefined}
            aria-hidden="true"
          >
            <AssignmentCanvas doc={doc} seatState={seatState} occupancy={occupancy} highlight={hover} />
          </div>
          <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
            {(['free', 'assigned', 'sold', 'held', 'reserved', 'blocked'] as const).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-block size-3 rounded-pill border border-line-strong ${LEGEND[s]}`}
                />
                {t(`assign.state.${s}`)}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="tables-heading" className="flex flex-col gap-3">
        <h2 id="tables-heading" className="text-section">
          {t('assign.tables.title')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => {
            const people = i.seats.flatMap((s) => (s.person ? [{ ...s.person, seat: s.label }] : []));
            const headingId = `item-${i.id}`;
            return (
              <Card key={i.id} className="flex flex-col gap-2">
                <section aria-labelledby={headingId} className="flex flex-col gap-2">
                  <h3 id={headingId} className="text-body font-medium">
                    {itemName(i)}
                  </h3>
                  <p className="text-caption text-ink-2">
                    {t('assign.tables.count', { taken: taken(i), capacity: i.capacity, free: i.free })}
                  </p>
                  {people.length ? (
                    <ul className="flex list-none flex-col gap-1">
                      {people.map((p) => {
                        const movable = canWrite && !p.byTicket;
                        const isMoving = moving?.attendeeId === p.attendeeId;
                        const target = isMoving ? byItem.get(moving.itemId) : undefined;
                        return (
                          <li
                            key={p.attendeeId}
                            draggable={movable}
                            onDragStart={
                              movable
                                ? (e) => {
                                    dragged.current = [p.attendeeId];
                                    e.dataTransfer.setData(DRAG_TYPE, p.attendeeId);
                                    e.dataTransfer.setData('text/plain', p.attendeeId);
                                    e.dataTransfer.effectAllowed = 'move';
                                  }
                                : undefined
                            }
                            onDragEnd={() => {
                              dragged.current = null;
                              setHover(null);
                            }}
                            data-testid={`seated-${p.attendeeId}`}
                            className={`flex flex-col gap-2 ${movable ? 'cursor-grab' : ''}`}
                          >
                            <div className="flex min-h-8 flex-wrap items-center gap-2 text-body">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{p.name}</span>
                                <span className="block text-caption text-ink-2">
                                  {p.byTicket ? t('assign.tables.byTicket', { seat: p.seat }) : p.seat}
                                </span>
                              </span>
                              {movable ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={pending}
                                    aria-expanded={isMoving}
                                    aria-label={t('assign.move.label', { name: p.name })}
                                    onClick={() =>
                                      setMoving(
                                        isMoving
                                          ? null
                                          : {
                                              attendeeId: p.attendeeId,
                                              name: p.name,
                                              itemId: '',
                                              seatId: '',
                                              override: false,
                                            },
                                      )
                                    }
                                  >
                                    {t('assign.move.open')}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={pending}
                                    aria-label={t('assign.tables.removeLabel', {
                                      name: p.name,
                                      item: itemName(i),
                                    })}
                                    onClick={() => remove(p.attendeeId, p.name)}
                                  >
                                    {t('assign.tables.remove')}
                                  </Button>
                                </>
                              ) : null}
                            </div>
                            {isMoving && moving ? (
                              <form
                                onSubmit={onMove}
                                aria-label={t('assign.move.title', { name: p.name })}
                                className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-3"
                              >
                                <div className="flex flex-col gap-1">
                                  <label
                                    htmlFor={`move-item-${p.attendeeId}`}
                                    className="text-caption text-ink-2"
                                  >
                                    {t('assign.form.item')}
                                  </label>
                                  <select
                                    ref={moveSelect}
                                    id={`move-item-${p.attendeeId}`}
                                    value={moving.itemId}
                                    onChange={(e) =>
                                      setMoving({
                                        ...moving,
                                        itemId: e.currentTarget.value,
                                        seatId: '',
                                        override: false,
                                      })
                                    }
                                    className={field}
                                  >
                                    <option value="">{t('assign.form.choose')}</option>
                                    {items.map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {t('assign.form.option', {
                                          item: itemName(o),
                                          free: o.free,
                                          capacity: o.capacity,
                                        })}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <label
                                    htmlFor={`move-seat-${p.attendeeId}`}
                                    className="text-caption text-ink-2"
                                  >
                                    {t('assign.form.seat')}
                                  </label>
                                  <select
                                    id={`move-seat-${p.attendeeId}`}
                                    value={moving.seatId}
                                    disabled={!target}
                                    onChange={(e) =>
                                      setMoving({ ...moving, seatId: e.currentTarget.value, override: false })
                                    }
                                    className={field}
                                  >
                                    <option value="">{t('assign.form.anySeat')}</option>
                                    {choicesAt(target).map((s) => (
                                      <option key={s.seatUuid} value={s.seatUuid}>
                                        {seatOption(s)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                {moving.seatId && needsConfirm(moving.seatId) ? (
                                  <label className="flex min-h-6 items-start gap-2 text-body">
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 size-5 shrink-0"
                                      checked={moving.override}
                                      onChange={(e) =>
                                        setMoving({ ...moving, override: e.currentTarget.checked })
                                      }
                                    />
                                    {t('assign.form.needsAccessible')}
                                  </label>
                                ) : null}
                                <div className="flex flex-wrap gap-2">
                                  <Button type="submit" size="sm" disabled={pending}>
                                    {t('assign.move.submit')}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setMoving(null)}
                                  >
                                    {t('assign.move.cancel')}
                                  </Button>
                                </div>
                              </form>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-caption text-ink-2">{t('assign.tables.empty')}</p>
                  )}
                </section>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const LEGEND: Record<AssignSeatState, string> = {
  free: 'bg-surface',
  assigned: 'bg-primary',
  sold: 'bg-tag',
  held: 'bg-warning-dot',
  reserved: 'bg-line',
  blocked: 'bg-danger',
};
