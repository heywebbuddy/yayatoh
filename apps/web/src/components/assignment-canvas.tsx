'use client';

import { type FloorplanDoc, placedSeats } from '@yayatoh/floorplan';
import type { AssignSeatState } from '@yayatoh/seating';
import { color, status as statusColor } from '@yayatoh/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva';

const SEAT_R = 22;

const fill: Record<AssignSeatState, string> = {
  free: color.white,
  assigned: color.accent[900],
  sold: color.zinc[700],
  held: statusColor.warning,
  reserved: color.zinc[200],
  blocked: statusColor.danger,
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
    <div ref={box} className="w-full overflow-hidden rounded-card border border-zinc-200 bg-zinc-50">
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
            fill={color.white}
            stroke={color.zinc[300]}
            strokeWidth={4}
          />
          {doc.items.map((item) => {
            const on = highlight?.itemId === item.id && !highlight.seatId;
            const stroke = on ? color.accent[900] : color.zinc[400];
            if (item.kind === 'object')
              return (
                <Group key={item.id} x={item.x} y={item.y} rotation={item.rotation}>
                  <Rect width={item.width} height={item.height} fill={color.zinc[200]} cornerRadius={12} />
                  <Text
                    text={item.label || item.objectType}
                    x={16}
                    y={16}
                    fontSize={48}
                    fill={color.zinc[700]}
                  />
                </Group>
              );
            const last = item.seats.at(-1);
            return (
              <Group key={item.id} x={item.x} y={item.y} rotation={item.rotation}>
                {item.kind === 'table' ? (
                  item.shape === 'round' ? (
                    <Circle
                      radius={item.width / 2}
                      fill={color.zinc[100]}
                      stroke={stroke}
                      strokeWidth={on ? 10 : 3}
                    />
                  ) : (
                    <Rect
                      x={-item.width / 2}
                      y={-item.height / 2}
                      width={item.width}
                      height={item.height}
                      fill={color.zinc[100]}
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
                  fill={color.ink}
                />
                {item.kind === 'table' ? (
                  <Text
                    text={occupancy[item.id] ?? ''}
                    x={-60}
                    y={4}
                    width={120}
                    align="center"
                    fontSize={32}
                    fill={color.zinc[600]}
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
                stroke={on ? color.ink : s.accessible ? color.accent[900] : color.zinc[500]}
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
