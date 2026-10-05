'use client';

import type { FloorplanDoc } from '@yayatoh/floorplan';
import { paper } from '@yayatoh/ui';
import { useEffect, useRef, useState } from 'react';
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva';

const SEAT_R = 22;

export interface CanvasPlace {
  readonly itemId: string;
  /** Seats tickets hold, then guests seated (drawn in that order around the table). */
  readonly taken: number;
  readonly seated: number;
  readonly capacity: number;
  readonly vip: boolean;
}

/**
 * The guest seating map (M4.3a; Konva, drawing only): each table or row with how full it is
 * ("3/8"), its seats filled in order (ticket holders, then guests), VIP zones ringed, and the
 * table chosen in the details pane or under a dragged party outlined. Drops and clicks are
 * handled by the editor around it (hit-tested in room coordinates); the queue form, the table
 * chooser and "Move to…" do everything by keyboard.
 */
export default function GuestSeatingCanvas({
  doc,
  places,
  selected,
  hover,
}: {
  doc: FloorplanDoc;
  places: ReadonlyMap<string, CanvasPlace>;
  selected: string | null;
  hover: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e?.contentRect.width ?? 640))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
            if (item.kind === 'object')
              return (
                <Group key={item.id} x={item.x} y={item.y} rotation={item.rotation}>
                  <Rect width={item.width} height={item.height} fill={paper.floor} cornerRadius={12} />
                  <Text text={item.label || item.objectType} x={16} y={16} fontSize={48} fill={paper.sold} />
                </Group>
              );
            const p = places.get(item.id);
            const on = hover === item.id || selected === item.id;
            const full = p ? p.taken + p.seated >= p.capacity : false;
            const stroke = on ? paper.selected : p?.vip ? paper.held : paper.outline;
            const strokeWidth = on ? 12 : p?.vip ? 8 : 3;
            const last = item.seats.at(-1);
            return (
              <Group key={item.id} x={item.x} y={item.y} rotation={item.rotation}>
                {item.kind === 'table' ? (
                  item.shape === 'round' ? (
                    <Circle
                      radius={item.width / 2}
                      fill={full ? paper.taken : paper.floor}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                    />
                  ) : (
                    <Rect
                      x={-item.width / 2}
                      y={-item.height / 2}
                      width={item.width}
                      height={item.height}
                      fill={full ? paper.taken : paper.floor}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                    />
                  )
                ) : (
                  <Rect
                    x={-SEAT_R - 10}
                    y={-SEAT_R - 10}
                    width={(last?.x ?? 0) + (SEAT_R + 10) * 2}
                    height={(SEAT_R + 10) * 2}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    cornerRadius={SEAT_R}
                  />
                )}
                <Text
                  text={item.label}
                  x={item.kind === 'row' ? -SEAT_R - 90 : -60}
                  y={item.kind === 'row' ? -24 : -44}
                  width={item.kind === 'row' ? 70 : 120}
                  align={item.kind === 'row' ? 'right' : 'center'}
                  fontSize={40}
                  fill={paper.label}
                />
                {item.kind === 'table' && p ? (
                  <Text
                    text={`${p.taken + p.seated}/${p.capacity}`}
                    x={-60}
                    y={4}
                    width={120}
                    align="center"
                    fontSize={32}
                    fill={paper.muted}
                  />
                ) : null}
                {item.seats.map((s, i) => (
                  <Circle
                    key={s.id}
                    x={s.x}
                    y={s.y}
                    radius={SEAT_R}
                    fill={
                      p && i < p.taken
                        ? paper.sold
                        : p && i < p.taken + p.seated
                          ? paper.selected
                          : paper.free
                    }
                    stroke={paper.outline}
                    strokeWidth={2}
                    perfectDrawEnabled={false}
                  />
                ))}
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
