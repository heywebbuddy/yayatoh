'use client';

import { buildRoundTable, buildRow, type FloorplanDoc, type Item, OBJECT_TYPES } from '@yayatoh/floorplan';
import { uuidv7 } from '@yayatoh/kernel';
import { Button, Select } from '@yayatoh/ui';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { SeatingState } from '@/app/[locale]/o/[org]/e/[event]/seating/actions.ts';
import { SeatLegend, useSeatStates } from './seat-states.tsx';
import type { SeatStatus } from './seating-canvas.tsx';
import { type Marking, planMarks, pointFromPlan, UnderlayPanel } from './seating-underlay.tsx';

// Konva needs the browser: the canvas loads on the client only.
const SeatingCanvas = dynamic(() => import('./seating-canvas.tsx'), { ssr: false });

const field = 'field field-sm w-20';
const clampRot = (r: number) => ((Math.round(r) % 360) + 360) % 360;
/** "1, 2, 10" → the labels (case and spacing aside). */
const labelList = (v: string) =>
  new Set(
    v
      .split(/[,;\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );

type Save = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * The floor plan editor: a canvas (drag, snap, rotate, multi-select) and, always beside it, a list
 * editor that does everything by keyboard. Changes autosave; undo and redo cover every change.
 * A locked layout (seats sold) is read-only.
 */
export function SeatingEditor({
  initialDoc,
  seatStatus,
  locked,
  saveDoc,
  underlayTicket = null,
  sponsors = {},
}: {
  initialDoc: FloorplanDoc;
  seatStatus: Readonly<Record<string, SeatStatus>>;
  locked: boolean;
  saveDoc: (doc: FloorplanDoc) => Promise<SeatingState>;
  /** Upload ticket for floor plan images (M1.7g); null for people who can't change the plan. */
  underlayTicket?: string | null;
  /** M4.2b hosted tables: sponsor names by table item id, shown on the plan and in the list. */
  sponsors?: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('seating.editor');
  // Live seat states (M1.7f) when the page follows the seat stream; else the server's.
  const live = useSeatStates();
  const states = live?.states ?? seatStatus;
  const [doc, setDoc] = useState(initialDoc);
  const [past, setPast] = useState<FloorplanDoc[]>([]);
  const [future, setFuture] = useState<FloorplanDoc[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [save, setSave] = useState<Save>('saved');
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newSeats, setNewSeats] = useState({ row: 10, table: 8 });
  const [objectType, setObjectType] = useState<(typeof OBJECT_TYPES)[number]>('stage');
  // Calibrating the floor plan image (M1.7g): which point the next click marks, and both points.
  const [marking, setMarking] = useState<Marking>(null);
  const [points, setPoints] = useState({ a: { x: '', y: '' }, b: { x: '', y: '' } });
  const onPoint = useCallback(
    (p: { x: number; y: number }) => {
      const q = pointFromPlan(doc.underlay, p);
      if (!q || !marking) return;
      setPoints((cur) => ({ ...cur, [marking]: q }));
      setMarking(marking === 'a' ? 'b' : null);
    },
    [doc.underlay, marking],
  );

  const persist = useCallback(
    (next: FloorplanDoc) => {
      if (timer.current) clearTimeout(timer.current);
      setSave('dirty');
      timer.current = setTimeout(async () => {
        setSave('saving');
        const r = await saveDoc(next);
        setSave(r.ok ? 'saved' : 'error');
        setProblem(r.ok ? null : (r.problems?.[0]?.code ?? r.reason ?? r.code));
      }, 1200);
    },
    [saveDoc],
  );
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  const commit = (next: FloorplanDoc) => {
    if (locked) return;
    setPast((p) => [...p.slice(-99), doc]);
    setFuture([]);
    setDoc(next);
    persist(next);
  };
  const update = (id: string, patch: (i: Item) => Item) =>
    commit({ ...doc, items: doc.items.map((i) => (i.id === id ? patch(i) : i)) });
  const undo = () => {
    const prev = past.at(-1);
    if (!prev || locked) return;
    setPast(past.slice(0, -1));
    setFuture([doc, ...future]);
    setDoc(prev);
    persist(prev);
  };
  const redo = () => {
    const [next, ...rest] = future;
    if (!next || locked) return;
    setPast([...past, doc]);
    setFuture(rest);
    setDoc(next);
    persist(next);
  };
  const center = { x: Math.round(doc.width / 2 / 10) * 10, y: Math.round(doc.height / 2 / 10) * 10 };
  const nextLabel = (kind: 'row' | 'table') => {
    const used = new Set(doc.items.filter((i) => i.kind === kind).map((i) => i.label.toLowerCase()));
    let n = doc.items.filter((i) => i.kind === kind).length + 1;
    while (used.has(String(n))) n++;
    return String(n);
  };
  const add = (item: Item) => {
    commit({ ...doc, items: [...doc.items, item] });
    setSelected(new Set([item.id]));
  };
  const selectedItems = doc.items.filter((i) => selected.has(i.id));
  const moveSelected = (dx: number, dy: number) =>
    commit({
      ...doc,
      items: doc.items.map((i) => (selected.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)),
    });
  const rotateSelected = (deg: number) =>
    commit({
      ...doc,
      items: doc.items.map((i) => (selected.has(i.id) ? { ...i, rotation: clampRot(i.rotation + deg) } : i)),
    });
  const removeSelected = () => {
    commit({ ...doc, items: doc.items.filter((i) => !selected.has(i.id)) });
    setSelected(new Set());
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 100 : 10;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (!selected.size) return;
    else if (e.key === 'ArrowLeft') moveSelected(-step, 0);
    else if (e.key === 'ArrowRight') moveSelected(step, 0);
    else if (e.key === 'ArrowUp') moveSelected(0, -step);
    else if (e.key === 'ArrowDown') moveSelected(0, step);
    else if (e.key.toLowerCase() === 'r') rotateSelected(e.shiftKey ? -15 : 15);
    else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
    else return;
    e.preventDefault();
  };
  // Stable callbacks for the canvas (its rows and tables redraw only when they change).
  const latest = useRef({ selected, update });
  latest.current = { selected, update };
  const onSelect = useCallback((id: string | null, additive: boolean) => {
    if (!id) return setSelected(new Set());
    const next = new Set(additive ? latest.current.selected : []);
    if (additive && next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }, []);
  const onMove = useCallback(
    (id: string, x: number, y: number) => latest.current.update(id, (i) => ({ ...i, x, y })),
    [],
  );
  const numberField = (item: Item, key: 'x' | 'y' | 'rotation', label: string) => (
    <input
      key={`${item.id}:${key}:${item[key]}`}
      type="number"
      step={key === 'rotation' ? 15 : 10}
      defaultValue={item[key]}
      disabled={locked}
      aria-label={`${label} — ${item.label || item.kind}`}
      className={field}
      onBlur={(e) => {
        const v = Math.round(Number(e.currentTarget.value));
        if (Number.isFinite(v) && v !== item[key])
          update(item.id, (i) => ({ ...i, [key]: key === 'rotation' ? clampRot(v) : v }));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('toolbar')}>
        <label className="flex items-center gap-1 text-caption text-ink-2">
          {t('seats')}
          <input
            type="number"
            min={1}
            max={500}
            value={newSeats.row}
            onChange={(e) => setNewSeats({ ...newSeats, row: Number(e.currentTarget.value) || 1 })}
            className={field}
            disabled={locked}
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={locked}
          onClick={() =>
            add(
              buildRow({ label: nextLabel('row'), count: Math.min(500, newSeats.row), x: 100, y: center.y }),
            )
          }
        >
          {t('addRow')}
        </Button>
        <label className="flex items-center gap-1 text-caption text-ink-2">
          {t('seats')}
          <input
            type="number"
            min={1}
            max={40}
            value={newSeats.table}
            onChange={(e) => setNewSeats({ ...newSeats, table: Number(e.currentTarget.value) || 1 })}
            className={field}
            disabled={locked}
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={locked}
          onClick={() =>
            add(
              buildRoundTable({ label: nextLabel('table'), seats: Math.min(40, newSeats.table), ...center }),
            )
          }
        >
          {t('addTable')}
        </Button>
        <Select
          aria-label={t('objectType')}
          value={objectType}
          onValueChange={(v) => setObjectType(v as (typeof OBJECT_TYPES)[number])}
          className="field field-sm"
          disabled={locked}
        >
          {OBJECT_TYPES.map((o) => (
            <option key={o} value={o}>
              {t(`object.${o}`)}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          disabled={locked}
          onClick={() =>
            add({
              kind: 'object',
              id: uuidv7(),
              objectType,
              label: t(`object.${objectType}`),
              x: center.x - 200,
              y: center.y - 100,
              width: 400,
              height: 200,
              rotation: 0,
            })
          }
        >
          {t('addObject')}
        </Button>
        <span className="mx-2 h-6 w-px bg-line" aria-hidden="true" />
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || !selected.size}
          onClick={() => rotateSelected(15)}
        >
          {t('rotate')}
        </Button>
        <Button size="sm" variant="ghost" disabled={locked || !selected.size} onClick={removeSelected}>
          {t('delete')}
        </Button>
        <Button size="sm" variant="ghost" disabled={locked || !past.length} onClick={undo}>
          {t('undo')}
        </Button>
        <Button size="sm" variant="ghost" disabled={locked || !future.length} onClick={redo}>
          {t('redo')}
        </Button>
        <p role="status" className="ms-auto text-caption text-ink-2">
          {locked
            ? t('locked')
            : save === 'error'
              ? t('saveError', { problem: problem ?? '' })
              : t(`save.${save}`)}
        </p>
      </div>
      {/* A keyboard-driven widget (arrows, R, Delete, undo): role="application" lets it own the keys. */}
      <div
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard-driven widget must be focusable to take its keys
        tabIndex={0}
        onKeyDown={onKey}
        aria-label={t('canvas')}
        aria-describedby="seating-keys"
        className="rounded-card focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <SeatingCanvas
          doc={doc}
          seatStatus={states}
          selected={selected}
          locked={locked}
          label={t('canvas')}
          onSelect={onSelect}
          onMove={onMove}
          onPoint={marking ? onPoint : undefined}
          marks={planMarks(doc.underlay, points)}
          sponsors={sponsors}
        />
      </div>
      <SeatLegend />
      <UnderlayPanel
        doc={doc}
        commit={commit}
        locked={locked}
        ticket={underlayTicket}
        marking={marking}
        setMarking={setMarking}
        points={points}
        setPoints={setPoints}
      />
      <p id="seating-keys" className="text-caption text-ink-2">
        {t('keys')}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-start text-caption">
          <caption className="sr-only">{t('listCaption')}</caption>
          <thead className="text-ink-2">
            <tr>
              <th scope="col" className="py-1 pe-3 text-start font-normal">
                {t('select')}
              </th>
              <th scope="col" className="py-1 pe-3 text-start font-normal">
                {t('item')}
              </th>
              <th scope="col" className="py-1 pe-3 text-start font-normal">
                {t('label')}
              </th>
              <th scope="col" className="py-1 pe-3 text-start font-normal">
                {t('seatsCol')}
              </th>
              <th scope="col" className="py-1 pe-3 text-start font-normal">
                {t('accessibleCol')}
              </th>
              <th scope="col" className="py-1 pe-3 text-start font-normal">
                x (cm)
              </th>
              <th scope="col" className="py-1 pe-3 text-start font-normal">
                y (cm)
              </th>
              <th scope="col" className="py-1 text-start font-normal">
                {t('rotation')}
              </th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item) => (
              <tr key={item.id} className="border-t border-line">
                <td className="py-1 pe-3">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={selected.has(item.id)}
                    aria-label={t('selectItem', {
                      item: item.label || t(`object.${item.kind === 'object' ? item.objectType : 'custom'}`),
                    })}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      setSelected(next);
                    }}
                  />
                </td>
                <td className="py-1 pe-3">
                  {item.kind === 'object' ? t(`object.${item.objectType}`) : t(`kind.${item.kind}`)}
                </td>
                <td className="py-1 pe-3">
                  <input
                    key={`${item.id}:label:${item.label}`}
                    defaultValue={item.label}
                    maxLength={40}
                    disabled={locked}
                    aria-label={t('labelOf', { item: item.label || item.kind })}
                    className="field field-sm w-28"
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== item.label) update(item.id, (i) => ({ ...i, label: v }));
                    }}
                  />
                  {sponsors[item.id] ? (
                    <span className="block text-caption text-ink-2" data-sponsor>
                      {t('sponsoredBy', { sponsor: sponsors[item.id] ?? '' })}
                    </span>
                  ) : null}
                </td>
                <td className="py-1 pe-3 tabular-nums">{item.kind === 'object' ? '—' : item.seats.length}</td>
                <td className="py-1 pe-3">
                  {item.kind === 'object' ? (
                    '—'
                  ) : (
                    <input
                      key={`${item.id}:accessible:${item.seats
                        .filter((x) => x.accessible)
                        .map((x) => x.label)
                        .join(',')}`}
                      defaultValue={item.seats
                        .filter((x) => x.accessible)
                        .map((x) => x.label)
                        .join(', ')}
                      maxLength={200}
                      disabled={locked}
                      aria-label={t('accessibleOf', { item: item.label })}
                      aria-describedby="accessible-hint"
                      className="field field-sm w-28"
                      onBlur={(e) => {
                        const want = labelList(e.currentTarget.value);
                        const next = item.seats.map((x) => ({
                          ...x,
                          accessible: want.has(x.label.toLowerCase()),
                        }));
                        if (next.some((x, i) => x.accessible !== item.seats[i]?.accessible))
                          update(item.id, (i) => (i.kind === 'object' ? i : { ...i, seats: next }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  )}
                </td>
                <td className="py-1 pe-3">{numberField(item, 'x', 'x')}</td>
                <td className="py-1 pe-3">{numberField(item, 'y', 'y')}</td>
                <td className="py-1">{numberField(item, 'rotation', t('rotation'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p id="accessible-hint" className="text-caption text-ink-2">
        {t('accessibleHint')}
      </p>
      {selectedItems.length ? (
        <p className="text-caption text-ink-2">{t('selectedCount', { count: selectedItems.length })}</p>
      ) : null}
    </div>
  );
}
