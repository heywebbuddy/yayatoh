'use client';

import {
  bareItemLabel,
  type FloorplanDoc,
  hitTest,
  PUBLIC_UNDERLAY_OPACITY,
  placedSeats,
  REGION_PAD_CM,
  regionAt,
  type SeatRegion,
  seatGrid,
  seatNear,
} from '@yayatoh/floorplan';
import { paper, paperDark } from '@yayatoh/ui';
// A value import: the section tags measure their names with it (this module only loads in the browser).
import Konva from 'konva';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
/** A section shape's name and price lines (px); a narrow shape's name shrinks to the minimum, then goes. */
const SHAPE_NAME_PX = 13;
const SHAPE_NAME_MIN_PX = 9;
const SHAPE_DETAIL_PX = 11;
/** Below this width an edge-to-edge map is a phone's, and its height is capped (see the map). */
const PHONE_MAP_PX = 640;
const TIP_OFFSET_PX = 14;
/** The strip a focused section keeps clear of the zoom buttons where they float over the map (px). */
const CONTROLS_GUTTER_PX = 56;
/** A row's name sits this far before its first seat: clear of its section's outline when it has one. */
const ROW_LABEL_X = -(SEAT_R + 50);
const SECTION_ROW_LABEL_X = -(REGION_PAD_CM + 46);
/** The name tag over a focused section: its height, its gap above the section, the room around its text (px). */
const TAG_HEIGHT_PX = 22;
const TAG_GAP_PX = 4;
const TAG_PAD_PX = 10;
const TAG_FONT_PX = 12;

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
  bleed = false,
  extraControl = null,
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
  /** On a phone, run the map edge to edge across the screen (checkout; not inside console cards). */
  bleed?: boolean;
  /** One more control beside the zoom buttons (the room's photos). */
  extraControl?: ReactNode;
  onToggle: (seatUuid: string) => void;
  /** Tapping a table itself (not one of its seats) chooses its whole table, when offered. */
  onToggleTable?: (itemId: string) => void;
  onSection: (sectionId: string | null) => void;
}) {
  const t = useTranslations('checkout.seats');
  const [box, width] = useBoxWidth(600, 260);
  // On the showcase surface the map draws in the palette of its resolved theme (a white panel would glare in the dark).
  const paper_ = dark ? paperDark : paper;
  // An edge-to-edge map on a phone stops short of the screen's height, so a finger can still
  // scroll the page past it once it is zoomed in (and pans the map).
  const onPhone = bleed && width < PHONE_MAP_PX && window.matchMedia(`(max-width: ${PHONE_MAP_PX - 0.02}px)`).matches;
  // Where the zoom buttons float over the map's top-right corner, the whole room is drawn as if it
  // were a strip wider on that side, so it sits clear of them instead of under them. (The plan is
  // drawn from its left edge, so right-to-left pages, whose buttons sit top-left, keep the plain fit.)
  const controls = useRef<HTMLDivElement>(null);
  const [controlsOver, setControlsOver] = useState(false);
  // Before the first paint, so the room is fitted once, not twice.
  useLayoutEffect(() => {
    const el = controls.current;
    setControlsOver(
      el ? getComputedStyle(el).position === 'absolute' && getComputedStyle(el).direction !== 'rtl' : false,
    );
  }, [width]);
  const room = useMemo(
    () =>
      controlsOver && width > CONTROLS_GUTTER_PX * 4
        ? { width: (doc.width * width) / (width - CONTROLS_GUTTER_PX), height: doc.height }
        : doc,
    [controlsOver, width, doc],
  );
  const view = usePanZoom(
    room,
    width,
    onPhone ? Math.min(560, Math.round(width * 1.1), Math.round(window.innerHeight * 0.75)) : 560,
    CLOSEST_SCALE,
  );
  const seats = useMemo(() => placedSeats(doc), [doc]);
  const grid = useMemo(() => seatGrid(seats), [seats]);
  const accessible = useMemo(() => new Set(seats.filter((s) => s.accessible).map((s) => s.seatId)), [seats]);
  const regionIds = useMemo(() => new Set(regions.map((r) => r.id)), [regions]);
  // The scale a chosen section opened at. While the map stays at least that close, the section's
  // seats show even fitted small on a phone; zoomed out past it, the shapes return everywhere.
  const focusFloor = useRef(0);
  const tiny = SEAT_R * view.scale < OVERVIEW_BELOW_PX && view.zoom < view.maxZoom;
  const overview =
    regions.length > 0 && (!activeSection || view.scale < focusFloor.current * 0.95) && tiny;
  // Sections drawn as shapes: all of them in the overview; beside a chosen section, the others
  // while their seats would still be too small to read or tap.
  const shaped = useMemo(
    () => (overview ? regions : activeSection && tiny ? regions.filter((r) => r.id !== activeSection) : []),
    [overview, activeSection, tiny, regions],
  );
  const shapedIds = useMemo(() => new Set(shaped.map((r) => r.id)), [shaped]);
  const shapedSeats = useMemo(() => new Set(shaped.flatMap((r) => r.seatIds)), [shaped]);
  // A shape stands in for its seats, except the buyer's own.
  const dots = useMemo(
    () =>
      seats
        .filter((s) => !shapedSeats.has(s.seatId) || selected.has(s.seatId))
        .map((s) => ({ id: s.seatId, x: s.x, y: s.y })),
    [seats, shapedSeats, selected],
  );
  // Where each sectioned row's name goes (both ends, outside its section), worked out once per plan.
  const rowLabels = useMemo(
    () =>
      new Map(
        doc.items.flatMap((i) =>
          i.kind === 'row' && i.sectionId && regionIds.has(i.sectionId) ? [[i.id, rowEnds(i, regions)] as const] : [],
        ),
      ),
    [doc, regions, regionIds],
  );
  // Each shape's name, measured once per plan, and how much room the shape really has (a slanted
  // block's bounding box is wider than the block)…
  const shapeNames = useMemo(
    () =>
      new Map(
        regions.map((r) => {
          const name = r.vip ? `${r.label} · ${t('vip')}` : r.label;
          return [
            r.id,
            {
              name,
              nameW: textWidth(name, SHAPE_NAME_PX, 'bold'),
              // A VIP section too small for "Floor B · VIP" still shows "Floor B" (its outline marks it VIP).
              short: r.label,
              shortW: textWidth(r.label, SHAPE_NAME_PX, 'bold'),
              area: polygonArea(r.outline),
            },
          ] as const;
        }),
      ),
    [regions, t],
  );
  // …and its price lines, measured again only when what they say changes.
  const shapeText = useMemo(
    () =>
      new Map(
        regions.map((r) => {
          const s = stats.get(r.id);
          const detail =
            s && s.left > 0
              ? [t('sectionFrom', { price: s.from?.label ?? '' }), t('sectionLeft', { count: s.left })]
              : [t(s?.free ? 'sectionOtherPrices' : 'sectionNone')];
          const named = shapeNames.get(r.id);
          return [
            r.id,
            {
              name: named?.name ?? r.label,
              nameW: named?.nameW ?? 0,
              short: named?.short ?? r.label,
              shortW: named?.shortW ?? 0,
              area: named?.area ?? 0,
              detail,
              detailW: Math.max(...detail.map((l) => textWidth(l, SHAPE_DETAIL_PX, 'normal'))),
            },
          ] as const;
        }),
      ),
    [regions, stats, t, shapeNames],
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
  }, [available, selected, accessible, muted, fills, paper_, shaped]);
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
  // The whole section fits, its name tag included: on a phone that is closer to its seats than the
  // overview, never wider than the screen. Where the zoom buttons float over the map's top corner
  // (the inline end: left in right-to-left languages), the section stays clear of them.
  const focusRegion = ({ bounds }: SeatRegion) => {
    const over = controls.current ? getComputedStyle(controls.current).position === 'absolute' : false;
    const rtl = box.current ? getComputedStyle(box.current).direction === 'rtl' : false;
    const gutter = over ? CONTROLS_GUTTER_PX : 0;
    const tag = TAG_HEIGHT_PX + TAG_GAP_PX;
    const fits = Math.min((width - gutter) / bounds.width, (view.height - tag) / bounds.height) * 0.9;
    const floor = Math.min(SECTION_SCALE, fits);
    focusFloor.current = floor;
    view.focus(
      {
        x: rtl ? bounds.x - gutter / fits : bounds.x,
        y: bounds.y - tag / fits,
        width: bounds.width + gutter / fits,
        height: bounds.height + tag / fits,
      },
      floor,
    );
  };
  useEffect(() => {
    if (shown.current === activeSection) return;
    shown.current = activeSection;
    const region = regions.find((r) => r.id === activeSection);
    if (region) focusRegion(region);
    else view.glideHome();
  }, [activeSection, regions]);

  // The shape under a point, if that section is drawn as one. Resolved over every section first,
  // so an edge seat of the chosen section where padded outlines overlap is never its neighbour's.
  const shapeAt = (at: { x: number; y: number }) => {
    const hit = regionAt(regions, at);
    return hit && shapedIds.has(hit.id) ? hit : null;
  };
  const pointerAt = (stage: Konva.Stage | null) => {
    const at = roomPoint(stage);
    const p = stage?.getPointerPosition();
    return at && p ? { at, p } : null;
  };
  const describe = (stage: Konva.Stage | null) => {
    const here = pointerAt(stage);
    if (!here) return null;
    if (shaped.length) {
      const region = shapeAt(here.at);
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
    const region = shaped.length ? shapeAt(at) : null;
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
        // On a phone (a narrow screen and a narrow picker) the map runs edge to edge across the
        // screen, out of the cards around it, so the room draws as large as the screen allows. A
        // narrow picker on a wide screen (a console side panel) keeps its frame.
        // Equal negative margins on both sides keep it centred in either reading direction.
        className={`relative w-full overflow-hidden rounded-card border border-line ${bleed ? 'max-sm:@max-md:mx-[calc(50%-50vw)] max-sm:@max-md:w-screen max-sm:@max-md:rounded-none max-sm:@max-md:border-x-0' : ''}`}
        // One finger scrolls the page until the map is zoomed in, then it pans the map. The frame
        // is the room's colour, so no page shows around the plan when it is panned or narrower.
        style={{ touchAction: view.zoom > 1 ? 'none' : 'pan-x pan-y', background: paper_.free }}
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
              const asShape = shapedIds.has(r.id);
              const label = shapeText.get(r.id);
              const name = label?.name ?? r.label;
              // The room the shape really has on screen: a slanted block is narrower than its box.
              const roomW = label ? Math.min(r.bounds.width, label.area / r.bounds.height) * view.scale : 0;
              const roomH = label ? Math.min(r.bounds.height, label.area / r.bounds.width) * view.scale : 0;
              // The name shrinks to fit a narrow section (down to a readable size), then goes; the
              // price lines show only where they fit whole.
              const fitSize = (w: number) => (w > 0 ? Math.min(SHAPE_NAME_PX, (SHAPE_NAME_PX * (roomW - 6)) / w) : 0);
              const full = label ? fitSize(label.nameW) : 0;
              // Too small for its full name ("Floor B · VIP"): its short one ("Floor B").
              const useShort = label !== undefined && full < SHAPE_NAME_MIN_PX && label.shortW < label.nameW;
              const shapeName = useShort && label ? label.short : name;
              const nameSize = useShort && label ? fitSize(label.shortW) : full;
              const showName = asShape && nameSize >= SHAPE_NAME_MIN_PX && roomH >= nameSize + 4;
              const lines = label?.detail.length ?? 0;
              const showDetail =
                showName &&
                nameSize >= SHAPE_NAME_PX - 1 &&
                (label?.detailW ?? 0) <= roomW - 10 &&
                roomH >= SHAPE_NAME_PX + lines * SHAPE_DETAIL_PX * 1.25 + 12;
              return (
                <Group key={r.id}>
                  <Line
                    points={r.outline.flatMap((p) => [p.x, p.y])}
                    closed
                    fill={asShape ? fill : paper_.floor}
                    stroke={
                      asShape
                        ? r.vip
                          ? paper_.label
                          : fill
                        : r.id === activeSection
                          ? paper_.selected
                          : paper_.outline
                    }
                    strokeWidth={asShape ? px(r.vip ? 3 : 1) : px(r.id === activeSection ? 2 : 1)}
                    lineJoin="round"
                  />
                  {showName ? (
                    <Text
                      text={shapeName}
                      x={r.bounds.x}
                      y={r.center.y - px(showDetail ? 17 : nameSize / 2 + 1)}
                      width={r.bounds.width}
                      align="center"
                      wrap="none"
                      ellipsis
                      fontSize={px(nameSize)}
                      fontStyle="bold"
                      fill={ink}
                    />
                  ) : null}
                  {showDetail && label ? (
                    <Text
                      text={label.detail.join('\n')}
                      x={r.bounds.x}
                      y={r.center.y}
                      width={r.bounds.width}
                      align="center"
                      lineHeight={1.25}
                      fontSize={px(SHAPE_DETAIL_PX)}
                      fill={ink}
                    />
                  ) : null}
                  {asShape || overview ? null : (
                    // A name tag centred just above the section, clear of its seats and its edge.
                    <SectionTag
                      name={name}
                      cx={r.bounds.x + r.bounds.width / 2}
                      top={r.bounds.y}
                      maxWidth={r.bounds.width}
                      px={px}
                      fill={paper_.background}
                      stroke={r.id === activeSection ? paper_.selected : paper_.outline}
                      ink={paper_.label}
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
              if (i.kind !== 'object' && i.sectionId && shapedIds.has(i.sectionId)) return null;
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
                  {/* Upright whatever the row's angle, beside its first seat; a row in a section is
                      named at both ends, outside the section's outline, as aisle signs are. */}
                  {(rowLabels.get(i.id) ?? [{ x: ROW_LABEL_X, y: 0 }]).map((at) => (
                    <Text
                      key={at.x}
                      text={bareItemLabel(i.label)}
                      x={at.x}
                      y={at.y}
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
                  ))}
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
      <div
        ref={controls}
        className="order-first self-end rounded-card border border-line bg-surface p-0.5 @lg:absolute @lg:end-2 @lg:top-2"
      >
        <div className="flex items-center gap-1 @lg:flex-col">
          <PanZoomControls view={view} compact onReset={() => onSection(null)} />
          {extraControl}
        </div>
      </div>
      {overview ? <p className="m-0 text-caption text-ink-2">{t('sectionHint')}</p> : null}
    </div>
  );
}

/**
 * Where a sectioned row's name goes, in the row's own coordinates: past its first and its last
 * seat (whatever order the seats are in), outside the section. An end that would land inside
 * another section (an aisle shared with the next block) is left out, so two names never meet.
 */
function rowEnds(
  row: { x: number; y: number; rotation: number; sectionId: string | null; seats: readonly { x: number; y: number }[] },
  regions: readonly SeatRegion[],
): { x: number; y: number }[] {
  const byX = [...row.seats].sort((a, b) => a.x - b.x);
  const first = byX[0];
  const last = byX.at(-1);
  if (!first || !last) return [];
  const a = (row.rotation * Math.PI) / 180;
  const inRoom = (p: { x: number; y: number }) => ({
    x: row.x + p.x * Math.cos(a) - p.y * Math.sin(a),
    y: row.y + p.x * Math.sin(a) + p.y * Math.cos(a),
  });
  const ends = [
    { x: first.x + SECTION_ROW_LABEL_X, y: first.y },
    { x: last.x - SECTION_ROW_LABEL_X, y: last.y },
  ];
  const kept = ends.filter((p) => {
    const other = regionAt(regions, inRoom(p));
    return !other || other.id === row.sectionId;
  });
  // A block with neighbours on both sides still names every row, beside its first seat.
  return kept.length ? kept : ends.slice(0, 1);
}

/** A text's width in px as the canvas draws it (Konva's default face), for any script. */
function textWidth(text: string, fontSize: number, fontStyle: 'bold' | 'normal'): number {
  return new Konva.Text({ text, fontSize, fontStyle }).width();
}

/** The area of a polygon (shoelace), in its own units squared. */
function polygonArea(points: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let k = 0; k < points.length; k += 1) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    if (a && b) sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * A section's name on a rounded tag, centred over `cx` and sitting just above `top` (room units),
 * never wider than the section (`maxWidth`): a longer name ends in an ellipsis.
 */
function SectionTag({
  name,
  cx,
  top,
  maxWidth,
  px,
  fill,
  stroke,
  ink,
}: {
  name: string;
  cx: number;
  top: number;
  maxWidth: number;
  px: (size: number) => number;
  fill: string;
  stroke: string;
  ink: string;
}) {
  // The name's own width on screen, in the face and size the tag draws it with (any script).
  const textPx = useMemo(() => textWidth(name, TAG_FONT_PX, 'bold'), [name]);
  const width = Math.min(px(textPx + TAG_PAD_PX * 2), maxWidth);
  const height = px(TAG_HEIGHT_PX);
  return (
    <Group x={cx - width / 2} y={top - height - px(TAG_GAP_PX)}>
      <Rect width={width} height={height} fill={fill} stroke={stroke} strokeWidth={px(1)} cornerRadius={height / 2} />
      <Text
        text={name}
        x={px(TAG_PAD_PX)}
        width={Math.max(0, width - px(TAG_PAD_PX * 2))}
        height={height}
        align="center"
        verticalAlign="middle"
        wrap="none"
        ellipsis
        fontSize={px(TAG_FONT_PX)}
        fontStyle="bold"
        fill={ink}
      />
    </Group>
  );
}
