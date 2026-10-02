import { describe, expect, it } from 'vitest';
import {
  BADGE_SIZES,
  BadgeDesign,
  badgeRow,
  clampBox,
  defaultDesign,
  faceOrigin,
  fitFontSize,
  layoutWarnings,
  MIN_FONT_PT,
  moveBox,
  outsideSafeArea,
  pageSizeMm,
  placeElement,
  pruneRibbons,
  RIBBON_COLORS,
  rescaleDesign,
  resizeBox,
  resolveBadge,
  ribbonFor,
  SIZES,
  sortBadges,
  splitName,
  surnameSortKey,
  textWidthMm,
} from '../src/client.ts';

const T1 = '00000000-0000-7000-8000-000000000001';
const T2 = '00000000-0000-7000-8000-000000000002';

describe('sizes and layout maths', () => {
  it('has the P5-2 presets at their physical sizes', () => {
    expect(SIZES.fold_4x3).toMatchObject({ widthMm: 101.6, heightMm: 76.2, foldOver: true });
    expect(SIZES.label_4x6).toMatchObject({ widthMm: 101.6, heightMm: 152.4, foldOver: false });
    expect(SIZES.cr80).toMatchObject({ widthMm: 53.98, heightMm: 85.6 });
    expect(SIZES.brother_62.widthMm).toBe(62);
    expect(SIZES.brother_4in.widthMm).toBe(102);
    // Fold-over prints front and back on one 4×6 sheet.
    expect(pageSizeMm('fold_4x3')).toEqual({ widthMm: 101.6, heightMm: 152.4 });
    expect(pageSizeMm('cr80')).toEqual({ widthMm: 53.98, heightMm: 85.6 });
  });

  it('bleed only where the stock allows it, and a safe area inside every trim', () => {
    for (const k of BADGE_SIZES) {
      const s = SIZES[k];
      expect(s.safeMm).toBeGreaterThan(0);
      expect(s.safeMm * 2).toBeLessThan(s.widthMm);
    }
    expect(SIZES.fold_4x3.bleedMm).toBeCloseTo(3.175);
    expect(SIZES.brother_62.bleedMm).toBe(0);
  });

  it('mirrors positions for RTL badges and keeps LTR as designed', () => {
    const box = { x: 10, y: 5, w: 30, h: 8 };
    expect(placeElement(box, 'label_4x6', 'ltr')).toEqual(box);
    expect(placeElement(box, 'label_4x6', 'rtl')).toEqual({ x: 61.6, y: 5, w: 30, h: 8 });
    // A centred element stays centred.
    const c = { x: (101.6 - 40) / 2, y: 0, w: 40, h: 5 };
    expect(placeElement(c, 'label_4x6', 'rtl').x).toBeCloseTo(c.x, 1);
  });

  it('puts a fold-over back on the lower half, turned 180°', () => {
    expect(faceOrigin('fold_4x3', 'front')).toEqual({ y: 0, rotate: 0 });
    expect(faceOrigin('fold_4x3', 'back')).toEqual({ y: 76.2, rotate: 180 });
  });

  it('keyboard moves and resizes stay within trim + bleed', () => {
    const b = { x: 2, y: 2, w: 20, h: 10 };
    expect(moveBox(b, -1, 0, 'label_4x6')).toEqual({ x: 1, y: 2, w: 20, h: 10 });
    // No bleed on a 4×6 label: the left edge stops at 0.
    expect(moveBox(b, -50, -50, 'label_4x6')).toEqual({ x: 0, y: 0, w: 20, h: 10 });
    // Fold-over has 3.175 mm bleed (rounded to 0.1 mm).
    expect(moveBox(b, -50, 0, 'fold_4x3').x).toBe(-3.2);
    expect(moveBox(b, 500, 0, 'label_4x6').x).toBe(81.6);
    expect(resizeBox(b, 5, -20, 'label_4x6')).toEqual({ x: 2, y: 2, w: 25, h: 2 });
    expect(clampBox({ x: 0, y: 0, w: 500, h: 500 }, 'cr80')).toEqual({ x: 0, y: 0, w: 54, h: 85.6 });
  });

  it('warns about text outside the safe area, but lets ribbons bleed', () => {
    const d = defaultDesign('fold_4x3');
    expect(layoutWarnings(d)).toEqual([]);
    const first = d.front[0];
    if (!first) throw new Error('no element');
    expect(outsideSafeArea({ ...first, x: 1 }, 'fold_4x3')).toBe(true);
    const ribbon = d.front.find((e) => e.kind === 'ribbon');
    expect(ribbon && ribbon.x < 0).toBe(true);
    expect(ribbon && outsideSafeArea(ribbon, 'fold_4x3')).toBe(false);
  });

  it('every preset has a valid default design inside its safe area', () => {
    for (const k of BADGE_SIZES) {
      const d = defaultDesign(k);
      expect(BadgeDesign.parse(d)).toEqual(d);
      expect(layoutWarnings(d)).toEqual([]);
      expect(d.back.length > 0).toBe(SIZES[k].foldOver);
    }
  });

  it('rescales a design to another size and drops the back when there is none', () => {
    const d = rescaleDesign(defaultDesign('fold_4x3'), 'cr80');
    expect(d.size).toBe('cr80');
    expect(d.back).toEqual([]);
    for (const e of d.front) expect(e.x + e.w).toBeLessThanOrEqual(SIZES.cr80.widthMm + 0.05);
  });

  it('refuses a back on a single-sided size and duplicate element ids', () => {
    const d = defaultDesign('fold_4x3');
    expect(BadgeDesign.safeParse({ ...d, size: 'cr80' }).success).toBe(false);
    const dup = { ...d, back: [...d.back, { ...d.front[0] }] };
    expect(BadgeDesign.safeParse(dup).success).toBe(false);
  });
});

describe('name fitting', () => {
  it('keeps the design size when the name fits', () => {
    expect(fitFontSize('Ada', { widthMm: 90, heightMm: 20 }, 30)).toEqual({ pt: 30, clipped: false });
  });

  it('shrinks a long name to fit the width, in half points', () => {
    const r = fitFontSize('Maximiliana Wolfeschlegelsteinhausen', { widthMm: 90, heightMm: 20 }, 30);
    expect(r.clipped).toBe(false);
    expect(r.pt).toBeLessThan(30);
    expect(r.pt * 2).toBe(Math.round(r.pt * 2));
    expect(textWidthMm('Maximiliana Wolfeschlegelsteinhausen', r.pt)).toBeLessThanOrEqual(90);
    expect(textWidthMm('Maximiliana Wolfeschlegelsteinhausen', r.pt + 0.5)).toBeGreaterThan(90);
  });

  it('never goes below the minimum; beyond that the name is clipped', () => {
    const r = fitFontSize('X'.repeat(200), { widthMm: 40, heightMm: 20 }, 30);
    expect(r).toEqual({ pt: MIN_FONT_PT, clipped: true });
  });

  it('caps the size by the box height', () => {
    expect(fitFontSize('Ada', { widthMm: 90, heightMm: 5 }, 40).pt).toBeLessThanOrEqual(12.5);
  });

  it('measures wide and narrow scripts differently', () => {
    expect(textWidthMm('山田太郎', 12)).toBeGreaterThan(textWidthMm('abcd', 12));
    expect(textWidthMm('ليلى', 12)).toBeLessThan(textWidthMm('山田太郎', 12));
    expect(textWidthMm('Ada', 12, true)).toBeGreaterThan(textWidthMm('Ada', 12));
  });
});

describe('names and sort orders', () => {
  it('splits first and last names predictably', () => {
    expect(splitName('Ada Lovelace')).toEqual({ first: 'Ada', last: 'Lovelace' });
    expect(splitName('  Ludwig   van Beethoven ')).toEqual({ first: 'Ludwig', last: 'van Beethoven' });
    expect(splitName('Lovelace, Ada')).toEqual({ first: 'Ada', last: 'Lovelace' });
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: '' });
    expect(splitName('')).toEqual({ first: '', last: '' });
    expect(splitName('ليلى الفارسي')).toEqual({ first: 'ليلى', last: 'الفارسي' });
  });

  it('files surnames without particles and articles', () => {
    expect(surnameSortKey('van Beethoven')).toBe('Beethoven');
    expect(surnameSortKey('Al-Farsi')).toBe('Farsi');
    expect(surnameSortKey('الفارسي')).toBe('فارسي');
    expect(surnameSortKey('Dunn')).toBe('Dunn');
  });

  const rows = [
    { id: '1', holderName: 'Zoe Adams', company: 'Initech', serial: 4 },
    { id: '2', holderName: 'ada baker', company: '', serial: 1 },
    { id: '3', holderName: 'Émile Àbel', company: 'acme', serial: 3 },
    { id: '4', holderName: 'Bob Adams', company: 'Initech', serial: 2 },
    { id: '5', holderName: 'Ludwig van Beethoven', company: 'Acme', serial: 5 },
    { id: '6', holderName: 'Bob Adams', company: 'Initech', serial: 0 },
  ];

  it('sorts A–Z by last name, then first name, then serial (accent- and case-blind)', () => {
    expect(sortBadges(rows, 'last_name').map((r) => r.id)).toEqual(['3', '6', '4', '1', '2', '5']);
  });

  it('sorts by company A–Z, no company last, people A–Z within a company', () => {
    expect(sortBadges(rows, 'company').map((r) => r.id)).toEqual(['3', '5', '6', '4', '1', '2']);
  });

  it('is numeric-aware and stable across runs', () => {
    const r = [
      { id: 'a', holderName: 'A A', company: 'Room 10', serial: 1 },
      { id: 'b', holderName: 'A A', company: 'Room 9', serial: 2 },
    ];
    expect(sortBadges(r, 'company').map((x) => x.id)).toEqual(['b', 'a']);
    expect(sortBadges([...rows].reverse(), 'last_name')).toEqual(sortBadges(rows, 'last_name'));
  });
});

describe('ribbons and the render allowlist', () => {
  it('maps a ticket type to its ribbon label and token colours', () => {
    const d = { ribbons: { [T1]: { label: 'SPEAKER', color: 'orange' as const } } };
    expect(ribbonFor(d, T1)).toEqual({ label: 'SPEAKER', ...RIBBON_COLORS.orange });
    expect(ribbonFor(d, T2)).toBeNull();
    expect(pruneRibbons(d.ribbons, new Set([T2]))).toEqual({});
  });

  it('every ribbon colour pair reads at ≥ 4.5:1', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5]
        .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    };
    for (const { fill, text } of Object.values(RIBBON_COLORS)) {
      const [a, b] = [lum(fill), lum(text)].sort((x, y) => y - x) as [number, number];
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  const src = {
    ticketId: T2,
    ticketTypeId: T1,
    typeName: 'VIP',
    holderName: 'Ada Lovelace',
    code: 'YY1ABC',
    answers: { company: 'Analytical Engines', title: 'Countess', diet: 'vegan', email: 'a@x.test' },
  };

  it('fills only the fields the template places, from mapped answers only', () => {
    const d = defaultDesign('label_4x6');
    expect(badgeRow({ ...d, sources: { company: 'company', jobTitle: 'title' } }, src)).toEqual({
      ticketId: T2,
      ticketTypeId: T1,
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      jobTitle: 'Countess',
      typeLabel: '',
      code: 'YY1ABC',
    });
    // Unmapped sources print nothing even when an answer exists; unplaced fields are blank.
    const bare = { ...d, front: d.front.filter((e) => e.kind === 'first_name') };
    const row = badgeRow(bare, src);
    expect(row).toMatchObject({ firstName: 'Ada', lastName: '', company: '', jobTitle: '', code: '' });
    expect(JSON.stringify(row)).not.toMatch(/vegan|a@x\.test/);
  });

  it('resolves elements: ribbon per type, RTL alignment flips, empty fields print nothing', () => {
    const d = {
      ...defaultDesign('label_4x6'),
      ribbons: { [T1]: { label: 'VIP', color: 'pink' as const } },
    };
    const row = badgeRow(d, src);
    const els = resolveBadge(d, row, false);
    const ribbon = els.find((e) => e.kind === 'ribbon');
    expect(ribbon).toMatchObject({ text: 'VIP', fill: RIBBON_COLORS.pink.fill, empty: false });
    expect(els.find((e) => e.kind === 'company')?.empty).toBe(true);
    const start = { ...d, front: d.front.map((e) => ({ ...e, align: 'start' as const })) };
    expect(resolveBadge(start, row, false)[0]?.align).toBe('left');
    expect(resolveBadge({ ...start, direction: 'rtl' }, row, false)[0]?.align).toBe('right');
    const other = resolveBadge(d, { ...row, ticketTypeId: T2 }, false).find((e) => e.kind === 'ribbon');
    expect(other?.empty).toBe(true);
  });
});
