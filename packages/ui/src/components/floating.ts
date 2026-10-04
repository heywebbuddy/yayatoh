'use client';

import { type RefObject, useEffect, useLayoutEffect } from 'react';

const GAP = 4;
const MARGIN = 8;

/**
 * Pins an open panel under (or above, when there is no room) its anchor. The panel is a manual
 * `popover`, so it renders in the top layer: never clipped by a card's `overflow: hidden` or a
 * scrolling table, never under a sticky header, and it still inherits the theme from where it sits
 * in the DOM. Coordinates are set through the CSSOM (the strict CSP forbids style attributes, not
 * CSSOM writes). In RTL the panel lines up with the anchor's right edge.
 */
export function useFloatingPanel(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  { matchWidth = true, maxWidth = 384 }: { matchWidth?: boolean; maxWidth?: number } = {},
): void {
  useLayoutEffect(() => {
    const p = panel.current;
    const a = anchor.current;
    if (!open || !p || !a) return;
    const top = p as HTMLElement & { showPopover?: () => void; hidePopover?: () => void };
    try {
      if (top.showPopover && !p.matches(':popover-open')) top.showPopover();
    } catch {
      // no popover support: the panel stays absolutely positioned under its anchor
    }
    const inTopLayer = (() => {
      try {
        return p.matches(':popover-open');
      } catch {
        return false;
      }
    })();
    const place = () => {
      if (!inTopLayer) return;
      const r = a.getBoundingClientRect();
      p.style.position = 'fixed';
      p.style.margin = '0';
      p.style.right = 'auto';
      p.style.bottom = 'auto';
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const room = vw - MARGIN * 2;
      p.style.minWidth = `${matchWidth ? Math.min(room, r.width) : 0}px`;
      p.style.maxWidth = `${Math.min(room, Math.max(r.width, maxWidth))}px`;
      const below = vh - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      const natural = p.scrollHeight;
      const up = natural > below && above > below;
      p.style.maxHeight = `${Math.max(160, Math.min(up ? above : below, 420))}px`;
      const h = p.getBoundingClientRect().height;
      p.style.top = `${up ? Math.max(MARGIN, r.top - GAP - h) : r.bottom + GAP}px`;
      const w = p.getBoundingClientRect().width;
      const rtl = getComputedStyle(a).direction === 'rtl';
      let left = rtl ? r.right - w : r.left;
      left = Math.max(MARGIN, Math.min(left, vw - MARGIN - w));
      p.style.left = `${left}px`;
    };
    place();
    // Inside a wrapping <label>, a click in the panel must not reach the label: its activation
    // would click the trigger again and reopen the list.
    const keepFromLabel = (e: MouseEvent) => e.preventDefault();
    p.addEventListener('click', keepFromLabel);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(p);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      p.removeEventListener('click', keepFromLabel);
      ro?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      try {
        if (p.matches(':popover-open')) top.hidePopover?.();
      } catch {
        // already gone
      }
    };
  }, [open, anchor, panel, matchWidth, maxWidth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, anchor, panel, onDismiss]);
}

/** The floating panel's frame: our theme, never the OS popup. */
export const PANEL_SHELL =
  'm-0 inset-auto absolute top-full start-0 z-50 mt-1 max-h-80 rounded-tile border border-line bg-surface-solid p-1.5 text-ink elevation-pop';
/** A list panel: the list scrolls inside, a search box stays on top. */
export const PANEL_CLASS = `${PANEL_SHELL} flex flex-col overflow-hidden`;
