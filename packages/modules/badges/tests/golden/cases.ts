import { BadgeDesign, badgesHtml, defaultDesign, sampleRows } from '../../src/index.ts';

const T_SPEAKER = '00000000-0000-7000-8000-00000000a001';
const T_GA = '00000000-0000-7000-8000-00000000a002';

/**
 * The three golden templates (M5.5a): a 4×3 fold-over with a front, a turned back and ribbons; a
 * CR80 card with start-aligned text and a free-text line; a Brother 62 mm label (names and QR).
 * Each is printed in English and in Arabic (RTL, mirrored, sample Arabic names).
 */
export const GOLDEN_TEMPLATES: Record<string, BadgeDesign> = {
  'fold-4x3': BadgeDesign.parse({
    ...defaultDesign('fold_4x3'),
    ribbons: {
      [T_SPEAKER]: { label: 'SPEAKER', color: 'orange' },
      [T_GA]: { label: 'ATTENDEE', color: 'green' },
    },
  }),
  'cr80-staff': BadgeDesign.parse({
    size: 'cr80',
    front: [
      {
        id: 'first',
        kind: 'first_name',
        x: 4,
        y: 6,
        w: 40,
        h: 10,
        fontSizePt: 20,
        bold: true,
        align: 'start',
      },
      { id: 'last', kind: 'last_name', x: 4, y: 16, w: 46, h: 7, fontSizePt: 12, align: 'start' },
      { id: 'title', kind: 'job_title', x: 4, y: 24, w: 46, h: 5, fontSizePt: 8, align: 'start' },
      { id: 'company', kind: 'company', x: 4, y: 29, w: 46, h: 5, fontSizePt: 8, align: 'start' },
      { id: 'qr', kind: 'qr', x: 12, y: 38, w: 30, h: 30 },
      { id: 'note', kind: 'text', x: 4, y: 70, w: 46, h: 5, fontSizePt: 7, text: 'Staff · All areas' },
      { id: 'ribbon', kind: 'ribbon', x: 0, y: 77, w: 53.98, h: 8.6, fontSizePt: 9, bold: true },
    ],
    ribbons: { [T_SPEAKER]: { label: 'CREW', color: 'ink' } },
  }),
  'brother-62': BadgeDesign.parse({
    size: 'brother_62',
    front: [
      { id: 'first', kind: 'first_name', x: 3, y: 4, w: 56, h: 14, fontSizePt: 26, bold: true },
      { id: 'last', kind: 'last_name', x: 3, y: 18, w: 56, h: 9, fontSizePt: 14 },
      { id: 'company', kind: 'company', x: 3, y: 28, w: 56, h: 7, fontSizePt: 10 },
      { id: 'qr', kind: 'qr', x: 14, y: 40, w: 34, h: 34 },
      { id: 'type', kind: 'type_label', x: 3, y: 80, w: 56, h: 8, fontSizePt: 10 },
    ],
  }),
};

export const LANGS = ['en', 'ar'] as const;

/** The golden HTML of one template in one language (sample people, no logo). */
export function goldenHtml(name: string, lang: (typeof LANGS)[number]): string {
  const base = GOLDEN_TEMPLATES[name];
  if (!base) throw new Error(name);
  const design = lang === 'ar' ? { ...base, direction: 'rtl' as const } : base;
  return badgesHtml({
    lang,
    title: `Golden ${name}`,
    logo: null,
    badges: sampleRows(design, lang).map((row) => ({
      design,
      row,
      qrLabel: `${row.firstName} ${row.lastName}`.trim(),
    })),
  });
}
