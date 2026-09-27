import { describe, expect, it } from 'vitest';
import { brandPalette, contrastRatio } from '../src/contrast.ts';
import { color } from '../src/tokens.ts';

describe('brand contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(color.black, color.white)).toBeCloseTo(21, 5);
    expect(contrastRatio(color.white, color.white)).toBeCloseTo(1, 5);
  });

  it('picks the readable text colour and flags colours too light for buttons', () => {
    const dark = brandPalette(color.zinc[800]);
    expect(dark.text).toBe(color.white);
    expect(dark.uiOk).toBe(true);
    const light = brandPalette(color.accent[100]);
    expect(light.text).toBe(color.ink);
    expect(light.uiOk).toBe(false);
    // Whatever the colour, the chosen text reaches 4.5:1.
    for (const hexColor of [color.zinc[500], color.accent[900], color.pink[500], color.zinc[400]])
      expect(brandPalette(hexColor).textRatio).toBeGreaterThanOrEqual(4.5);
  });
});
