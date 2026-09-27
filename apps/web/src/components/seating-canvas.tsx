'use client';

import type { FloorplanDoc, Item } from '@yayatoh/floorplan';
import { color, status as statusColor } from '@yayatoh/ui';
import type Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva';

export type SeatStatus = 'available' | 'held' | 'sold' | 'blocked';

const SEAT_R = 22;
export const SNAP_CM = 10;
const snap = (v: number) => Math.round(v / SNAP_CM) * SNAP_CM;

const seatFill: Record<SeatStatus, string> = {
  available: color.white,
  held: statusColor.warning,
  sold: color.zinc[700],
  blocked: statusColor.danger,
};

/**
 * The floor plan on a canvas (Konva): drag rows, tables and objects (snapped to 10 cm), click to
 * select, shift-click to add to the selection. Seats are drawn but not interactive here, so large
 * rooms stay fast. Everything this does can also be done in the list editor beside it.
 */
export default function SeatingCanvas({
  doc,
  seatStatus,
  selected,
  locked,
  onSelect,
  onMove,
  label,
}: {
  doc: FloorplanDoc;
  seatStatus: Readonly<Record<string, SeatStatus>>;
  selected: ReadonlySet<string>;
  locked: boolean;
  onSelect: (id: string | null, additive: boolean) => void;
  onMove: (id: string, x: number, y: number) => void;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e?.contentRect.width ?? 800))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = width / doc.width;
  const drawItem = (item: Item) => {
    const isSelected = selected.has(item.id);
    const outline = isSelected ? color.accent[900] : color.zinc[400];
    const common = {
      key: item.id,
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
            fill={color.zinc[200]}
            stroke={outline}
            strokeWidth={isSelected ? 8 : 3}
            cornerRadius={12}
          />
          <Text
            text={item.label || item.objectType}
            x={16}
            y={16}
            fontSize={48}
            fill={color.zinc[700]}
            listening={false}
          />
        </Group>
      );
    return (
      <Group {...common}>
        {item.kind === 'table' ? (
          item.shape === 'round' ? (
            <Circle
              radius={item.width / 2}
              fill={color.zinc[100]}
              stroke={outline}
              strokeWidth={isSelected ? 8 : 3}
            />
          ) : (
            <Rect
              x={-item.width / 2}
              y={-item.height / 2}
              width={item.width}
              height={item.height}
              fill={color.zinc[100]}
              stroke={outline}
              strokeWidth={isSelected ? 8 : 3}
            />
          )
        ) : (
          <Rect
            x={-SEAT_R - 10}
            y={-SEAT_R - 10}
            width={(item.seats.at(-1)?.x ?? 0) + (SEAT_R + 10) * 2}
            height={(SEAT_R + 10) * 2}
            stroke={isSelected ? outline : undefined}
            strokeWidth={8}
            cornerRadius={SEAT_R}
          />
        )}
        <Text
          text={item.label}
          x={item.kind === 'row' ? -SEAT_R - 90 : -40}
          y={-24}
          width={item.kind === 'row' ? 70 : 80}
          align={item.kind === 'row' ? 'right' : 'center'}
          fontSize={40}
          fill={color.ink}
          listening={false}
        />
        {item.seats.map((s) => (
          <Circle
            key={s.id}
            x={s.x}
            y={s.y}
            radius={SEAT_R}
            fill={seatFill[seatStatus[s.id] ?? 'available']}
            stroke={s.accessible ? color.accent[900] : color.zinc[500]}
            strokeWidth={s.accessible ? 6 : 2}
            listening={false}
            perfectDrawEnabled={false}
          />
        ))}
      </Group>
    );
  };
  return (
    <div ref={box} className="w-full overflow-hidden rounded-card border border-zinc-200 bg-zinc-50">
      <Stage
        width={width}
        height={Math.max(200, doc.height * scale)}
        scaleX={scale}
        scaleY={scale}
        onClick={(e) => {
          if (e.target === e.target.getStage()) onSelect(null, false);
        }}
        aria-label={label}
      >
        <Layer>
          <Rect
            width={doc.width}
            height={doc.height}
            fill={color.white}
            stroke={color.zinc[300]}
            strokeWidth={4}
            listening={false}
          />
          {doc.items.map(drawItem)}
        </Layer>
      </Stage>
    </div>
  );
}
