'use client';

import { type FloorplanDoc, hitTest, placedSeats } from '@yayatoh/floorplan';
import { color } from '@yayatoh/ui';
import type Konva from 'konva';
import { useMemo, useRef } from 'react';
import { Layer, Rect, Stage, Text } from 'react-konva';
import { PanZoomControls, roomPoint, useBoxWidth, usePanZoom } from './pan-zoom.tsx';
import { type DotStyle, SeatDots } from './seat-dots.tsx';

const SEAT_R = 24;
const MINE: DotStyle = { fill: color.accent[900], stroke: color.accent[900], strokeWidth: 3 };
const FREE: DotStyle = { fill: color.white, stroke: color.zinc[600], strokeWidth: 3 };
const FREE_ACCESSIBLE: DotStyle = { fill: color.white, stroke: color.accent[900], strokeWidth: 6 };
const TAKEN: DotStyle = { fill: color.zinc[300], stroke: color.zinc[300], strokeWidth: 3 };

/**
 * The buyer's map: tap a free seat to choose it (the seat list beside it does the same, by
 * keyboard). Zoom and pan for large rooms. Seats are one batched shape and taps are hit-tested
 * in room coordinates, so a 5,000-seat plan pans smoothly (M1.7f).
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
  const [box, width] = useBoxWidth(600, 260);
  const view = usePanZoom(doc, width, 560);
  const seats = useMemo(() => placedSeats(doc), [doc]);
  const dots = useMemo(() => seats.map((s) => ({ id: s.seatId, x: s.x, y: s.y })), [seats]);
  const accessible = useMemo(() => new Set(seats.filter((s) => s.accessible).map((s) => s.seatId)), [seats]);
  const down = useRef<{ x: number; y: number } | null>(null);
  // A new version whenever what the seats look like changes (the cached bitmap is redrawn).
  const versions = useRef(0);
  const version = useMemo(() => {
    // The inputs are the trigger: any new availability, selection or plan is a new look.
    void [available, selected, accessible];
    versions.current += 1;
    return String(versions.current);
  }, [available, selected, accessible]);
  const styleOf = ({ id }: { id: string }) =>
    selected.has(id) ? MINE : available.has(id) ? (accessible.has(id) ? FREE_ACCESSIBLE : FREE) : TAKEN;
  const choose = (e: Konva.KonvaEventObject<Event>) => {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    // A drag (a pan) is not a tap.
    if (p && down.current && Math.hypot(p.x - down.current.x, p.y - down.current.y) > 6) return;
    const at = roomPoint(stage ?? null);
    const hit = at ? hitTest(doc, at, { seatRadius: SEAT_R + 6 }) : null;
    if (hit?.seatId && available.has(hit.seatId)) onToggle(hit.seatId);
  };
  return (
    <div className="flex flex-col gap-2">
      <PanZoomControls view={view} />
      <div
        ref={box}
        data-testid="seat-map"
        aria-hidden="true"
        className="w-full overflow-hidden rounded-card border border-zinc-200"
      >
        <Stage
          width={width}
          height={view.height}
          scaleX={view.scale}
          scaleY={view.scale}
          x={view.x}
          y={view.y}
          {...view.stageProps}
          onPointerDown={(e) => {
            down.current = e.target.getStage()?.getPointerPosition() ?? null;
          }}
          onClick={choose}
          onTap={choose}
        >
          <Layer listening={false}>
            <Rect width={doc.width} height={doc.height} fill={color.white} />
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
                />
              ) : null,
            )}
            <SeatDots dots={dots} radius={SEAT_R} styleOf={styleOf} version={version} scale={view.scale} />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
