/**
 * WCAG 2 contrast for tenant brand colours (M7.1c). A copy of the arithmetic in
 * `packages/ui/src/contrast.ts`, which apps cannot import (they take `@yayatoh/ui/tokens` only).
 * Only opaque `#rgb` / `#rrggbb` colours are accepted from the server.
 */

export const MIN_TEXT_CONTRAST = 4.5;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX.test(value.trim());

/** `#abc` and `#aabbcc` as `[r, g, b]`, or null for anything else. */
export function parseHex(value: string): [number, number, number] | null {
  if (!isHexColor(value)) return null;
  const h = value.trim().slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** The contrast ratio (1 to 21) of two opaque hex colours; NaN if either is not one. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [parseHex(a), parseHex(b)];
  if (!x || !y) return Number.NaN;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `from` moved `amount` (0 to 1) of the way to `to`, as `#rrggbb`. */
export function mix(from: string, to: string, amount: number): string {
  const [a, b] = [parseHex(from), parseHex(to)];
  if (!a || !b) return from;
  return `#${a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}
