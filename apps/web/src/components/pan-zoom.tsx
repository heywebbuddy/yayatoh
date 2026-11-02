'use client';

import { Button } from '@yayatoh/ui';
import type Konva from 'konva';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

const MAX_ZOOM = 12;
const STEP = 1.6;
const GLIDE_MS = 260;
/** How much of the box a focused area fills. */
const FOCUS_MARGIN = 0.9;

/** The width of a box, followed as it resizes. */
export function useBoxWidth(fallback: number, min: number): [RefObject<HTMLDivElement | null>, number] {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.max(min, Math.floor(e?.contentRect.width ?? fallback))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback, min]);
  return [box, width];
}

export interface PanZoom {
  /** Stage scale (room centimetres → pixels) and position. */
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly height: number;
  readonly maxZoom: number;
  readonly zoomBy: (factor: number, at?: { x: number; y: number }) => void;
  readonly reset: () => void;
  /** Glide to a part of the room, at `minScale` or closer. */
  readonly focus: (rect: { x: number; y: number; width: number; height: number }, minScale?: number) => void;
  /** Glide back to the whole room. */
  readonly glideHome: () => void;
  /** Stage props: dragging pans once zoomed in; Ctrl/⌘ + wheel (and trackpad pinch) zooms. */
  readonly stageProps: {
    readonly draggable: boolean;
    readonly onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
    readonly onWheel: (e: Konva.KonvaEventObject<WheelEvent>) => void;
  };
}

/**
 * Zoom and pan for a plan drawn in centimetres (M1.7f: large rooms need it). At zoom 1 the whole
 * room fits the box (height capped); zooming keeps the point under the pointer (or the centre)
 * still. Buttons do the same as the wheel, so no gesture is required.
 */
export function usePanZoom(
  room: { width: number; height: number },
  width: number,
  maxHeight: number,
  /** The closest view must reach at least this scale (a huge room still gets to its seats). */
  closestScale = 0,
): PanZoom {
  const fit = Math.min(width / room.width, maxHeight / room.height);
  const maxZoom = Math.max(MAX_ZOOM, closestScale / fit);
  const height = Math.max(160, Math.round(room.height * fit));
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const center = useCallback(
    (zoom: number) => ({
      x: (width - room.width * fit * zoom) / 2,
      y: (height - room.height * fit * zoom) / 2,
    }),
    [width, height, room.width, room.height, fit],
  );
  // A resized box, or another room: start from the whole room again.
  useEffect(() => setView({ zoom: 1, ...center(1) }), [width, room.width, room.height]);
  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) =>
      setView((v) => {
        const zoom = Math.min(maxZoom, Math.max(1, v.zoom * factor));
        if (zoom === 1) return { zoom, ...center(1) };
        const p = at ?? { x: width / 2, y: height / 2 };
        const k = zoom / v.zoom;
        return { zoom, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k };
      }),
    [center, width, height, maxZoom],
  );
  const reset = useCallback(() => setView({ zoom: 1, ...center(1) }), [center]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const glide = useCallback((to: { zoom: number; x: number; y: number }) => {
    cancelAnimationFrame(frame.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setView(to);
    const from = viewRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const k = 1 - (1 - t) ** 3;
      setView({
        zoom: from.zoom + (to.zoom - from.zoom) * k,
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
      });
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, []);
  const focus = useCallback<PanZoom['focus']>(
    (rect, minScale = 0) => {
      const inView = Math.min(width / (rect.width * fit), height / (rect.height * fit)) * FOCUS_MARGIN;
      const zoom = Math.min(maxZoom, Math.max(1, inView, minScale / fit));
      const scale = fit * zoom;
      glide({
        zoom,
        x: width / 2 - (rect.x + rect.width / 2) * scale,
        y: height / 2 - (rect.y + rect.height / 2) * scale,
      });
    },
    [fit, width, height, maxZoom, glide],
  );
  const glideHome = useCallback(() => glide({ zoom: 1, ...center(1) }), [glide, center]);
  return {
    scale: fit * view.zoom,
    x: view.x,
    y: view.y,
    zoom: view.zoom,
    height,
    maxZoom,
    zoomBy,
    reset,
    focus,
    glideHome,
    stageProps: {
      draggable: view.zoom > 1,
      onDragEnd: (e) => {
        const stage = e.target.getStage();
        if (e.target !== stage || !stage) return;
        setView((v) => ({ ...v, x: stage.x(), y: stage.y() }));
      },
      onWheel: (e) => {
        if (!(e.evt.ctrlKey || e.evt.metaKey)) return;
        e.evt.preventDefault();
        const p = e.target.getStage()?.getPointerPosition() ?? undefined;
        zoomBy(e.evt.deltaY < 0 ? 1.15 : 1 / 1.15, p);
      },
    },
  };
}

/** Zoom in / out / whole room, for pointer and touch users of a drawn plan. */
export function PanZoomControls({
  view,
  compact = false,
  onReset,
}: {
  view: PanZoom;
  /** Icon buttons: a row, or a column to float over the map where the container has room. */
  compact?: boolean;
  /** Called after "Whole room" (the buyer's map also leaves the section it was showing). */
  onReset?: () => void;
}) {
  const t = useTranslations('seating.map');
  if (compact) {
    const controls = [
      { key: 'zoomIn', Icon: Plus, run: () => view.zoomBy(STEP), off: view.zoom >= view.maxZoom },
      { key: 'zoomOut', Icon: Minus, run: () => view.zoomBy(1 / STEP), off: view.zoom <= 1 },
      {
        key: 'wholeRoom',
        Icon: Maximize,
        run: () => {
          view.reset();
          onReset?.();
        },
        off: view.zoom <= 1,
      },
    ] as const;
    return (
      <div className="flex gap-1 @lg:flex-col">
        {controls.map(({ key, Icon, run, off }) => (
          <Button key={key} type="button" size="sm" variant="secondary" onClick={run} disabled={off}>
            <Icon aria-hidden="true" className="size-4" />
            <span className="sr-only">{t(key)}</span>
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => view.zoomBy(STEP)}
        disabled={view.zoom >= view.maxZoom}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t('zoomIn')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => view.zoomBy(1 / STEP)}
        disabled={view.zoom <= 1}
      >
        <Minus aria-hidden="true" className="size-4" />
        {t('zoomOut')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={view.reset} disabled={view.zoom <= 1}>
        <Maximize aria-hidden="true" className="size-4" />
        {t('wholeRoom')}
      </Button>
    </div>
  );
}

/** Room coordinates (centimetres) of the pointer on a stage. */
export function roomPoint(stage: Konva.Stage | null): { x: number; y: number } | null {
  const p = stage?.getPointerPosition();
  if (!stage || !p) return null;
  return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
}
