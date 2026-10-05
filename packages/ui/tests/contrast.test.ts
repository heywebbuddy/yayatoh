import { describe, expect, it } from 'vitest';
import {
  brandPalette,
  composite,
  contrastFailures,
  contrastRatio,
  PAIRS,
  pageSurfaces,
  parseColor,
} from '../src/contrast.ts';
import { constant, dark, gradient, light } from '../src/tokens.ts';

describe('colour maths', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(constant.black, constant.white)).toBeCloseTo(21, 5);
    expect(contrastRatio(constant.white, constant.white)).toBeCloseTo(1, 5);
  });
  it('parses and composites translucent colours', () => {
    expect(parseColor('rgba(26,20,46,0.72)')).toEqual([26, 20, 46, 0.72]);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(composite('rgba(0,0,0,0.5)', '#FFFFFF')).toBe('#808080');
    expect(composite('#123456', '#FFFFFF')).toBe('#123456');
  });
});

describe('ADR 0022 contrast table', () => {
  it('covers the text roles on every surface', () => {
    expect(PAIRS.length).toBeGreaterThan(60);
  });
  for (const mode of ['light', 'dark'] as const) {
    it(`every text/surface pair reaches 4.5:1 (3:1 for UI glyphs) in ${mode} mode`, () => {
      const failures = contrastFailures(mode).map(
        ({ pair, ratio }) => `${pair.text} on ${pair.on}: ${ratio.toFixed(2)} < ${pair.min}`,
      );
      expect(failures).toEqual([]);
    });
  }

  it('keeps the highlight card readable: large numbers 3:1 on every stop, labels 4.5:1', () => {
    const stops = (g: string) => g.match(/#[0-9A-Fa-f]{6}/g) ?? [];
    for (const s of stops(gradient.light.highlight))
      expect(contrastRatio(light.heroInk, s)).toBeGreaterThanOrEqual(4.5);
    // Dark: the label sits away from the light corner; the darker two stops carry it.
    const [, mid, deep] = stops(gradient.dark.highlight);
    for (const s of [mid, deep]) expect(contrastRatio(dark.heroInk, s as string)).toBeGreaterThanOrEqual(4.5);
    for (const s of stops(gradient.dark.highlight))
      expect(contrastRatio(dark.heroInk, s)).toBeGreaterThanOrEqual(3);
  });

  it('keeps white text readable on the violet hero (public event page)', () => {
    for (const mode of ['light', 'dark'] as const) {
      const [, mid, deep] = gradient[mode].hero.match(/#[0-9A-Fa-f]{6}/g) ?? [];
      for (const s of [mid, deep])
        expect(contrastRatio(constant.white, s as string)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('status colours', () => {
  it('are never told apart by hue alone: each tone has a distinct dot AND its own text colour', () => {
    // The pill always renders the dot and the word; the word itself must read on its soft fill.
    for (const p of [light, dark]) {
      const dots = [p.successDot, p.warningDot, p.dangerDot];
      expect(new Set(dots).size).toBe(dots.length);
      for (const [ink, soft] of [
        [p.success, p.successSoft],
        [p.warning, p.warningSoft],
        [p.danger, p.dangerSoft],
      ] as const)
        expect(contrastRatio(ink, soft, pageSurfaces[p === light ? 'light' : 'dark'])).toBeGreaterThanOrEqual(
          4.5,
        );
    }
  });
});

describe('organizer brand colour', () => {
  it('picks the readable text colour (≥4.5:1) whatever the colour', () => {
    for (const c of ['#1D4ED8', '#FC5F2B', '#FFEDD5', '#71717A', '#FF68DE', '#A1A1AA', '#000000', '#FFFFFF'])
      expect(brandPalette(c).textRatio).toBeGreaterThanOrEqual(4.5);
    expect(brandPalette('#27272A').text).toBe(constant.white);
    expect(brandPalette('#FFEDD5').text).toBe(light.ink);
  });

  it('checks the colour against the page in both modes', () => {
    // A mid violet reads on both pages; near-white fails on light, near-black fails on dark.
    const mid = brandPalette('#8B5CF6');
    expect(mid.onPage).toBeGreaterThanOrEqual(3);
    expect(mid.onDarkPage).toBeGreaterThanOrEqual(3);
    expect(mid.uiOk).toBe(true);
    expect(brandPalette('#FFEDD5').uiOk).toBe(false);
    const ink = brandPalette('#18181B');
    expect(ink.onPage).toBeGreaterThanOrEqual(3);
    expect(ink.onDarkPage).toBeLessThan(3);
    expect(ink.uiOk).toBe(false);
  });
});
