import { color } from './tokens.ts';

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The brand kit's contrast check: text on the brand colour is ink or white, whichever reads
 * better (always ≥4.5:1). The colour against the white page should reach 3:1 for buttons and
 * focus rings (WCAG 1.4.11); `uiOk` says whether it does.
 */
export function brandPalette(brand: string): {
  background: string;
  text: string;
  textRatio: number;
  onPage: number;
  uiOk: boolean;
} {
  const onInk = contrastRatio(brand, color.ink);
  const onWhite = contrastRatio(brand, color.white);
  const text = onInk >= onWhite ? color.ink : color.white;
  const onPage = contrastRatio(brand, color.white);
  return { background: brand, text, textRatio: Math.max(onInk, onWhite), onPage, uiOk: onPage >= 3 };
}
