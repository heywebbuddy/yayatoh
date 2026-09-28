import { describe, expect, it } from 'vitest';
import {
  FILE_NAME,
  plannedWidths,
  planVariants,
  scaledHeight,
  variantFileName,
} from '../src/pipeline/plan.ts';

describe('variant planning', () => {
  it('standard widths below the source, plus the source width capped at 1920', () => {
    expect(plannedWidths(3000)).toEqual([320, 640, 1280, 1920]);
    expect(plannedWidths(1920)).toEqual([320, 640, 1280, 1920]);
    expect(plannedWidths(1000)).toEqual([320, 640, 1000]);
    expect(plannedWidths(640)).toEqual([320, 640]);
    expect(plannedWidths(200)).toEqual([200]);
    expect(plannedWidths(1)).toEqual([1]);
  });

  it('never enlarges and keeps the aspect ratio', () => {
    for (const v of planVariants({ type: 'jpeg', width: 1000, height: 3, hasAlpha: false })) {
      expect(v.width).toBeLessThanOrEqual(1000);
      expect(v.height).toBeGreaterThanOrEqual(1);
    }
    expect(scaledHeight(320, 1000, 750)).toBe(240);
    expect(scaledHeight(320, 10_000, 1)).toBe(1);
  });

  it('AVIF and WebP at each width, one JPEG fallback for opaque rasters', () => {
    const plan = planVariants({ type: 'jpeg', width: 2400, height: 1200, hasAlpha: false });
    expect(plan.filter((v) => v.format === 'avif').map((v) => v.width)).toEqual([320, 640, 1280, 1920]);
    expect(plan.filter((v) => v.format === 'webp').map((v) => v.width)).toEqual([320, 640, 1280, 1920]);
    expect(plan.filter((v) => v.fallback)).toEqual([
      { format: 'jpeg', width: 1280, height: 640, fallback: true },
    ]);
    expect(plan.some((v) => v.format === 'svg')).toBe(false);
  });

  it('PNG fallback for transparency and SVG; SVG keeps its vector', () => {
    expect(
      planVariants({ type: 'png', width: 100, height: 100, hasAlpha: true }).find((v) => v.fallback)?.format,
    ).toBe('png');
    const svg = planVariants({ type: 'svg', width: 240, height: 80, hasAlpha: true });
    expect(svg.find((v) => v.fallback)?.format).toBe('png');
    expect(svg.find((v) => v.format === 'svg')).toEqual({
      format: 'svg',
      width: 240,
      height: 80,
      fallback: false,
    });
  });

  it('refuses empty dimensions', () => {
    expect(() => planVariants({ type: 'png', width: 0, height: 10, hasAlpha: false })).toThrow(RangeError);
  });

  it('file names carry the width and content hash', () => {
    const hash = 'ab'.repeat(32);
    const name = variantFileName({ format: 'jpeg', width: 640, hash });
    expect(name).toBe(`640-${'ab'.repeat(16)}.jpg`);
    expect(FILE_NAME.test(name)).toBe(true);
    expect(FILE_NAME.test('640-xyz.jpg')).toBe(false);
    expect(FILE_NAME.test(`../640-${'ab'.repeat(16)}.jpg`)).toBe(false);
  });
});
