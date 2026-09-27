'use client';

import { type FloorplanDoc, hitTest } from '@yayatoh/floorplan';
import type { AssignSeatState, SeatAssignmentsDto } from '@yayatoh/seating';
import { Alert, Button, Card } from '@yayatoh/ui';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { type DragEvent, type FormEvent, useMemo, useRef, useState, useTransition } from 'react';
import type { AssignState } from '@/app/[locale]/o/[org]/e/[event]/seating/actions.ts';
import { useRouter } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

// Konva needs the browser: the plan loads on the client only.
const AssignmentCanvas = dynamic(() => import('./assignment-canvas.tsx'), { ssr: false });

/** The queue shows this many names at once; search finds the rest. */
const SHOWN = 200;
const DRAG_TYPE = 'application/x-yayatoh-attendees';
const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

type Feedback = { tone: 'info' | 'danger'; text: string } | null;
type Target = { itemId: string; seatId: string | null };

/**
 * Seat guests (M1.7d). The unseated queue (search, tick names), a table/row and seat chooser
 * and "Seat them" do everything by keyboard; dragging a name (or the ticked names) onto a table
 * or seat of the plan does the same with a pointer. Each table lists who sits there, with Remove.
 */
export function SeatAssignments({
  view,
  doc,
  canWrite,
  assign,
  unassign,
}: {
  view: SeatAssignmentsDto;
  doc: FloorplanDoc;
  canWrite: boolean;
  assign: (input: {
    attendeeIds: string[];
    itemId: string;
    seatUuid?: string | null;
  }) => Promise<AssignState>;
  unassign: (attendeeId: string) => Promise<AssignState>;
}) {
  const t = useTranslations('seating');
  const tRoot = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [itemId, setItemId] = useState('');
  const [seatId, setSeatId] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [hover, setHover] = useState<Target | null>(null);
  const dragged = useRef<string[] | null>(null);
  const plan = useRef<HTMLDivElement>(null);

  const itemName = (i: { kind: 'row' | 'table'; label: string }) =>
    t(`prices.item.${i.kind}`, { label: i.label });
  const items = view.items;
  const byItem = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const unseatedIds = useMemo(() => new Set(view.unseated.map((p) => p.id)), [view.unseated]);
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
  const seatChoices = chosen?.seats.filter((s) => s.state === 'free' || s.state === 'reserved') ?? [];
  const seatState = useMemo(
    () =>
      Object.fromEntries(items.flatMap((i) => i.seats.map((s) => [s.seatUuid, s.state]))) as Record<
        string,
        AssignSeatState
      >,
    [items],
  );
  const taken = (i: (typeof items)[number]) => i.seats.filter((s) => s.person).length;
  const occupancy = useMemo(
    () =>
      Object.fromEntries(items.map((i) => [i.id, `${i.seats.filter((s) => s.person).length}/${i.capacity}`])),
    [items],
  );

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
      default:
        return tRoot(errorMessageKey(r.code));
    }
  };

  const seat = (ids: string[], target: Target) => {
    const item = byItem.get(target.itemId);
    if (!item) return;
    startTransition(async () => {
      const r = await assign({
        attendeeIds: ids,
        itemId: target.itemId,
        // A drop of several people on one seat seats them at its table.
        seatUuid: ids.length === 1 ? target.seatId : null,
      });
      if (r.ok) {
        setFeedback({
          tone: 'info',
          text: t('assign.done', { count: r.count ?? ids.length, item: itemName(item) }),
        });
        setPicked(new Set());
        setSeatId('');
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
    seat([...selected], { itemId, seatId: seatId || null });
  };

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
    const ids = dragged.current ?? raw.split(',').filter((id) => unseatedIds.has(id));
    dragged.current = null;
    if (!ids.length) return;
    const target = targetAt(e.clientX, e.clientY);
    if (!target) return setFeedback({ tone: 'danger', text: t('assign.errors.dropMiss') });
    seat(ids, target);
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-zinc-600">
        {t('assign.summary', { seated: view.seatedCount, unseated: view.unseated.length })}
      </p>
      {canWrite ? null : <p className="text-caption text-zinc-600">{t('assign.readOnly')}</p>}
      <div aria-live="polite" aria-atomic="true">
        {feedback ? <Alert tone={feedback.tone} title={feedback.text} /> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section aria-labelledby="queue-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="queue-heading" className="text-section">
            {t('assign.queue.title', { count: view.unseated.length })}
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="queue-search" className="text-caption text-zinc-600">
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
              <p role="status" className="text-caption text-zinc-600">
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
            <p className="text-body text-zinc-600">{t('assign.queue.empty')}</p>
          ) : matching.length === 0 ? (
            <p className="text-body text-zinc-600">{t('assign.queue.noMatch', { q: query.trim() })}</p>
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
                  className={`flex min-h-10 items-center gap-2 rounded-pill border px-3 ${selected.has(p.id) ? 'border-ink bg-zinc-100' : 'border-zinc-200 bg-white'} ${canWrite ? 'cursor-grab' : ''}`}
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
                    <span className="truncate text-caption text-zinc-600">{p.email}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {matching.length > SHOWN ? (
            <p className="text-caption text-zinc-600">
              {t('assign.queue.more', { shown: SHOWN, total: matching.length })}
            </p>
          ) : null}

          {canWrite ? (
            <form
              onSubmit={onSubmit}
              aria-labelledby="seat-form-heading"
              className="flex flex-col gap-3 rounded-card border border-zinc-200 bg-white p-4"
            >
              <h3 id="seat-form-heading" className="text-body font-medium">
                {t('assign.form.title')}
              </h3>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assign-item" className="text-caption text-zinc-600">
                  {t('assign.form.item')}
                </label>
                <select
                  id="assign-item"
                  value={itemId}
                  onChange={(e) => {
                    setItemId(e.currentTarget.value);
                    setSeatId('');
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
                <label htmlFor="assign-seat" className="text-caption text-zinc-600">
                  {t('assign.form.seat')}
                </label>
                <select
                  id="assign-seat"
                  value={seatId}
                  onChange={(e) => setSeatId(e.currentTarget.value)}
                  disabled={!chosen}
                  className={field}
                >
                  <option value="">{t('assign.form.anySeat')}</option>
                  {seatChoices.map((s) => (
                    <option key={s.seatUuid} value={s.seatUuid}>
                      {s.state === 'reserved' ? t('assign.form.seatKept', { label: s.label }) : s.label}
                    </option>
                  ))}
                </select>
              </div>
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
          <p id="plan-hint" className="text-caption text-zinc-600">
            {canWrite ? t('assign.canvas.hint') : t('assign.canvas.readOnlyHint')}
          </p>
          {/* A drop target for pointer users; the queue and the form above do the same by keyboard. */}
          <div
            ref={plan}
            data-testid="assignment-plan"
            onDragOver={onDragOver}
            onDragLeave={() => setHover(null)}
            onDrop={canWrite ? onDrop : undefined}
            aria-hidden="true"
          >
            <AssignmentCanvas doc={doc} seatState={seatState} occupancy={occupancy} highlight={hover} />
          </div>
          <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 text-caption text-zinc-600">
            {(['free', 'assigned', 'sold', 'held', 'reserved', 'blocked'] as const).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-block size-3 rounded-pill border border-zinc-500 ${LEGEND[s]}`}
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
                  <p className="text-caption text-zinc-600">
                    {t('assign.tables.count', { taken: taken(i), capacity: i.capacity, free: i.free })}
                  </p>
                  {people.length ? (
                    <ul className="flex list-none flex-col gap-1">
                      {people.map((p) => (
                        <li key={p.attendeeId} className="flex min-h-8 items-center gap-2 text-body">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{p.name}</span>
                            <span className="block text-caption text-zinc-500">
                              {p.byTicket ? t('assign.tables.byTicket', { seat: p.seat }) : p.seat}
                            </span>
                          </span>
                          {canWrite && !p.byTicket ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              aria-label={t('assign.tables.removeLabel', { name: p.name, item: itemName(i) })}
                              onClick={() => remove(p.attendeeId, p.name)}
                            >
                              {t('assign.tables.remove')}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-caption text-zinc-500">{t('assign.tables.empty')}</p>
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
  free: 'bg-white',
  assigned: 'bg-accent-900',
  sold: 'bg-zinc-700',
  held: 'bg-accent-700',
  reserved: 'bg-zinc-200',
  blocked: 'bg-pink-700',
};
