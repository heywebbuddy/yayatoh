/**
 * The colours of a verdict panel (M7.4b), from the design tokens only. The panel is a solid fill so
 * it reads at arm's length; the text on it is whichever of white and black has more contrast with
 * the fill in the current mode, and never less than 4.5:1 (checked for both modes in the tests).
 */
import { constant } from '@yayatoh/ui/tokens';
import type { Tone } from '../verdicts';

interface PaletteLike {
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function toneColors(tone: Tone, colors: PaletteLike): { fill: string; text: string } {
  const fill = tone === 'admit' ? colors.success : tone === 'warn' ? colors.warning : colors.danger;
  const text = contrast(fill, constant.white) >= contrast(fill, constant.black) ? constant.white : constant.black;
  return { fill, text };
}

/** A glyph that carries the tone without colour: ✓ let them in, ! look closer, ✕ do not admit. */
export const TONE_GLYPH: Record<Tone, string> = { admit: '✓', warn: '!', stop: '✕' };
