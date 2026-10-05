/**
 * Badge stock sizes (P5-2): 4×3 in fold-over, 4×6 in, CR80 card and the Brother QL label
 * presets (62 mm and 4 in). Every measure is in millimetres; a face is one printed side.
 *
 * - `bleedMm`: how far a full-bleed element (a ribbon) may extend past the trim edge. Direct
 *   thermal labels and card printers print edge to edge, so their bleed is 0.
 * - `safeMm`: text and codes keep this far inside the trim so a cutter or feed drift never clips
 *   them (the designer warns about anything outside it).
 * - Fold-over stock is one 4×6 sheet folded across the middle: the PDF page holds the front on
 *   the top half and the back, turned 180°, on the bottom half, so both read upright once folded.
 */
export const BADGE_SIZES = ['fold_4x3', 'label_4x6', 'cr80', 'brother_62', 'brother_4in'] as const;
export type BadgeSize = (typeof BADGE_SIZES)[number];

export interface SizeSpec {
  readonly key: BadgeSize;
  /** One face, trim size. */
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bleedMm: number;
  readonly safeMm: number;
  readonly foldOver: boolean;
}

const INCH = 25.4;

export const SIZES: Readonly<Record<BadgeSize, SizeSpec>> = {
  fold_4x3: {
    key: 'fold_4x3',
    widthMm: 101.6,
    heightMm: 76.2,
    bleedMm: 3.175,
    safeMm: 3.175,
    foldOver: true,
  },
  label_4x6: {
    key: 'label_4x6',
    widthMm: 101.6,
    heightMm: 152.4,
    bleedMm: 0,
    safeMm: 3.175,
    foldOver: false,
  },
  // ISO/IEC 7810 ID-1, portrait (the usual lanyard orientation).
  cr80: { key: 'cr80', widthMm: 53.98, heightMm: 85.6, bleedMm: 0, safeMm: 3, foldOver: false },
  // Brother DK 62 mm continuous tape, cut at 100 mm.
  brother_62: { key: 'brother_62', widthMm: 62, heightMm: 100, bleedMm: 0, safeMm: 1.5, foldOver: false },
  // Brother DK 102 × 152 mm (4 in) die-cut shipping labels.
  brother_4in: { key: 'brother_4in', widthMm: 102, heightMm: 152, bleedMm: 0, safeMm: 1.5, foldOver: false },
};

export const isBadgeSize = (v: string): v is BadgeSize => (BADGE_SIZES as readonly string[]).includes(v);

/** The PDF page for one badge: a fold-over sheet holds both faces stacked. */
export function pageSizeMm(size: BadgeSize): { widthMm: number; heightMm: number } {
  const s = SIZES[size];
  return { widthMm: s.widthMm, heightMm: s.foldOver ? s.heightMm * 2 : s.heightMm };
}

/** Faces a size prints: fold-over badges have a back. */
export const facesOf = (size: BadgeSize): readonly ('front' | 'back')[] =>
  SIZES[size].foldOver ? ['front', 'back'] : ['front'];

/** Points per millimetre (1 pt = 1/72 in). */
export const PT_PER_MM = 72 / INCH;
export const mmToPt = (mm: number) => mm * PT_PER_MM;
export const ptToMm = (pt: number) => pt / PT_PER_MM;
