'use client';

import { Button } from '@yayatoh/ui';
import type Konva from 'konva';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

const MAX_ZOOM = 12;
const STEP = 1.6;

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
  readonly zoomBy: (factor: number, at?: { x: number; y: number }) => void;
  readonly reset: () => void;
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
): PanZoom {
  const fit = Math.min(width / room.width, maxHeight / room.height);
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
        const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor));
        if (zoom === 1) return { zoom, ...center(1) };
        const p = at ?? { x: width / 2, y: height / 2 };
        const k = zoom / v.zoom;
        return { zoom, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k };
      }),
    [center, width, height],
  );
  const reset = useCallback(() => setView({ zoom: 1, ...center(1) }), [center]);
  return {
    scale: fit * view.zoom,
    x: view.x,
    y: view.y,
    zoom: view.zoom,
    height,
    zoomBy,
    reset,
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
export function PanZoomControls({ view }: { view: PanZoom }) {
  const t = useTranslations('seating.map');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => view.zoomBy(STEP)}
        disabled={view.zoom >= MAX_ZOOM}
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
