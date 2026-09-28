'use client';

import type Konva from 'konva';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Shape } from 'react-konva';

export interface Dot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface DotStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
}

/** The largest cached bitmap side and area (browsers cap canvases; memory matters on tablets). */
const MAX_CACHE_SIDE = 4096;
const MAX_CACHE_AREA = 16_000_000;

/**
 * The pixel ratio to cache a shape of this size at (room centimetres × stage scale × device
 * pixels), or null when that bitmap would be too large — then the shape draws live, culled to
 * what is on screen (at that zoom only a few seats are).
 */
export function cacheRatio(
  size: { width: number; height: number },
  scale: number,
  dpr: number,
): number | null {
  const ratio = scale * dpr;
  const w = size.width * ratio;
  const h = size.height * ratio;
  return w <= MAX_CACHE_SIDE && h <= MAX_CACHE_SIDE && w * h <= MAX_CACHE_AREA ? ratio : null;
}

/**
 * Many seats as one Konva shape (M1.7f performance, 5,000-seat plans):
 * - batch draw: seats of the same look are one path, so a plan is a handful of fill/stroke calls
 *   instead of thousands of nodes;
 * - layer caching: while the whole shape fits a bitmap at the current zoom it is drawn once into
 *   a cache, and panning only moves that bitmap; it is redrawn when seats change or the zoom does;
 * - culling: zoomed in further, it draws live but only the seats on screen;
 * - listening off: seats are hit-tested in room coordinates by the page (`hitTest`), never by
 *   Konva, so there is no hit graph to redraw.
 */
export function SeatDots<T extends Dot>({
  dots,
  radius,
  styleOf,
  version,
  scale,
}: {
  dots: readonly T[];
  radius: number;
  styleOf: (dot: T) => DotStyle;
  /** Changes whenever `styleOf` would answer differently (redraw, re-cache). */
  version: string;
  /** The stage's scale (room centimetres → CSS pixels): the cache follows the zoom. */
  scale: number;
}) {
  const node = useRef<Konva.Shape>(null);
  const styleRef = useRef(styleOf);
  styleRef.current = styleOf;
  const bounds = useMemo(() => {
    if (dots.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const d of dots) {
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x);
      maxY = Math.max(maxY, d.y);
    }
    const pad = radius + 8;
    return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
  }, [dots, radius]);

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const cachePixelRatio = bounds ? cacheRatio(bounds, scale, dpr) : null;
  useLayoutEffect(() => {
    const shape = node.current;
    if (!shape) return;
    shape.clearCache();
    if (cachePixelRatio && bounds) shape.cache({ ...bounds, pixelRatio: cachePixelRatio });
    shape.getLayer()?.batchDraw();
  }, [version, cachePixelRatio, bounds]);

  return (
    <Shape
      ref={node}
      listening={false}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
      sceneFunc={(context: Konva.Context, shape: Konva.Shape) => {
        const ctx = (context as unknown as { _context: CanvasRenderingContext2D })._context;
        // Drawing live (not into the cache): only what is on screen.
        let visible: ((d: T) => boolean) | null = null;
        const stage = shape.getStage();
        const layerCanvas = shape.getLayer()?.getCanvas();
        if (stage && layerCanvas && context.getCanvas() === layerCanvas) {
          const inv = shape.getAbsoluteTransform().copy().invert();
          const corners = [
            inv.point({ x: 0, y: 0 }),
            inv.point({ x: stage.width(), y: 0 }),
            inv.point({ x: 0, y: stage.height() }),
            inv.point({ x: stage.width(), y: stage.height() }),
          ];
          const pad = radius + 8;
          const x0 = Math.min(...corners.map((c) => c.x)) - pad;
          const x1 = Math.max(...corners.map((c) => c.x)) + pad;
          const y0 = Math.min(...corners.map((c) => c.y)) - pad;
          const y1 = Math.max(...corners.map((c) => c.y)) + pad;
          visible = (d) => d.x >= x0 && d.x <= x1 && d.y >= y0 && d.y <= y1;
        }
        const groups = new Map<string, { style: DotStyle; dots: T[] }>();
        for (const d of dots) {
          if (visible && !visible(d)) continue;
          const style = styleRef.current(d);
          const key = `${style.fill}|${style.stroke}|${style.strokeWidth}`;
          let g = groups.get(key);
          if (!g) {
            g = { style, dots: [] };
            groups.set(key, g);
          }
          g.dots.push(d);
        }
        for (const { style, dots: ds } of groups.values()) {
          ctx.beginPath();
          for (const d of ds) {
            ctx.moveTo(d.x + radius, d.y);
            ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
          }
          ctx.fillStyle = style.fill;
          ctx.fill();
          if (style.strokeWidth > 0) {
            ctx.lineWidth = style.strokeWidth;
            ctx.strokeStyle = style.stroke;
            ctx.stroke();
          }
        }
      }}
    />
  );
}
