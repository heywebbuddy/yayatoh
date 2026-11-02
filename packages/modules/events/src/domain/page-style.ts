import { z } from 'zod';

/**
 * Organizer page styling for the public event page (the "Page design" panel): brand colours,
 * text and section colours, a text-size scale, and which page sections show in what order. It is
 * stored inside the event's design (jsonb), so it needs no column of its own. Everything here only
 * restyles the page; colours are sanitized to `#rrggbb` and auto-corrected for contrast before the
 * page uses them, so organizer choices can never make text unreadable.
 */

/** The page sections an organizer can order and hide (each shows only when it has content). */
export const PAGE_SECTIONS = [
  'announcements',
  'about',
  'agenda',
  'speakers',
  'passes',
  'venue',
  'faq',
  'gallery',
  'exhibitors',
  'sponsors',
  'reviews',
] as const;
export type PageSection = (typeof PAGE_SECTIONS)[number];

/** Sections that cannot be hidden (buying a ticket must always be possible). */
export const REQUIRED_SECTIONS: readonly PageSection[] = ['passes'];

export const TEXT_SCALES = ['small', 'default', 'large'] as const;
export type TextScale = (typeof TEXT_SCALES)[number];
export const TEXT_SCALE_FACTOR: Record<TextScale, number> = { small: 0.92, default: 1, large: 1.12 };

const HEX = /^#[0-9a-f]{6}$/;

/** A colour as `#rrggbb` (lower case); `#rgb` is expanded; anything else is null. */
export function sanitizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return HEX.test(v) ? v : null;
}

const Hex = z.preprocess((v) => sanitizeHex(v), z.string().regex(HEX).nullable()).catch(null);

export const PageStyle = z.object({
  /** The main accent (buttons, time ranges, highlights). */
  accent: Hex.default(null),
  /** A second accent (decorative shapes, alternating cards). */
  accent2: Hex.default(null),
  /** The bold colour band behind the speakers and the call-to-action band. */
  band: Hex.default(null),
  /** Section card background and its text colour (applied in light mode). */
  sectionBg: Hex.default(null),
  text: Hex.default(null),
  scale: z.enum(TEXT_SCALES).catch('default').default('default'),
  /** Section order; a section missing from the list keeps its default place at the end. */
  order: z
    .array(z.enum(PAGE_SECTIONS))
    .catch([])
    .default([])
    .transform((xs) => [...new Set(xs)]),
  hidden: z
    .array(z.enum(PAGE_SECTIONS))
    .catch([])
    .default([])
    .transform((xs) => [...new Set(xs)].filter((x) => !REQUIRED_SECTIONS.includes(x))),
});
export type PageStyle = z.infer<typeof PageStyle>;

export const DEFAULT_PAGE_STYLE: PageStyle = {
  accent: null,
  accent2: null,
  band: null,
  sectionBg: null,
  text: null,
  scale: 'default',
  order: [],
  hidden: [],
};

export const isDefaultPageStyle = (s: PageStyle): boolean =>
  s.accent === null &&
  s.accent2 === null &&
  s.band === null &&
  s.sectionBg === null &&
  s.text === null &&
  s.scale === 'default' &&
  s.order.length === 0 &&
  s.hidden.length === 0;

/** Read leniently: anything unreadable is the default. */
export function parsePageStyle(raw: unknown): PageStyle {
  const r = PageStyle.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_PAGE_STYLE;
}

// --- contrast (WCAG 2.x) -----------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two `#rrggbb` colours (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (p: number, q: number) =>
    Math.round(p + (q - p) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/** Near-black or white, whichever reads better on `bg`. */
export function inkOn(bg: string): string {
  return contrast(bg, '#ffffff') >= contrast(bg, '#14110f') ? '#ffffff' : '#14110f';
}

/**
 * `fg` itself when it reaches `min` against `bg`; otherwise `fg` moved towards black or white
 * (whichever side gets there) in small steps until it does. Hue is kept as far as possible.
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  const target = inkOn(bg) === '#ffffff' ? '#ffffff' : '#000000';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

export type ContrastIssue = 'text' | 'accent' | 'band';

/** Pairs that fall short of WCAG AA (4.5:1 for text; 3:1 for the accent as a large/UI colour). */
export function contrastIssues(s: PageStyle, defaults: { sectionBg: string; text: string }): ContrastIssue[] {
  const bg = s.sectionBg ?? defaults.sectionBg;
  const text = s.text ?? defaults.text;
  const out: ContrastIssue[] = [];
  if ((s.text || s.sectionBg) && contrast(text, bg) < 4.5) out.push('text');
  if (s.accent && contrast(s.accent, bg) < 4.5) out.push('accent');
  if (s.band && Math.max(contrast(s.band, '#ffffff'), contrast(s.band, '#14110f')) < 4.5) out.push('band');
  return out;
}

/** The section order to render: the organizer's order, then any section they did not place. */
export function sectionOrder(s: PageStyle, defaults: readonly PageSection[] = PAGE_SECTIONS): PageSection[] {
  return [...s.order, ...defaults.filter((x) => !s.order.includes(x))];
}

/**
 * The CSS custom properties for the page (all values sanitized and contrast-corrected). `-l`
 * values apply in light mode only (dark mode keeps the theme's surfaces). Only set properties are
 * returned, so an event without settings keeps its type's own colours.
 */
export function pageStyleVars(s: PageStyle): Record<string, string> {
  const vars: Record<string, string> = {};
  const light = '#ffffff';
  const sectionBg = s.sectionBg ?? null;
  const text = s.text ? ensureContrast(s.text, sectionBg ?? light, 4.5) : null;
  if (sectionBg) {
    vars['--ev-section-l'] = sectionBg;
    vars['--ev-text-l'] = text ?? inkOn(sectionBg);
  } else if (text) {
    vars['--ev-text-l'] = text;
  }
  if (s.accent) {
    vars['--ev-accent'] = s.accent;
    vars['--ev-on-accent'] = inkOn(s.accent);
    // The accent as text (time ranges, links) on the section background.
    vars['--ev-accent-ink-l'] = ensureContrast(s.accent, sectionBg ?? light, 4.5);
    // Dark mode keeps its own surfaces: the accent as text there, against the lightest dark row.
    vars['--ev-accent-ink-dark'] = ensureContrast(s.accent, '#2a2a2a', 4.5);
  }
  if (s.accent2) vars['--ev-accent-2'] = s.accent2;
  if (s.band) {
    // A mid-tone band reads with neither ink: darken it until white text passes.
    const band = contrast(s.band, inkOn(s.band)) >= 4.5 ? s.band : ensureContrast(s.band, '#ffffff', 4.5);
    vars['--ev-band'] = band;
    vars['--ev-band-ink'] = inkOn(band);
  }
  if (s.scale !== 'default') vars['--ev-scale'] = String(TEXT_SCALE_FACTOR[s.scale]);
  return vars;
}
