import type { BadgeDesign, BadgeElement } from './design.ts';
import { faceOrigin, placeElement } from './layout.ts';
import { ribbonFor } from './ribbons.ts';
import type { BadgeRow } from './row.ts';
import { SIZES } from './sizes.ts';
import { fitFontSize } from './text.ts';

/** One element as it prints: physical box, resolved text and size (shared by preview and PDF). */
export interface ResolvedElement {
  readonly id: string;
  readonly kind: BadgeElement['kind'];
  readonly face: 'front' | 'back';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly text: string;
  readonly fontPt: number;
  readonly clipped: boolean;
  /** Physical alignment (logical start/end resolved against the badge direction). */
  readonly align: 'left' | 'center' | 'right';
  readonly bold: boolean;
  readonly fill: string | null;
  readonly color: string | null;
  /** Ribbons with no ribbon for this ticket type, and empty fields, print nothing. */
  readonly empty: boolean;
}

export function elementText(el: BadgeElement, row: BadgeRow, design: BadgeDesign): string {
  switch (el.kind) {
    case 'first_name':
      return row.firstName;
    case 'last_name':
      return row.lastName;
    case 'company':
      return row.company;
    case 'job_title':
      return row.jobTitle;
    case 'type_label':
      return row.typeLabel;
    case 'text':
      return el.text;
    case 'ribbon':
      return ribbonFor(design, row.ticketTypeId)?.label ?? '';
    default:
      return '';
  }
}

export function resolveBadge(design: BadgeDesign, row: BadgeRow, hasLogo: boolean): ResolvedElement[] {
  const dir = design.direction;
  const physical = (a: BadgeElement['align']): ResolvedElement['align'] =>
    a === 'center' ? 'center' : (a === 'start') === (dir === 'ltr') ? 'left' : 'right';
  const out: ResolvedElement[] = [];
  for (const face of ['front', 'back'] as const) {
    if (face === 'back' && !SIZES[design.size].foldOver) continue;
    for (const el of design[face]) {
      const box = placeElement(el, design.size, dir);
      const text = elementText(el, row, design);
      const ribbon = el.kind === 'ribbon' ? ribbonFor(design, row.ticketTypeId) : null;
      const fit =
        el.fit && text
          ? fitFontSize(text, { widthMm: box.w - 1, heightMm: box.h }, el.fontSizePt, el.bold)
          : null;
      const empty =
        el.kind === 'qr' ? !row.code : el.kind === 'logo' ? !hasLogo : el.kind === 'ribbon' ? !ribbon : !text;
      out.push({
        id: el.id,
        kind: el.kind,
        face,
        ...box,
        text,
        fontPt: fit?.pt ?? el.fontSizePt,
        clipped: fit?.clipped ?? false,
        align: physical(el.align),
        bold: el.bold,
        fill: ribbon?.fill ?? null,
        color: ribbon?.text ?? null,
        empty,
      });
    }
  }
  return out;
}

export { faceOrigin };
