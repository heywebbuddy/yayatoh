'use client';

import {
  bareItemLabel,
  type FloorplanDoc,
  hitTest,
  PUBLIC_UNDERLAY_OPACITY,
  placedSeats,
} from '@yayatoh/floorplan';
import { paper, paperDark } from '@yayatoh/ui';
import type Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva';
import { PanZoomControls, roomPoint, useBoxWidth, usePanZoom } from './pan-zoom.tsx';
import { type DotStyle, SeatDots } from './seat-dots.tsx';
import { UnderlayImage } from './underlay-image.tsx';

const SEAT_R = 24;
type Palette = { [K in keyof typeof paper]: string };
const dotStyles = (paper: Palette) => ({
  MINE: { fill: paper.selected, stroke: paper.selected, strokeWidth: 3 } as DotStyle,
  FREE: { fill: paper.free, stroke: paper.muted, strokeWidth: 3 } as DotStyle,
  FREE_ACCESSIBLE: { fill: paper.free, stroke: paper.selected, strokeWidth: 6 } as DotStyle,
  TAKEN: { fill: paper.taken, stroke: paper.taken, strokeWidth: 3 } as DotStyle,
});

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
  onToggleTable,
}: {
  doc: FloorplanDoc;
  available: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onToggle: (seatUuid: string) => void;
  /** Tapping a table itself (not one of its seats) chooses its whole table, when offered. */
  onToggleTable?: (itemId: string) => void;
}) {
  const [box, width] = useBoxWidth(600, 260);
  // On the dark showcase surface the map draws in the dark palette (a white panel would glare).
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(Boolean(box.current?.closest('[data-surface="showcase"]'))), [box]);
  const paper_ = dark ? paperDark : paper;
  const { MINE, FREE, FREE_ACCESSIBLE, TAKEN } = useMemo(() => dotStyles(paper_), [paper_]);
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
  }, [available, selected, accessible, paper_]);
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
    else if (
      hit &&
      !hit.seatId &&
      onToggleTable &&
      doc.items.some((i) => i.id === hit.itemId && i.kind === 'table')
    )
      onToggleTable(hit.itemId);
  };
  return (
    <div className="flex flex-col gap-2">
      <PanZoomControls view={view} />
      <div
        ref={box}
        data-testid="seat-map"
        // The organizer's floor plan image, shown faintly under the seats when they chose (M1.7g).
        data-underlay={doc.underlay ? doc.underlay.url : undefined}
        aria-hidden="true"
        className="w-full overflow-hidden rounded-card border border-line"
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
            <Rect width={doc.width} height={doc.height} fill={paper_.free} />
            {doc.underlay ? (
              <UnderlayImage underlay={doc.underlay} opacity={PUBLIC_UNDERLAY_OPACITY} />
            ) : null}
            {doc.items.map((i) =>
              i.kind === 'object' ? (
                <Rect
                  key={i.id}
                  x={i.x}
                  y={i.y}
                  width={i.width}
                  height={i.height}
                  rotation={i.rotation}
                  fill={paper_.floor}
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
                  fill={paper_.sold}
                />
              ) : null,
            )}
            {doc.items.map((i) =>
              i.kind === 'table' ? (
                <Group key={`tb-${i.id}`} x={i.x} y={i.y} rotation={i.rotation}>
                  {i.shape === 'round' ? (
                    <Circle radius={i.width / 2} fill={paper_.floor} stroke={paper_.muted} strokeWidth={3} />
                  ) : (
                    <Rect
                      x={-i.width / 2}
                      y={-i.height / 2}
                      width={i.width}
                      height={i.height}
                      fill={paper_.floor}
                      stroke={paper_.muted}
                      strokeWidth={3}
                    />
                  )}
                  <Text
                    text={bareItemLabel(i.label)}
                    x={-i.width / 2}
                    y={-24}
                    width={i.width}
                    align="center"
                    fontSize={44}
                    fontStyle="bold"
                    fill={paper_.label}
                  />
                </Group>
              ) : i.kind === 'row' ? (
                <Group key={`rw-${i.id}`} x={i.x} y={i.y} rotation={i.rotation}>
                  <Text
                    text={bareItemLabel(i.label)}
                    x={-SEAT_R - 90}
                    y={-24}
                    width={70}
                    align="right"
                    fontSize={40}
                    fontStyle="bold"
                    fill={paper_.label}
                  />
                </Group>
              ) : null,
            )}
            <SeatDots dots={dots} radius={SEAT_R} styleOf={styleOf} version={version} scale={view.scale} />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
