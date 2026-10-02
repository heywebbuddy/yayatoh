import type { BadgeDesign, BadgeElement } from './design.ts';
import { type BadgeSize, SIZES } from './sizes.ts';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const round = (v: number) => Math.round(v * 10) / 10 || 0;

/**
 * Where an element prints on its face, in physical millimetres. RTL badges mirror the logical
 * position across the face's vertical axis (x' = width − x − w), so "start" stays on the reading
 * side; text alignment is logical and follows `dir` on its own.
 */
export function placeElement(el: Box, size: BadgeSize, dir: 'ltr' | 'rtl'): Box {
  const faceW = SIZES[size].widthMm;
  return dir === 'rtl' ? { x: round(faceW - el.x - el.w), y: el.y, w: el.w, h: el.h } : { ...pick(el) };
}

const pick = (b: Box): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h });

/**
 * Where a face sits on the PDF page: the front at the top; a fold-over back on the bottom half,
 * turned 180° (it is folded behind the front across the page's middle).
 */
export function faceOrigin(size: BadgeSize, face: 'front' | 'back'): { y: number; rotate: 0 | 180 } {
  return face === 'back' ? { y: SIZES[size].heightMm, rotate: 180 } : { y: 0, rotate: 0 };
}

/** The range an element's edges may take: the trim plus the size's bleed. */
function bounds(size: BadgeSize) {
  const s = SIZES[size];
  return { min: -s.bleedMm, maxX: s.widthMm + s.bleedMm, maxY: s.heightMm + s.bleedMm };
}

/** Keep a box inside trim + bleed (a move never loses an element off the badge). */
export function clampBox(b: Box, size: BadgeSize): Box {
  const { min, maxX, maxY } = bounds(size);
  const w = Math.min(Math.max(b.w, 2), maxX - min);
  const h = Math.min(Math.max(b.h, 2), maxY - min);
  return {
    x: round(Math.min(Math.max(b.x, min), maxX - w)),
    y: round(Math.min(Math.max(b.y, min), maxY - h)),
    w: round(w),
    h: round(h),
  };
}

/** Keyboard move (arrow keys): by `dx`/`dy` mm, clamped. */
export const moveBox = (b: Box, dx: number, dy: number, size: BadgeSize): Box =>
  clampBox({ ...b, x: b.x + dx, y: b.y + dy }, size);

/** Keyboard resize (Alt/Option + arrows): the top-left corner stays put. */
export const resizeBox = (b: Box, dw: number, dh: number, size: BadgeSize): Box =>
  clampBox({ ...b, w: b.w + dw, h: b.h + dh }, size);

/** Elements whose content could be clipped: outside the safe area (ribbons may bleed). */
export function outsideSafeArea(el: BadgeElement, size: BadgeSize): boolean {
  if (el.kind === 'ribbon') return false;
  const s = SIZES[size];
  const eps = 0.05;
  return (
    el.x < s.safeMm - eps ||
    el.y < s.safeMm - eps ||
    el.x + el.w > s.widthMm - s.safeMm + eps ||
    el.y + el.h > s.heightMm - s.safeMm + eps
  );
}

/** Ids of every element the designer should warn about. */
export function layoutWarnings(design: BadgeDesign): string[] {
  return [...design.front, ...design.back].filter((e) => outsideSafeArea(e, design.size)).map((e) => e.id);
}

/**
 * Re-fit a design to another size: every box scales with the face (so switching 4×6 → CR80 keeps
 * the arrangement), fonts scale with the smaller ratio, and a back is dropped when the new size has
 * none.
 */
export function rescaleDesign(design: BadgeDesign, to: BadgeSize): BadgeDesign {
  const from = SIZES[design.size];
  const next = SIZES[to];
  const sx = next.widthMm / from.widthMm;
  const sy = next.heightMm / from.heightMm;
  const sf = Math.min(sx, sy);
  const scale = (e: BadgeElement): BadgeElement => {
    const b = clampBox({ x: e.x * sx, y: e.y * sy, w: e.w * sx, h: e.h * sy }, to);
    return { ...e, ...b, fontSizePt: Math.max(6, Math.min(96, Math.round(e.fontSizePt * sf * 2) / 2)) };
  };
  return {
    ...design,
    size: to,
    front: design.front.map(scale),
    back: next.foldOver ? design.back.map(scale) : [],
  };
}
