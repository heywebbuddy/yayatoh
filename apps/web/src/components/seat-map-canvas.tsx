'use client';

import {
  bareItemLabel,
  type FloorplanDoc,
  hitTest,
  PUBLIC_UNDERLAY_OPACITY,
  placedSeats,
  regionAt,
  type SeatRegion,
  seatGrid,
  seatNear,
} from '@yayatoh/floorplan';
import { paper, paperDark } from '@yayatoh/ui';
import type Konva from 'konva';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { SectionStats } from '@/lib/seat-map-model.ts';
import { PanZoomControls, roomPoint, useBoxWidth, usePanZoom } from './pan-zoom.tsx';
import { type DotStyle, SeatDots } from './seat-dots.tsx';
import { UnderlayImage } from './underlay-image.tsx';

const SEAT_R = 24;
/** Below this on-screen seat radius (px), sections stand in for their seats. */
const OVERVIEW_BELOW_PX = 9;
/** A focused section opens at this scale at least, so its seats show and can be tapped. */
const SECTION_SCALE = (OVERVIEW_BELOW_PX + 1) / SEAT_R;
const CLOSEST_SCALE = 16 / SEAT_R;
/** A section's name needs this much width on screen (px), its price and seats left this much. */
const NAME_WIDTH_PX = 44;
const DETAIL_WIDTH_PX = 96;
const TIP_OFFSET_PX = 14;

export interface SeatTip {
  readonly title: string;
  readonly detail: string;
}

/**
 * The buyer's map: tap a free seat to choose it (the seat list beside it does the same, by
 * keyboard). Zoom and pan for large rooms. Seats are one batched shape and taps are hit-tested
 * in room coordinates, so a 5,000-seat plan pans smoothly (M1.7f). Seats are coloured by price.
 *
 * Zoomed out, while seats would be too small to read or tap, a plan with sections shows them as
 * coloured shapes instead: a tap on one zooms in to its seats.
 */
export default function SeatMapCanvas({
  doc,
  dark,
  regions,
  stats,
  sectionFill,
  activeSection,
  available,
  selected,
  muted,
  fills,
  tipOf,
  onToggle,
  onToggleTable,
  onSection,
}: {
  doc: FloorplanDoc;
  dark: boolean;
  regions: readonly SeatRegion[];
  stats: ReadonlyMap<string, SectionStats>;
  /** A section's colours, from its stats. */
  sectionFill: (stats: SectionStats | undefined) => { fill: string; ink: string };
  activeSection: string | null;
  available: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  /** Free seats the price filter leaves out: faint, and not choosable on the map. */
  muted: ReadonlySet<string>;
  /** Seat id → its price colour. */
  fills: ReadonlyMap<string, string>;
  tipOf: (seatUuid: string) => SeatTip | null;
  onToggle: (seatUuid: string) => void;
  /** Tapping a table itself (not one of its seats) chooses its whole table, when offered. */
  onToggleTable?: (itemId: string) => void;
  onSection: (sectionId: string | null) => void;
}) {
  const t = useTranslations('checkout.seats');
  const [box, width] = useBoxWidth(600, 260);
  // On the showcase surface the map draws in the palette of its resolved theme (a white panel would glare in the dark).
  const paper_ = dark ? paperDark : paper;
  const view = usePanZoom(doc, width, 560, CLOSEST_SCALE);
  const seats = useMemo(() => placedSeats(doc), [doc]);
  const grid = useMemo(() => seatGrid(seats), [seats]);
  const accessible = useMemo(() => new Set(seats.filter((s) => s.accessible).map((s) => s.seatId)), [seats]);
  const inRegion = useMemo(() => new Set(regions.flatMap((r) => r.seatIds)), [regions]);
  const regionIds = useMemo(() => new Set(regions.map((r) => r.id)), [regions]);
  const overview = regions.length > 0 && SEAT_R * view.scale < OVERVIEW_BELOW_PX && view.zoom < view.maxZoom;
  // In the overview the shapes stand in for their seats, except the buyer's own.
  const dots = useMemo(
    () =>
      seats
        .filter((s) => !overview || !inRegion.has(s.seatId) || selected.has(s.seatId))
        .map((s) => ({ id: s.seatId, x: s.x, y: s.y })),
    [seats, overview, inRegion, selected],
  );
  const down = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef<{ distance: number } | null>(null);
  const pinched = useRef(false);
  const [tip, setTip] = useState<(SeatTip & { key: string; x: number; y: number }) | null>(null);
  // A new version whenever what the seats look like changes (the cached bitmap is redrawn).
  const versions = useRef(0);
  const version = useMemo(() => {
    // The inputs are the trigger: any new availability, selection or plan is a new look.
    void [available, selected, accessible, muted, fills];
    versions.current += 1;
    return String(versions.current);
  }, [available, selected, accessible, muted, fills, paper_, overview]);
  const styleOf = ({ id }: { id: string }): DotStyle => {
    if (selected.has(id)) return { fill: paper_.selected, stroke: paper_.label, strokeWidth: 5 };
    if (!available.has(id)) return { fill: paper_.taken, stroke: paper_.taken, strokeWidth: 3 };
    if (muted.has(id)) return { fill: paper_.reserved, stroke: paper_.taken, strokeWidth: 3 };
    const fill = fills.get(id) ?? paper_.free;
    return accessible.has(id)
      ? { fill, stroke: paper_.label, strokeWidth: 8 }
      : { fill, stroke: fill, strokeWidth: 3 };
  };

  // The section chosen here or in the panel opens on the map; none goes back to the whole room.
  const shown = useRef(activeSection);
  const focusRegion = (region: SeatRegion) => view.focus(region.bounds, SECTION_SCALE);
  useEffect(() => {
    if (shown.current === activeSection) return;
    shown.current = activeSection;
    const region = regions.find((r) => r.id === activeSection);
    if (region) focusRegion(region);
    else view.glideHome();
  }, [activeSection, regions]);

  const pointerAt = (stage: Konva.Stage | null) => {
    const at = roomPoint(stage);
    const p = stage?.getPointerPosition();
    return at && p ? { at, p } : null;
  };
  const describe = (stage: Konva.Stage | null) => {
    const here = pointerAt(stage);
    if (!here) return null;
    if (overview) {
      const region = regionAt(regions, here.at);
      if (region) {
        const s = stats.get(region.id);
        return {
          key: region.id,
          title: region.label,
          detail:
            s && s.left > 0
              ? `${t('sectionFrom', { price: s.from?.label ?? '' })} · ${t('sectionLeft', { count: s.left })}`
              : t(s?.free ? 'sectionOtherPrices' : 'sectionNone'),
          ...here.p,
        };
      }
    }
    const seat = seatNear(grid, here.at, SEAT_R + 6);
    const seatTip = seat ? tipOf(seat.seatId) : null;
    return seat && seatTip ? { key: seat.seatId, ...seatTip, ...here.p } : null;
  };
  const choose = (e: Konva.KonvaEventObject<Event>) => {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    // A drag (a pan) or a pinch is not a tap.
    if (pinched.current) return;
    if (p && down.current && Math.hypot(p.x - down.current.x, p.y - down.current.y) > 6) return;
    const at = roomPoint(stage ?? null);
    if (!at) return;
    setTip(describe(stage ?? null));
    const region = overview ? regionAt(regions, at) : null;
    if (region) {
      setTip(null);
      if (region.id === activeSection) focusRegion(region);
      else onSection(region.id);
      return;
    }
    const hit = hitTest(doc, at, { seatRadius: SEAT_R + 6 });
    if (hit?.seatId && available.has(hit.seatId)) {
      if (selected.has(hit.seatId) || !muted.has(hit.seatId)) onToggle(hit.seatId);
    } else if (
      hit &&
      !hit.seatId &&
      onToggleTable &&
      doc.items.some((i) => i.id === hit.itemId && i.kind === 'table')
    )
      onToggleTable(hit.itemId);
  };
  // Two fingers zoom, around the point between them.
  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const [a, b] = e.evt.touches;
    const stage = e.target.getStage();
    if (!a || !b || !stage) return;
    e.evt.preventDefault();
    stage.stopDrag();
    pinched.current = true;
    const rect = stage.container().getBoundingClientRect();
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.current)
      view.zoomBy(distance / pinch.current.distance, {
        x: (a.clientX + b.clientX) / 2 - rect.left,
        y: (a.clientY + b.clientY) / 2 - rect.top,
      });
    pinch.current = { distance };
  };
  const onTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    if (e.evt.touches.length >= 2) return;
    pinch.current = null;
    // The last finger's lift still reports a tap: it stays a pinch until the next touch.
    if (e.evt.touches.length === 0) setTimeout(() => (pinched.current = false), 0);
  };
  const px = (size: number) => size / view.scale;
  return (
    <div className="relative flex flex-col gap-2">
      <div
        ref={box}
        data-testid="seat-map"
        data-overview={overview ? 'true' : undefined}
        data-section-count={regions.length}
        // The organizer's floor plan image, shown faintly under the seats when they chose (M1.7g).
        data-underlay={doc.underlay ? doc.underlay.url : undefined}
        aria-hidden="true"
        className="relative w-full overflow-hidden rounded-card border border-line"
        // One finger scrolls the page until the map is zoomed in, then it pans the map.
        style={{ touchAction: view.zoom > 1 ? 'none' : 'pan-x pan-y' }}
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
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onDragStart={() => setTip(null)}
          onPointerMove={(e) => {
            if (e.evt.pointerType === 'touch') return;
            const stage = e.target.getStage();
            const next = describe(stage);
            stage?.container().style.setProperty('cursor', next ? 'pointer' : '');
            setTip(next);
          }}
          onPointerLeave={() => setTip(null)}
        >
          <Layer listening={false}>
            <Rect width={doc.width} height={doc.height} fill={paper_.free} />
            {doc.underlay ? (
              <UnderlayImage underlay={doc.underlay} opacity={PUBLIC_UNDERLAY_OPACITY} />
            ) : null}
            {regions.map((r) => {
              const s = stats.get(r.id);
              const { fill, ink } = sectionFill(s);
              const onScreen = r.bounds.width * view.scale;
              const name = r.vip ? `${r.label} · ${t('vip')}` : r.label;
              return (
                <Group key={r.id}>
                  <Line
                    points={r.outline.flatMap((p) => [p.x, p.y])}
                    closed
                    fill={overview ? fill : paper_.floor}
                    stroke={
                      overview
                        ? r.vip
                          ? paper_.label
                          : fill
                        : r.id === activeSection
                          ? paper_.selected
                          : paper_.outline
                    }
                    strokeWidth={overview ? px(r.vip ? 3 : 1) : px(r.id === activeSection ? 2 : 1)}
                    lineJoin="round"
                  />
                  {overview && onScreen >= NAME_WIDTH_PX ? (
                    <>
                      <Text
                        text={name}
                        x={r.bounds.x}
                        y={r.center.y - px(onScreen >= DETAIL_WIDTH_PX ? 17 : 7)}
                        width={r.bounds.width}
                        align="center"
                        wrap="none"
                        ellipsis
                        fontSize={px(13)}
                        fontStyle="bold"
                        fill={ink}
                      />
                      {onScreen >= DETAIL_WIDTH_PX ? (
                        <Text
                          text={
                            s && s.left > 0
                              ? `${t('sectionFrom', { price: s.from?.label ?? '' })}\n${t('sectionLeft', { count: s.left })}`
                              : t(s?.free ? 'sectionOtherPrices' : 'sectionNone')
                          }
                          x={r.bounds.x}
                          y={r.center.y}
                          width={r.bounds.width}
                          align="center"
                          lineHeight={1.25}
                          fontSize={px(11)}
                          fill={ink}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {overview ? null : (
                    <Text
                      text={name}
                      x={r.bounds.x}
                      y={r.bounds.y + px(4)}
                      width={r.bounds.width}
                      align="center"
                      wrap="none"
                      ellipsis
                      fontSize={px(12)}
                      fontStyle="bold"
                      fill={paper_.label}
                    />
                  )}
                </Group>
              );
            })}
            {doc.items.map((i) =>
              i.kind === 'object' ? (
                <Group key={i.id} x={i.x} y={i.y} rotation={i.rotation}>
                  <Rect
                    width={i.width}
                    height={i.height}
                    fill={i.objectType === 'stage' ? paper_.sold : paper_.floor}
                    stroke={paper_.outline}
                    strokeWidth={px(1)}
                    cornerRadius={12}
                  />
                  {i.label ? (
                    <Text
                      text={i.label}
                      width={i.width}
                      height={i.height}
                      align="center"
                      verticalAlign="middle"
                      wrap="none"
                      ellipsis
                      fontSize={Math.min(i.height * 0.6, Math.max(48, px(12)))}
                      fontStyle={i.objectType === 'stage' ? 'bold' : 'normal'}
                      fill={i.objectType === 'stage' ? paper_.background : paper_.sold}
                    />
                  ) : null}
                </Group>
              ) : null,
            )}
            {doc.items.map((i) => {
              // Tables and rows of a section show with their seats, not over its shape.
              if (overview && i.kind !== 'object' && i.sectionId && regionIds.has(i.sectionId)) return null;
              return i.kind === 'table' ? (
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
                  {/* Upright whatever the row's angle, beside its first seat. */}
                  <Text
                    text={bareItemLabel(i.label)}
                    x={-SEAT_R - 50}
                    rotation={-i.rotation}
                    width={140}
                    offsetX={70}
                    offsetY={20}
                    align="center"
                    wrap="none"
                    fontSize={40}
                    fontStyle="bold"
                    fill={paper_.label}
                  />
                </Group>
              ) : null;
            })}
            <SeatDots dots={dots} radius={SEAT_R} styleOf={styleOf} version={version} scale={view.scale} />
          </Layer>
        </Stage>
        {tip ? (
          <div
            data-testid="seat-tip"
            className="pointer-events-none absolute z-10 max-w-56 rounded-card border border-line bg-surface px-2.5 py-1.5 text-caption text-ink shadow-sm"
            style={{
              // The tip stays inside the map, on whichever side of the pointer has room.
              ...(tip.x > width / 2
                ? { right: width - tip.x + TIP_OFFSET_PX }
                : { left: tip.x + TIP_OFFSET_PX }),
              ...(tip.y > view.height / 2
                ? { bottom: view.height - tip.y + TIP_OFFSET_PX }
                : { top: tip.y + TIP_OFFSET_PX }),
            }}
          >
            <p className="m-0 font-bold">{tip.title}</p>
            <p className="m-0 text-ink-2">{tip.detail}</p>
          </div>
        ) : null}
      </div>
      {/* Over the map where it has room; on a phone it would hide too much of it. */}
      <div className="order-first self-end rounded-card border border-line bg-surface p-0.5 @lg:absolute @lg:end-2 @lg:top-2">
        <PanZoomControls view={view} compact onReset={() => onSection(null)} />
      </div>
      {overview ? <p className="m-0 text-caption text-ink-2">{t('sectionHint')}</p> : null}
    </div>
  );
}
