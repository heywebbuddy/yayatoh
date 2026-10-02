import { type BadgeDesign, RIBBON_COLORS } from './design.ts';

/**
 * The ribbon a ticket type gets on this template: its label and token colours, or none. A ribbon
 * element on a badge whose type has no ribbon prints nothing (no empty coloured bar).
 */
export function ribbonFor(
  design: Pick<BadgeDesign, 'ribbons'>,
  ticketTypeId: string,
): { label: string; fill: string; text: string } | null {
  const r = design.ribbons[ticketTypeId];
  if (!r) return null;
  const c = RIBBON_COLORS[r.color];
  return { label: r.label, fill: c.fill, text: c.text };
}

/** Drop ribbons for ticket types that are no longer the event's (kept designs stay valid). */
export function pruneRibbons(
  ribbons: BadgeDesign['ribbons'],
  ticketTypeIds: ReadonlySet<string>,
): BadgeDesign['ribbons'] {
  return Object.fromEntries(Object.entries(ribbons).filter(([id]) => ticketTypeIds.has(id)));
}
