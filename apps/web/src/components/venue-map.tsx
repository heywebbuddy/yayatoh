'use client';

import { type FloorplanDoc, itemCenter, type OBJECT_TYPES, placedSeats } from '@yayatoh/floorplan';
import { Button } from '@yayatoh/ui';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type ObjectType = (typeof OBJECT_TYPES)[number];

/** Object colours by type (tokens only): the stage stands out, entrances and exits read at a glance. */
const OBJECT_STYLE: Record<ObjectType, { box: string; text: string }> = {
  stage: { box: 'fill-ink stroke-ink', text: 'fill-white' },
  entrance: { box: 'fill-success-soft stroke-success-dot', text: 'fill-success-dot' },
  exit: { box: 'fill-danger-soft stroke-danger', text: 'fill-danger' },
  dance_floor: { box: 'fill-primary-soft stroke-primary', text: 'fill-ink' },
  bar: { box: 'fill-primary-soft stroke-primary', text: 'fill-ink' },
  booth: { box: 'fill-surface-3 stroke-ink-3', text: 'fill-ink' },
  custom: { box: 'fill-surface-3 stroke-ink-3', text: 'fill-ink' },
};
const ZOOMS = [1, 1.5, 2.25, 3.5, 5] as const;
const SEAT_R = 22;

/**
 * The public venue map (M1.7e): the plan drawn read-only as SVG — stage, entrances, exits, bars,
 * dance floor and booths labelled, tables and rows with their seats, and the guest's own seats
 * highlighted. Zoom and move with the buttons, the keyboard (+ − arrows 0 with the map focused)
 * or by dragging. The venue guide beside it lists the same things in words. M4.4a: guests seated
 * at a table (not a particular chair) see their whole table or row highlighted (`highlightItems`).
 */
export function VenueMap({
  doc,
  highlight = [],
  highlightItems = [],
}: {
  doc: FloorplanDoc;
  /** Seats to highlight (the guest's own, from the seat finder). */
  highlight?: readonly string[];
  /** Tables or rows to highlight (M4.4a guest seat finder: guests are seated per table). */
  highlightItems?: readonly string[];
}) {
  const t = useTranslations('venueMap');
  const keysId = useId();
  const seats = useMemo(() => placedSeats(doc), [doc]);
  const places = useMemo(() => new Set(highlightItems), [highlightItems]);
  // A highlighted row's seats are the guest's too (a table gets a ring of its own).
  const mine = useMemo(
    () =>
      new Set([
        ...highlight,
        ...doc.items.flatMap((i) => (i.kind === 'row' && places.has(i.id) ? i.seats.map((s) => s.id) : [])),
      ]),
    [highlight, doc, places],
  );
  // Start on the guest's seats or tables when there are any, else on the whole room.
  const focus = useMemo(() => {
    const hits = [
      ...seats.filter((s) => mine.has(s.seatId)),
      ...doc.items.flatMap((i) => (i.kind === 'table' && places.has(i.id) ? [itemCenter(i)] : [])),
    ];
    if (!hits.length) return null;
    return {
      x: hits.reduce((a, s) => a + s.x, 0) / hits.length,
      y: hits.reduce((a, s) => a + s.y, 0) / hits.length,
    };
  }, [seats, mine, doc, places]);
  const home = { zoom: 0, cx: doc.width / 2, cy: doc.height / 2 };
  const [view, setView] = useState(focus ? { zoom: 2, cx: focus.x, cy: focus.y } : home);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // The room's proportions, set through the CSSOM: the strict CSP (M1.14a) refuses style attributes.
  const svgRef = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (svgRef.current) svgRef.current.style.aspectRatio = `${doc.width} / ${doc.height}`;
  }, [doc.width, doc.height]);

  const z = ZOOMS[view.zoom] ?? 1;
  const w = doc.width / z;
  const h = doc.height / z;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const x = clamp(view.cx - w / 2, 0, doc.width - w);
  const y = clamp(view.cy - h / 2, 0, doc.height - h);
  const set = (zoom: number, cx = view.cx, cy = view.cy) => {
    const nz = clamp(zoom, 0, ZOOMS.length - 1);
    const vw = doc.width / (ZOOMS[nz] ?? 1);
    const vh = doc.height / (ZOOMS[nz] ?? 1);
    // Keep the centre inside the room so the view never drifts off the plan.
    setView({
      zoom: nz,
      cx: clamp(cx, vw / 2, doc.width - vw / 2),
      cy: clamp(cy, vh / 2, doc.height - vh / 2),
    });
  };
  const pan = (dx: number, dy: number) => set(view.zoom, x + w / 2 + dx * w * 0.2, y + h / 2 + dy * h * 0.2);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === '+' || e.key === '=') set(view.zoom + 1, x + w / 2, y + h / 2);
    else if (e.key === '-' || e.key === '_') set(view.zoom - 1, x + w / 2, y + h / 2);
    else if (e.key === '0') set(0, home.cx, home.cy);
    else if (e.key === 'ArrowLeft') pan(-1, 0);
    else if (e.key === 'ArrowRight') pan(1, 0);
    else if (e.key === 'ArrowUp') pan(0, -1);
    else if (e.key === 'ArrowDown') pan(0, 1);
    else return;
    e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (view.zoom === 0) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: x + w / 2, cy: y + h / 2 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const width = box.current?.clientWidth;
    if (!d || !width) return;
    const perPx = w / width;
    set(view.zoom, d.cx - (e.clientX - d.x) * perPx, d.cy - (e.clientY - d.y) * perPx);
  };
  const endDrag = () => {
    drag.current = null;
  };

  const objectName = (type: ObjectType, label: string) => label || t(`object.${type}`);
  return (
    <div className="flex flex-col gap-2">
      <div role="toolbar" aria-label={t('tools')} className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => set(view.zoom + 1, x + w / 2, y + h / 2)}
          disabled={view.zoom >= ZOOMS.length - 1}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t('zoomIn')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => set(view.zoom - 1, x + w / 2, y + h / 2)}
          disabled={view.zoom === 0}
        >
          <Minus aria-hidden="true" className="size-4" />
          {t('zoomOut')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => set(0, home.cx, home.cy)}
          disabled={view.zoom === 0}
        >
          <Maximize aria-hidden="true" className="size-4" />
          {t('reset')}
        </Button>
        <p role="status" className="ms-auto text-caption text-ink-2">
          {t('zoom', { percent: Math.round(z * 100) })}
        </p>
      </div>
      {/* A keyboard-driven widget (+ − arrows 0): role="application" lets it own those keys. The
          venue guide is the text alternative for screen readers. */}
      <div
        ref={box}
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard-driven widget must be focusable to take its keys
        tabIndex={0}
        aria-label={t('region')}
        aria-describedby={keysId}
        onKeyDown={onKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`overflow-hidden rounded-card border border-line bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 ${view.zoom > 0 ? 'cursor-grab touch-none' : ''}`}
      >
        <svg
          data-testid="venue-map"
          viewBox={`${Math.round(x)} ${Math.round(y)} ${Math.round(w)} ${Math.round(h)}`}
          preserveAspectRatio="xMidYMid meet"
          className="block max-h-[70vh] w-full select-none"
          ref={svgRef}
          direction="ltr"
          aria-hidden="true"
        >
          <rect
            width={doc.width}
            height={doc.height}
            className="fill-surface-solid stroke-ink-3"
            strokeWidth={4}
          />
          {doc.items.map((item) => {
            if (item.kind === 'object') {
              const style = OBJECT_STYLE[item.objectType];
              const name = objectName(item.objectType, item.label);
              const size = Math.max(
                24,
                Math.min(90, item.height * 0.35, (item.width / Math.max(4, name.length)) * 1.6),
              );
              return (
                <g
                  key={item.id}
                  data-object={item.objectType}
                  transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
                >
                  <rect
                    width={item.width}
                    height={item.height}
                    rx={16}
                    className={style.box}
                    strokeWidth={4}
                  />
                  <text
                    x={item.width / 2}
                    y={item.height / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={size}
                    className={style.text}
                  >
                    {name}
                  </text>
                </g>
              );
            }
            const label =
              item.kind === 'table' ? t('table', { label: item.label }) : t('row', { label: item.label });
            const yours = places.has(item.id);
            const tableStyle = yours ? 'fill-primary-soft stroke-primary' : 'fill-surface-3 stroke-ink-3';
            return (
              <g
                key={item.id}
                data-item={item.kind}
                data-highlight-item={yours ? item.id : undefined}
                transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
              >
                {item.kind === 'table' && yours ? (
                  // The guest's table: a ring that shows at any zoom.
                  <circle
                    r={Math.max(item.width, item.height) / 2 + SEAT_R * 3.2}
                    className="fill-none stroke-primary"
                    strokeWidth={10}
                  />
                ) : null}
                {item.kind === 'table' ? (
                  item.shape === 'round' ? (
                    <circle r={item.width / 2} className={tableStyle} strokeWidth={yours ? 6 : 3} />
                  ) : (
                    <rect
                      x={-item.width / 2}
                      y={-item.height / 2}
                      width={item.width}
                      height={item.height}
                      className={tableStyle}
                      strokeWidth={yours ? 6 : 3}
                    />
                  )
                ) : null}
                <text
                  x={item.kind === 'row' ? -SEAT_R - 16 : 0}
                  y={0}
                  textAnchor={item.kind === 'row' ? 'end' : 'middle'}
                  dominantBaseline="central"
                  fontSize={item.kind === 'row' ? 36 : 32}
                  className="fill-ink"
                >
                  {item.kind === 'row' ? item.label : label}
                </text>
              </g>
            );
          })}
          {seats.map((s) =>
            mine.has(s.seatId) ? null : (
              <circle
                key={s.seatId}
                cx={s.x}
                cy={s.y}
                r={SEAT_R}
                className="fill-surface-solid stroke-ink-3"
                strokeWidth={3}
              />
            ),
          )}
          {/* The guest's seats last, on top, with a ring that shows at any zoom. */}
          {seats
            .filter((s) => mine.has(s.seatId))
            .map((s) => (
              <g key={s.seatId} data-highlight={s.seatId}>
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={SEAT_R * 2.4}
                  className="fill-none stroke-primary"
                  strokeWidth={8}
                />
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={SEAT_R + 4}
                  className="fill-primary stroke-ink"
                  strokeWidth={4}
                />
              </g>
            ))}
        </svg>
      </div>
      <p id={keysId} className="text-caption text-ink-2">
        {t('keys')}
      </p>
    </div>
  );
}
