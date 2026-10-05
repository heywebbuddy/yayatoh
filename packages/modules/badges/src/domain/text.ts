import { MAX_FONT_PT, MIN_FONT_PT } from './design.ts';
import { ptToMm } from './sizes.ts';

/**
 * Advance width of one character in em (Noto Sans metrics, rounded up so an estimate never
 * undershoots). Wide scripts (CJK, fullwidth) are one em; Arabic letters are narrow but joined.
 */
export function charWidthEm(ch: string, bold = false): number {
  const cp = ch.codePointAt(0) ?? 0;
  let em: number;
  if (ch === ' ') em = 0.26;
  else if (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xff60)
  )
    em = 1;
  else if (cp >= 0x0600 && cp <= 0x06ff) em = 0.52;
  else if (/[̀-ًͯ-ٰٟ]/.test(ch)) em = 0;
  else if (/[iljt.,:;'!|]/.test(ch)) em = 0.3;
  else if (/[mwMW@]/.test(ch)) em = 0.9;
  else if (/[A-Z]/.test(ch)) em = 0.68;
  else if (/[0-9]/.test(ch)) em = 0.58;
  else em = 0.58;
  return bold ? em * 1.06 : em;
}

/** Estimated width of `text` set at `pt`, in millimetres. */
export function textWidthMm(text: string, pt: number, bold = false): number {
  let em = 0;
  for (const ch of text) em += charWidthEm(ch, bold);
  return ptToMm(em * pt);
}

/**
 * Fit-to-width: the largest size (in half points, at most `maxPt`) at which `text` fits
 * `widthMm` on one line, and not taller than the box allows (line height 1.15). Never below
 * MIN_FONT_PT: a name too long even then is `clipped` (the renderer ends it with an ellipsis).
 */
export function fitFontSize(
  text: string,
  box: { widthMm: number; heightMm: number },
  maxPt: number,
  bold = false,
): { pt: number; clipped: boolean } {
  const byHeight = box.heightMm / ptToMm(1) / 1.15;
  let pt = Math.min(maxPt, MAX_FONT_PT, Math.max(byHeight, MIN_FONT_PT));
  pt = Math.floor(pt * 2) / 2;
  const fits = (p: number) => textWidthMm(text, p, bold) <= box.widthMm;
  if (fits(pt)) return { pt, clipped: false };
  // Width is linear in size: jump close, then step down in half points.
  let guess = Math.floor(((pt * box.widthMm) / Math.max(textWidthMm(text, pt, bold), 0.001)) * 2) / 2;
  guess = Math.min(guess, pt);
  while (guess > MIN_FONT_PT && !fits(guess)) guess -= 0.5;
  if (guess < MIN_FONT_PT || !fits(guess)) return { pt: MIN_FONT_PT, clipped: !fits(MIN_FONT_PT) };
  return { pt: guess, clipped: false };
}
