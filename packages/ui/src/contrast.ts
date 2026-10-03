import { type ColorRole, constant, dark, glowPeak, light } from './tokens.ts';

type Rgba = readonly [number, number, number, number];

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() into channels (alpha 0–1). */
export function parseColor(c: string): Rgba {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m?.[1]) throw new Error(`Not a colour: ${c}`);
  const [r = 0, g = 0, b = 0, a = 1] = m[1].split(',').map((x) => Number(x.trim()));
  return [r, g, b, a];
}

/** `fg` painted over an opaque `bg` (alpha compositing), as #rrggbb. */
export function composite(fg: string, bg: string): string {
  const [r, g, b, a] = parseColor(fg);
  const [R, G, B] = parseColor(bg);
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a));
  return `#${[mix(r, R), mix(g, G), mix(b, B)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance of an opaque colour. */
export function luminance(c: string): number {
  const [r, g, b] = parseColor(c);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours (1–21); translucent ones are composited first. */
export function contrastRatio(a: string, b: string, backdrop: string = constant.white): number {
  const bg = composite(b, backdrop);
  const fg = composite(a, bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type Mode = 'light' | 'dark';
export const palettes: Record<Mode, Record<ColorRole, string>> = { light, dark };

/**
 * What a translucent surface sits on. Dark mode has a violet glow at the top of the page, so every
 * dark pair is checked over the plain canvas and over the brightest point of the glow.
 */
export function backdrops(mode: Mode): readonly string[] {
  const p = palettes[mode];
  return mode === 'light' ? [p.canvas] : [p.canvas, composite(glowPeak, p.canvas)];
}

/** The page surfaces text sits on (opaque colours, per backdrop). */
export function surfacesOf(mode: Mode): Record<string, readonly string[]> {
  const p = palettes[mode];
  const on = (role: ColorRole) => backdrops(mode).map((b) => composite(p[role], b));
  return {
    canvas: on('canvas'),
    surface: on('surface'),
    surfaceSolid: on('surfaceSolid'),
    surface2: backdrops(mode).map((b) => composite(p.surface2, composite(p.surface, b))),
    surface3: backdrops(mode).map((b) => composite(p.surface3, composite(p.surface, b))),
  };
}

export interface Pair {
  readonly text: ColorRole | 'white';
  /** A surface key from `surfacesOf`, or a role painted over the card surface. */
  readonly on: string;
  /** 4.5 for text, 3 for large text (24 px+) and UI glyphs. */
  readonly min: 4.5 | 3;
}

const body = (text: Pair['text'], on: readonly string[]): Pair[] =>
  on.map((o) => ({ text, on: o, min: 4.5 as const }));
const ui = (text: Pair['text'], on: readonly string[]): Pair[] =>
  on.map((o) => ({ text, on: o, min: 3 as const }));
const SURFACES = ['canvas', 'surface', 'surfaceSolid', 'surface2', 'surface3'];

/** Every text/surface pair the components use (ADR 0022 contrast table). */
export const PAIRS: readonly Pair[] = [
  ...body('ink', SURFACES),
  ...body('ink2', SURFACES),
  ...body('primaryInk', ['surface', 'surfaceSolid', 'surface2', 'primarySoft']),
  ...body('ink', ['primarySoft', 'successSoft', 'warningSoft', 'dangerSoft', 'brandSoft']),
  ...body('onPrimary', ['primary', 'primaryHover', 'primaryPressed']),
  ...body('success', ['successSoft', 'surface', 'surfaceSolid']),
  ...body('warning', ['warningSoft', 'surface', 'surfaceSolid']),
  ...body('danger', ['dangerSoft', 'surface', 'surfaceSolid']),
  ...body('brandInk', ['brandSoft', 'surface', 'surfaceSolid']),
  ...body('white', ['brandStrong']),
  ...body('tagInk', ['tag']),
  ...body('sideInk', ['side', 'sideTile', 'sideHover']),
  ...body('sideLabel', ['side']),
  ...body('sideStrong', ['side', 'sideTile', 'sideHover']),
  // The active row's icon tile holds a glyph, not text.
  ...ui('sideTileOnInk', ['sideTileOn']),
  ...body('avatarInk', ['lavender', 'blush', 'sky', 'sand', 'mint']),
  // UI glyphs and boundaries (WCAG 1.4.11): field borders, the focus ring, placeholder text.
  ...ui('lineStrong', ['surface', 'surfaceSolid', 'surface2', 'canvas']),
  ...ui('focus', ['canvas', 'surface', 'surfaceSolid']),
  ...ui('primary', ['surface', 'surfaceSolid', 'canvas']),
  ...ui('ink3', ['surface', 'surfaceSolid']),
];

/** The opaque backgrounds a pair's `on` stands for, in a mode. */
export function backgroundsFor(mode: Mode, on: string): readonly string[] {
  const p = palettes[mode];
  const surfaces = surfacesOf(mode);
  const known = surfaces[on];
  if (known) return known;
  const role = on as ColorRole;
  if (role.startsWith('side')) {
    // The sidebar floats on the canvas; its tiles and rows sit on the sidebar.
    const sidebar = backdrops(mode).map((b) => composite(p.side, b));
    return role === 'side' ? sidebar : sidebar.map((s) => composite(p[role], s));
  }
  // Everything else (tags, soft fills, buttons, avatars) sits on a card.
  return (surfaces.surface ?? []).map((s) => composite(p[role], s));
}

/** Every pair below its minimum in a mode (empty when the palette passes). */
export function contrastFailures(mode: Mode): { pair: Pair; ratio: number }[] {
  const p = palettes[mode];
  const out: { pair: Pair; ratio: number }[] = [];
  for (const pair of PAIRS) {
    const fg = pair.text === 'white' ? constant.white : p[pair.text];
    for (const bg of backgroundsFor(mode, pair.on)) {
      const ratio = contrastRatio(fg, bg, bg);
      if (ratio < pair.min) out.push({ pair, ratio });
    }
  }
  return out;
}

/** The opaque card colour in each mode (what a brand colour sits on). */
export const pageSurfaces: Record<Mode, string> = {
  light: composite(light.surface, light.canvas),
  dark: composite(dark.surface, dark.canvas),
};

/**
 * The brand kit's contrast check: text on the brand colour is ink or white, whichever reads
 * better (always ≥4.5:1). The colour should reach 3:1 against the page in both modes for buttons
 * and focus rings (WCAG 1.4.11): `onPage` is the light-mode ratio, `onDarkPage` the dark one and
 * `uiOk` says whether both pass.
 */
export function brandPalette(brand: string): {
  background: string;
  text: string;
  textRatio: number;
  onPage: number;
  onDarkPage: number;
  uiOk: boolean;
} {
  const onInk = contrastRatio(brand, light.ink);
  const onWhite = contrastRatio(brand, constant.white);
  const text = onInk >= onWhite ? light.ink : constant.white;
  const onPage = contrastRatio(brand, pageSurfaces.light);
  const onDarkPage = contrastRatio(brand, pageSurfaces.dark);
  return {
    background: brand,
    text,
    textRatio: Math.max(onInk, onWhite),
    onPage,
    onDarkPage,
    uiOk: onPage >= 3 && onDarkPage >= 3,
  };
}
