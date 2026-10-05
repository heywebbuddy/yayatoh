'use client';

import { type FloorplanDoc, placedSeats } from '@yayatoh/floorplan';
import type { AssignSeatState } from '@yayatoh/seating';
import { paper } from '@yayatoh/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva';

const SEAT_R = 22;

const fill: Record<AssignSeatState, string> = {
  free: paper.free,
  assigned: paper.selected,
  sold: paper.sold,
  held: paper.held,
  reserved: paper.floor,
  blocked: paper.blocked,
};

/**
 * The plan for assigning guests (Konva, drawing only): tables and rows with how full they are,
 * each seat coloured by who has it, and the table or seat a guest is being dragged over. Drops
 * are handled by the page around it (hit-tested in room coordinates); the lists beside it do
 * everything by keyboard.
 */
export default function AssignmentCanvas({
  doc,
  seatState,
  occupancy,
  highlight,
}: {
  doc: FloorplanDoc;
  seatState: Readonly<Record<string, AssignSeatState>>;
  /** Item id → "taken/capacity". */
  occupancy: Readonly<Record<string, string>>;
  highlight: { itemId: string; seatId: string | null } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e?.contentRect.width ?? 800))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const seats = useMemo(() => placedSeats(doc), [doc]);
  const scale = width / doc.width;
  return (
    <div ref={box} className="w-full overflow-hidden rounded-card border border-line bg-surface-2">
      <Stage
        width={width}
        height={Math.max(160, doc.height * scale)}
        scaleX={scale}
        scaleY={scale}
        listening={false}
      >
        <Layer listening={false}>
          <Rect
            width={doc.width}
            height={doc.height}
            fill={paper.free}
            stroke={paper.taken}
            strokeWidth={4}
          />
          {doc.items.map((item) => {
            const on = highlight?.itemId === item.id && !highlight.seatId;
            const stroke = on ? paper.selected : paper.outline;
            if (item.kind === 'object')
              return (
                <Group key={item.id} x={item.x} y={item.y} rotation={item.rotation}>
                  <Rect width={item.width} height={item.height} fill={paper.floor} cornerRadius={12} />
                  <Text text={item.label || item.objectType} x={16} y={16} fontSize={48} fill={paper.sold} />
                </Group>
              );
            const last = item.seats.at(-1);
            return (
              <Group key={item.id} x={item.x} y={item.y} rotation={item.rotation}>
                {item.kind === 'table' ? (
                  item.shape === 'round' ? (
                    <Circle
                      radius={item.width / 2}
                      fill={paper.floor}
                      stroke={stroke}
                      strokeWidth={on ? 10 : 3}
                    />
                  ) : (
                    <Rect
                      x={-item.width / 2}
                      y={-item.height / 2}
                      width={item.width}
                      height={item.height}
                      fill={paper.floor}
                      stroke={stroke}
                      strokeWidth={on ? 10 : 3}
                    />
                  )
                ) : on ? (
                  <Rect
                    x={-SEAT_R - 10}
                    y={-SEAT_R - 10}
                    width={(last?.x ?? 0) + (SEAT_R + 10) * 2}
                    height={(SEAT_R + 10) * 2}
                    stroke={stroke}
                    strokeWidth={8}
                    cornerRadius={SEAT_R}
                  />
                ) : null}
                <Text
                  text={item.label}
                  x={item.kind === 'row' ? -SEAT_R - 90 : -60}
                  y={item.kind === 'row' ? -24 : -44}
                  width={item.kind === 'row' ? 70 : 120}
                  align={item.kind === 'row' ? 'right' : 'center'}
                  fontSize={40}
                  fill={paper.label}
                />
                {item.kind === 'table' ? (
                  <Text
                    text={occupancy[item.id] ?? ''}
                    x={-60}
                    y={4}
                    width={120}
                    align="center"
                    fontSize={32}
                    fill={paper.muted}
                  />
                ) : null}
              </Group>
            );
          })}
          {seats.map((s) => {
            const on = highlight?.seatId === s.seatId;
            return (
              <Circle
                key={s.seatId}
                x={s.x}
                y={s.y}
                radius={on ? SEAT_R + 6 : SEAT_R}
                fill={fill[seatState[s.seatId] ?? 'free']}
                stroke={on ? paper.label : s.accessible ? paper.selected : paper.outline}
                strokeWidth={on ? 8 : s.accessible ? 6 : 2}
                perfectDrawEnabled={false}
              />
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
