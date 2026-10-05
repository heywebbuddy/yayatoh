'use client';

import type { FloorplanDoc, Item } from '@yayatoh/floorplan';
import type { LiveSeatState } from '@yayatoh/seating/client';
import { paper } from '@yayatoh/ui';
import type Konva from 'konva';
import { memo } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { PanZoomControls, useBoxWidth, usePanZoom } from './pan-zoom.tsx';
import { type DotStyle, SeatDots } from './seat-dots.tsx';
import { UnderlayImage } from './underlay-image.tsx';

export type SeatStatus = LiveSeatState;

const SEAT_R = 22;
export const SNAP_CM = 10;
const snap = (v: number) => Math.round(v / SNAP_CM) * SNAP_CM;

/** Seat colours by state (M1.7f: a guest's seat is shown apart from a blocked one). */
export const SEAT_FILL: Record<SeatStatus, string> = {
  available: paper.free,
  held: paper.held,
  sold: paper.sold,
  assigned: paper.selected,
  blocked: paper.blocked,
};

const styleCache = new Map<string, DotStyle>();
function seatStyle(state: SeatStatus, accessible: boolean): DotStyle {
  const key = `${state}:${accessible}`;
  let s = styleCache.get(key);
  if (!s) {
    s = {
      fill: SEAT_FILL[state],
      stroke: accessible ? paper.selected : paper.outline,
      strokeWidth: accessible ? 6 : 2,
    };
    styleCache.set(key, s);
  }
  return s;
}

/**
 * The floor plan on a canvas (Konva): drag rows, tables and objects (snapped to 10 cm), click to
 * select, shift-click to add to the selection; zoom and pan for large rooms. Each row's or
 * table's seats are one batched shape, so a 5,000-seat plan pans smoothly (M1.7f). Everything
 * this does can also be done in the list editor beside it.
 */
export default function SeatingCanvas({
  doc,
  seatStatus,
  selected,
  locked,
  onSelect,
  onMove,
  label,
  onPoint,
  marks = [],
  sponsors = {},
}: {
  doc: FloorplanDoc;
  seatStatus: Readonly<Record<string, SeatStatus>>;
  selected: ReadonlySet<string>;
  locked: boolean;
  onSelect: (id: string | null, additive: boolean) => void;
  onMove: (id: string, x: number, y: number) => void;
  label: string;
  /**
   * Calibration (M1.7g): while set, a click or tap anywhere on the plan reports its point in room
   * centimetres instead of selecting (the form beside the plan does the same by numbers).
   */
  onPoint?: ((p: { x: number; y: number }) => void) | undefined;
  /** Points to mark on the plan (calibration points A and B), in room centimetres. */
  marks?: readonly { x: number; y: number; label: string }[];
  /** M4.2b hosted tables: sponsor names by table item id, written under the table's label. */
  sponsors?: Readonly<Record<string, string>>;
}) {
  const [box, width] = useBoxWidth(800, 280);
  const view = usePanZoom(doc, width, 720);
  const pick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent | Event>) => {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!onPoint || !p) return false;
    onPoint({ x: Math.round((p.x - view.x) / view.scale), y: Math.round((p.y - view.y) / view.scale) });
    return true;
  };
  return (
    <div className="flex flex-col gap-2">
      {/* Inside the editor's keyboard widget: its keys (arrows, R, Delete) are not for these buttons. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops key events bubbling to the plan's handler */}
      <div onKeyDown={(e) => e.stopPropagation()}>
        <PanZoomControls view={view} />
      </div>
      <div ref={box} className="w-full overflow-hidden rounded-card border border-line bg-surface-2">
        <Stage
          width={width}
          height={view.height}
          scaleX={view.scale}
          scaleY={view.scale}
          x={view.x}
          y={view.y}
          {...view.stageProps}
          onClick={(e) => {
            if (pick(e)) return;
            if (e.target === e.target.getStage()) onSelect(null, false);
          }}
          onTap={(e) => {
            pick(e);
          }}
          aria-label={label}
        >
          <Layer>
            <Rect
              width={doc.width}
              height={doc.height}
              fill={paper.free}
              stroke={paper.taken}
              strokeWidth={4}
              listening={false}
            />
            {doc.underlay ? <UnderlayImage underlay={doc.underlay} /> : null}
            {marks.map((m) => (
              <Group key={m.label} x={m.x} y={m.y} listening={false}>
                <Line points={[-40, 0, 40, 0]} stroke={paper.selected} strokeWidth={6 / view.scale} />
                <Line points={[0, -40, 0, 40]} stroke={paper.selected} strokeWidth={6 / view.scale} />
                <Text text={m.label} x={12} y={-56} fontSize={44} fill={paper.selected} />
              </Group>
            ))}
            {doc.items.map((item) => (
              <PlanItem
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                // While calibrating, clicks mark points: nothing moves.
                locked={locked || Boolean(onPoint)}
                seatStatus={seatStatus}
                seatKey={
                  item.kind === 'object' ? '' : item.seats.map((s) => seatStatus[s.id] ?? 'available').join()
                }
                scale={view.scale}
                onSelect={onSelect}
                onMove={onMove}
                sponsor={sponsors[item.id]}
              />
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

/** One row, table or object; redrawn only when it, its selection or its seats' states change. */
const PlanItem = memo(
  function PlanItem({
    item,
    selected: isSelected,
    locked,
    seatStatus,
    seatKey,
    scale,
    onSelect,
    onMove,
    sponsor,
  }: {
    item: Item;
    selected: boolean;
    locked: boolean;
    seatStatus: Readonly<Record<string, SeatStatus>>;
    seatKey: string;
    scale: number;
    onSelect: (id: string | null, additive: boolean) => void;
    onMove: (id: string, x: number, y: number) => void;
    sponsor?: string | undefined;
  }) {
    const outline = isSelected ? paper.selected : paper.outline;
    const common = {
      x: item.x,
      y: item.y,
      rotation: item.rotation,
      draggable: !locked,
      onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true;
        onSelect(item.id, e.evt.shiftKey);
      },
      onTap: (e: Konva.KonvaEventObject<Event>) => {
        e.cancelBubble = true;
        onSelect(item.id, false);
      },
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        e.cancelBubble = true;
        const x = snap(e.target.x());
        const y = snap(e.target.y());
        e.target.position({ x, y });
        onMove(item.id, x, y);
      },
    };
    if (item.kind === 'object')
      return (
        <Group {...common}>
          <Rect
            width={item.width}
            height={item.height}
            fill={paper.floor}
            stroke={outline}
            strokeWidth={isSelected ? 8 : 3}
            cornerRadius={12}
          />
          <Text
            text={item.label || item.objectType}
            x={16}
            y={16}
            fontSize={48}
            fill={paper.sold}
            listening={false}
          />
        </Group>
      );
    const lastX = item.seats.at(-1)?.x ?? 0;
    return (
      <Group {...common}>
        {item.kind === 'table' ? (
          item.shape === 'round' ? (
            <Circle
              radius={item.width / 2}
              fill={paper.floor}
              stroke={outline}
              strokeWidth={isSelected ? 8 : 3}
            />
          ) : (
            <Rect
              x={-item.width / 2}
              y={-item.height / 2}
              width={item.width}
              height={item.height}
              fill={paper.floor}
              stroke={outline}
              strokeWidth={isSelected ? 8 : 3}
            />
          )
        ) : (
          // The row's grab area (and its selection outline).
          <Rect
            x={-SEAT_R - 10}
            y={-SEAT_R - 10}
            width={lastX + (SEAT_R + 10) * 2}
            height={(SEAT_R + 10) * 2}
            fill="transparent"
            stroke={isSelected ? outline : undefined}
            strokeWidth={8}
            cornerRadius={SEAT_R + 10}
          />
        )}
        <Text
          text={item.label}
          x={item.kind === 'row' ? -SEAT_R - 90 : -40}
          y={-24}
          width={item.kind === 'row' ? 70 : 80}
          align={item.kind === 'row' ? 'right' : 'center'}
          fontSize={40}
          fill={paper.label}
          listening={false}
        />
        {sponsor && item.kind === 'table' ? (
          <Text
            text={sponsor}
            x={-item.width / 2 + 8}
            y={22}
            width={item.width - 16}
            align="center"
            fontSize={26}
            fill={paper.muted}
            listening={false}
            wrap="none"
            ellipsis
          />
        ) : null}
        <SeatDots
          dots={item.seats}
          radius={SEAT_R}
          styleOf={(s) => seatStyle(seatStatus[s.id] ?? 'available', s.accessible)}
          version={seatKey}
          scale={scale}
        />
      </Group>
    );
  },
  (a, b) =>
    a.item === b.item &&
    a.selected === b.selected &&
    a.locked === b.locked &&
    a.seatKey === b.seatKey &&
    a.scale === b.scale &&
    a.onSelect === b.onSelect &&
    a.onMove === b.onMove &&
    a.sponsor === b.sponsor,
);
