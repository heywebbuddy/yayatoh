import { print } from '@yayatoh/ui/tokens';
import { z } from 'zod';
import { BADGE_SIZES, type BadgeSize, SIZES } from './sizes.ts';

/**
 * What a badge template draws (one immutable version per save). Positions are in millimetres
 * from the face's top-left corner in **logical** (left-to-right) coordinates; an RTL badge
 * mirrors them (`layout.ts`), so one design serves English and Arabic.
 */
export const ELEMENT_KINDS = [
  'first_name',
  'last_name',
  'company',
  'job_title',
  'type_label',
  'qr',
  'ribbon',
  'logo',
  'text',
] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** Kinds that print a person's data (the render serializer fills only these, and only if placed). */
export const PERSON_KINDS = ['first_name', 'last_name', 'company', 'job_title'] as const;
/** Kinds with text (font size, fit-to-width, alignment apply). */
export const TEXT_KINDS: readonly ElementKind[] = [
  'first_name',
  'last_name',
  'company',
  'job_title',
  'type_label',
  'ribbon',
  'text',
];

/**
 * Ribbon colours: the print tokens of ADR 0022 (badges are always on white stock), each with the
 * text colour that reads on it at ≥ 4.5:1 (checked in tests/domain.test.ts).
 */
export const RIBBON_COLORS = print.ribbon;
export type RibbonColor = keyof typeof RIBBON_COLORS;
export const RIBBON_COLOR_KEYS = Object.keys(RIBBON_COLORS) as RibbonColor[];

export const MIN_FONT_PT = 6;
export const MAX_FONT_PT = 96;
export const MAX_ELEMENTS_PER_FACE = 20;
export const MAX_RIBBONS = 50;

const mm = z
  .number()
  .finite()
  .min(-10)
  .max(310)
  .transform((v) => Math.round(v * 10) / 10);

export const BadgeElement = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,24}$/),
  kind: z.enum(ELEMENT_KINDS),
  x: mm,
  y: mm,
  w: z
    .number()
    .finite()
    .min(2)
    .max(310)
    .transform((v) => Math.round(v * 10) / 10),
  h: z
    .number()
    .finite()
    .min(2)
    .max(310)
    .transform((v) => Math.round(v * 10) / 10),
  fontSizePt: z.number().finite().min(MIN_FONT_PT).max(MAX_FONT_PT).default(12),
  /** Shrink the text until it fits the element's width (never below MIN_FONT_PT). */
  fit: z.boolean().default(true),
  align: z.enum(['start', 'center', 'end']).default('center'),
  bold: z.boolean().default(false),
  /** Free text (kind `text` only). */
  text: z.string().trim().max(120).default(''),
});
export type BadgeElement = z.infer<typeof BadgeElement>;
export type BadgeElementInput = z.input<typeof BadgeElement>;

export const Ribbon = z.object({
  label: z.string().trim().min(1).max(40),
  color: z.enum(RIBBON_COLOR_KEYS as [RibbonColor, ...RibbonColor[]]),
});
export type Ribbon = z.infer<typeof Ribbon>;

/** Checkout question keys the organizer explicitly allows onto badges (non-sensitive text only). */
export const QuestionKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .nullable()
  .default(null);

export const BadgeDesign = z
  .object({
    size: z.enum(BADGE_SIZES),
    direction: z.enum(['ltr', 'rtl']).default('ltr'),
    front: z.array(BadgeElement).max(MAX_ELEMENTS_PER_FACE),
    back: z.array(BadgeElement).max(MAX_ELEMENTS_PER_FACE).default([]),
    /** Ticket type id → ribbon (label and token colour). */
    ribbons: z
      .record(z.uuid(), Ribbon)
      .default({})
      .refine((r) => Object.keys(r).length <= MAX_RIBBONS, 'too many ribbons'),
    sources: z
      .object({ company: QuestionKey, jobTitle: QuestionKey })
      .default({ company: null, jobTitle: null }),
  })
  .superRefine((d, ctx) => {
    if (!SIZES[d.size].foldOver && d.back.length > 0)
      ctx.addIssue({ code: 'custom', path: ['back'], message: 'Only fold-over badges have a back' });
    const ids = [...d.front, ...d.back].map((e) => e.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: ['front'], message: 'Element ids must be unique' });
  });
export type BadgeDesign = z.infer<typeof BadgeDesign>;
export type BadgeDesignInput = z.input<typeof BadgeDesign>;

/**
 * A sensible starting layout per size: first name large, last name, job title and company, the
 * pass type, the QR (the ticket's signed code) and the ribbon along the bottom edge. Fold-over
 * backs repeat the name and QR, so a flipped badge still scans and reads.
 */
export function defaultDesign(size: BadgeSize): BadgeDesign {
  const s = SIZES[size];
  const w = s.widthMm;
  const h = s.heightMm;
  const m = Math.ceil(Math.max(s.safeMm, 3) + 0.5);
  const inner = Math.floor((w - 2 * m) * 10) / 10;
  const small = w < 70;
  const qr = Math.min(small ? 26 : 30, h * 0.36);
  const ribbonH = Math.max(7, h * 0.1);
  const el = (e: BadgeElementInput) => BadgeElement.parse(e);
  const front: BadgeElement[] = [
    el({
      id: 'first',
      kind: 'first_name',
      x: m,
      y: m + 2,
      w: inner,
      h: h * 0.16,
      fontSizePt: small ? 22 : 30,
      bold: true,
    }),
    el({
      id: 'last',
      kind: 'last_name',
      x: m,
      y: m + 2 + h * 0.16,
      w: inner,
      h: h * 0.1,
      fontSizePt: small ? 14 : 18,
    }),
    el({
      id: 'title',
      kind: 'job_title',
      x: m,
      y: m + 2 + h * 0.27,
      w: inner,
      h: h * 0.07,
      fontSizePt: small ? 8 : 10,
    }),
    el({
      id: 'company',
      kind: 'company',
      x: m,
      y: m + 2 + h * 0.34,
      w: inner,
      h: h * 0.08,
      fontSizePt: small ? 9 : 12,
      bold: true,
    }),
    el({ id: 'qr', kind: 'qr', x: (w - qr) / 2, y: h - ribbonH - qr - 2, w: qr, h: qr }),
    el({
      id: 'ribbon',
      kind: 'ribbon',
      x: -s.bleedMm,
      y: h - ribbonH,
      w: w + 2 * s.bleedMm,
      h: ribbonH + s.bleedMm,
      fontSizePt: small ? 9 : 12,
      bold: true,
    }),
  ];
  const back: BadgeElement[] = s.foldOver
    ? [
        el({
          id: 'back-first',
          kind: 'first_name',
          x: m,
          y: m + 2,
          w: inner * 0.6,
          h: h * 0.18,
          fontSizePt: 24,
          bold: true,
          align: 'start',
        }),
        el({
          id: 'back-last',
          kind: 'last_name',
          x: m,
          y: m + 2 + h * 0.18,
          w: inner * 0.6,
          h: h * 0.12,
          fontSizePt: 14,
          align: 'start',
        }),
        el({ id: 'back-qr', kind: 'qr', x: w - m - qr, y: m + 2, w: qr, h: qr }),
        el({
          id: 'back-type',
          kind: 'type_label',
          x: m,
          y: h - m - 10,
          w: inner,
          h: 8,
          fontSizePt: 10,
          align: 'start',
        }),
      ]
    : [];
  return BadgeDesign.parse({ size, direction: 'ltr', front, back, ribbons: {} });
}
