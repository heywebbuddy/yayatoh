'use client';

import { type FloorplanDoc, placedSeats } from '@yayatoh/floorplan';
import { color } from '@yayatoh/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Layer, Rect, Stage, Text } from 'react-konva';

/**
 * The buyer's map: tap a free seat to choose it (the seat list beside it does the same, by
 * keyboard). Stage and objects are drawn for orientation.
 */
export default function SeatMapCanvas({
  doc,
  available,
  selected,
  onToggle,
}: {
  doc: FloorplanDoc;
  available: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onToggle: (seatUuid: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.floor(e?.contentRect.width ?? 600))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const seats = useMemo(() => placedSeats(doc), [doc]);
  const scale = width / doc.width;
  return (
    <div ref={box} className="w-full overflow-hidden rounded-card border border-zinc-200">
      <Stage width={width} height={Math.max(160, doc.height * scale)} scaleX={scale} scaleY={scale}>
        <Layer>
          <Rect width={doc.width} height={doc.height} fill={color.white} listening={false} />
          {doc.items.map((i) =>
            i.kind === 'object' ? (
              <Rect
                key={i.id}
                x={i.x}
                y={i.y}
                width={i.width}
                height={i.height}
                rotation={i.rotation}
                fill={color.zinc[200]}
                cornerRadius={12}
                listening={false}
              />
            ) : null,
          )}
          {doc.items.map((i) =>
            i.kind === 'object' && i.label ? (
              <Text
                key={`t-${i.id}`}
                x={i.x + 16}
                y={i.y + 16}
                text={i.label}
                fontSize={48}
                fill={color.zinc[700]}
                listening={false}
              />
            ) : null,
          )}
          {seats.map((s) => {
            const free = available.has(s.seatId);
            const mine = selected.has(s.seatId);
            return (
              <Circle
                key={s.seatId}
                x={s.x}
                y={s.y}
                radius={24}
                fill={mine ? color.accent[900] : free ? color.white : color.zinc[300]}
                stroke={free ? color.zinc[600] : color.zinc[300]}
                strokeWidth={3}
                listening={free}
                onClick={() => onToggle(s.seatId)}
                onTap={() => onToggle(s.seatId)}
              />
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
