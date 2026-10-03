/**
 * Design tokens — ADR 0022 (design system v2; supersedes ADR 0018's visual layer, keeps its rules).
 * Source of truth together with styles.css; tests/tokens.test.ts keeps the two in sync and
 * tests/contrast.test.ts checks every text/surface pair in both modes. No colour, radius, shadow
 * or font outside these two files (check-modules `design-tokens`).
 *
 * Every colour is a semantic role with a light value (the default for everyone) and a dark value
 * (opt-in through the theme switch). Tailwind utilities use the role name: `bg-surface`,
 * `text-ink-2`, `border-line`, `bg-primary text-on-primary`, `bg-success-soft text-success`.
 */

/** The themes a person can choose. Light is the default; "system" follows the OS. */
export const THEMES = ['light', 'dark', 'system'] as const;
export type ThemeChoice = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeChoice = 'light';
/** Cookie that carries the choice, read on the server so the first paint is right. */
export const THEME_COOKIE = 'yy_theme';
export const isThemeChoice = (v: unknown): v is ThemeChoice =>
  typeof v === 'string' && (THEMES as readonly string[]).includes(v);

/** Light mode: grey-white canvas, white cards, violet actions, pink brand. */
export const light = {
  /** Page background. */
  canvas: '#F2F1F6',
  /** Cards and panels. */
  surface: '#FFFFFF',
  /** Opaque surface for menus, popovers, dialogs and sticky headers. */
  surfaceSolid: '#FFFFFF',
  /** Inset areas: table rows, filters, quiet fields. */
  surface2: '#F6F5FA',
  /** Hover and pressed tint, progress tracks. */
  surface3: '#EEEAF5',
  /** Hairlines and card borders (decorative). */
  line: '#E7E4EE',
  /** Field borders and dividers that identify a control (≥3:1 on surface). */
  lineStrong: '#8F899C',
  /** Text. */
  ink: '#16131D',
  /** Muted text (≥4.5:1 on every surface). */
  ink2: '#5E596A',
  /** Placeholders, disabled text and decorative glyphs (≥3:1). */
  ink3: '#8F899C',
  /** Primary action fill (violet). */
  primary: '#6A3BFF',
  primaryHover: '#5A2EE6',
  primaryPressed: '#4F25D6',
  /** Text on primary. */
  onPrimary: '#FFFFFF',
  /** Violet as text: links, selected labels. */
  primaryInk: '#5528E8',
  /** Selected rows, chosen options, info backgrounds. */
  primarySoft: '#EEE8FF',
  /** Brand pink: the logo mark, highlights, decorative dots. */
  brand: '#FF3D86',
  /** Pink fill that carries white text. */
  brandStrong: '#D61F66',
  brandInk: '#C41C5E',
  brandSoft: '#FDE3EE',
  success: '#0B7A50',
  successSoft: '#DDF6EA',
  successDot: '#16C784',
  warning: '#8A4F00',
  warningSoft: '#FFF0D4',
  warningDot: '#FFB020',
  danger: '#B81F35',
  dangerSoft: '#FDE3E7',
  dangerDot: '#E5364F',
  /** Dark uppercase tags ("WEBSITE"), the dark button, selected filter chips. */
  tag: '#2A2230',
  tagInk: '#FFFFFF',
  /** Text on the highlight card. */
  heroInk: '#16131D',
  /** The floating sidebar (near-black in both modes). */
  side: '#17121B',
  sideLine: 'rgba(255,255,255,0.06)',
  sideInk: '#B9B3C4',
  sideLabel: '#8E889A',
  sideStrong: '#FFFFFF',
  sideTile: '#251E2A',
  sideHover: 'rgba(255,255,255,0.06)',
  sideTileOn: '#FFFFFF',
  sideTileOnInk: '#17121B',
  /** Avatar pastels, picked by a stable hash of the name. */
  lavender: '#E3D9FF',
  blush: '#FCDDE9',
  sky: '#D8E8FF',
  sand: '#FBE8CF',
  mint: '#D5F5E6',
  avatarInk: '#16131D',
  /** Focus ring. */
  focus: '#6A3BFF',
  /** Behind modals and drawers. */
  scrim: 'rgba(22,19,29,0.45)',
} as const;

export type ColorRole = keyof typeof light;

/** Dark mode: violet-black canvas with a soft violet glow, glassy cards, mint and violet light. */
export const dark: Record<ColorRole, string> = {
  canvas: '#0A0812',
  surface: 'rgba(26,20,46,0.72)',
  surfaceSolid: '#1C1631',
  surface2: 'rgba(255,255,255,0.04)',
  surface3: 'rgba(255,255,255,0.08)',
  line: 'rgba(170,150,255,0.16)',
  lineStrong: '#7E76A3',
  ink: '#F4F1FF',
  ink2: '#ABA4C6',
  ink3: '#7E76A3',
  /** #7B5CFF is the dark violet of glows, rings and gradients; the solid fill under white text is
   * a step deeper so the label reaches 5.3:1 (ADR 0022). */
  primary: '#6C4CF2',
  primaryHover: '#6243E8',
  primaryPressed: '#5734E0',
  onPrimary: '#FFFFFF',
  primaryInk: '#BBA9FF',
  primarySoft: 'rgba(123,92,255,0.2)',
  brand: '#FF5C9A',
  brandStrong: '#D61F66',
  brandInk: '#FF7EAF',
  brandSoft: 'rgba(255,92,154,0.16)',
  success: '#4BE9AC',
  successSoft: 'rgba(59,230,164,0.14)',
  successDot: '#3BE6A4',
  warning: '#FFC56E',
  warningSoft: 'rgba(255,197,110,0.14)',
  warningDot: '#FFB84D',
  danger: '#FF8798',
  dangerSoft: 'rgba(255,122,140,0.15)',
  dangerDot: '#FF6B81',
  tag: 'rgba(255,255,255,0.08)',
  tagInk: '#ECE7FF',
  heroInk: '#FFFFFF',
  side: 'rgba(15,11,28,0.86)',
  sideLine: 'rgba(170,150,255,0.16)',
  sideInk: '#A9A3C4',
  sideLabel: '#8D86A8',
  sideStrong: '#FFFFFF',
  sideTile: 'rgba(255,255,255,0.05)',
  sideHover: 'rgba(255,255,255,0.06)',
  sideTileOn: '#7B5CFF',
  sideTileOnInk: '#FFFFFF',
  lavender: 'rgba(123,92,255,0.34)',
  blush: 'rgba(255,92,154,0.28)',
  sky: 'rgba(90,160,255,0.28)',
  sand: 'rgba(255,197,110,0.26)',
  mint: 'rgba(59,230,164,0.24)',
  avatarInk: '#F4F1FF',
  focus: '#A48CFF',
  scrim: 'rgba(0,0,0,0.6)',
};

/** Colours that never change with the theme (text on photos and on the violet hero). */
export const constant = { white: '#FFFFFF', black: '#000000' } as const;

/** Gradients and the canvas glow, per mode (CSS background values). */
export const gradient = {
  light: {
    /** The page backdrop over the canvas colour (none in light mode). */
    page: 'none',
    /** The soft pink-to-lavender highlight card with the huge number. */
    highlight: 'linear-gradient(135deg,#FFE0EC 0%,#FAD3EC 45%,#E3D8FF 100%)',
    /** The public event hero and the feature tiles (violet light). */
    hero: 'radial-gradient(90% 120% at 90% 10%,#B49CFF 0%,#6A3BFF 38%,#2B1673 100%)',
    /** The sidebar promo card. */
    promo: 'linear-gradient(150deg,#6A3BFF 0%,#3B1FA8 100%)',
    /** The active sidebar row. */
    sideRow: 'linear-gradient(0deg,rgba(255,255,255,0.10),rgba(255,255,255,0.10))',
    /** Active segmented tab. */
    tabOn: 'linear-gradient(0deg,#17121B,#17121B)',
    /** Feature card (next step on a workspace). */
    feature: 'linear-gradient(135deg,#FFFFFF 0%,#F4EEFF 100%)',
  },
  dark: {
    page: 'radial-gradient(55% 40% at 72% -6%,rgba(123,92,255,0.45),rgba(123,92,255,0) 70%),radial-gradient(40% 32% at 0% 100%,rgba(255,92,154,0.13),rgba(255,92,154,0) 70%)',
    highlight: 'radial-gradient(120% 140% at 85% 0%,#8D6FFF 0%,#4B2FB0 34%,#1A1233 74%)',
    hero: 'radial-gradient(90% 120% at 90% 0%,#8D6FFF 0%,#4B2FB0 34%,#120C26 78%)',
    promo: 'radial-gradient(120% 120% at 100% 0%,#8D6FFF 0%,#4B2FB0 45%,#1A1233 100%)',
    sideRow: 'linear-gradient(135deg,rgba(123,92,255,0.55),rgba(123,92,255,0.16))',
    tabOn: 'linear-gradient(135deg,#7B5CFF,#5A3BE0)',
    feature: 'linear-gradient(160deg,#120D22 0%,#0B0816 100%)',
  },
} as const;

/** The brightest point of the dark canvas glow (contrast checks composite dark surfaces over it). */
export const glowPeak = 'rgba(123,92,255,0.45)';

/** Elevation, per mode. Light: soft grey shadows. Dark: a violet hairline and deep shadow. */
export const shadow = {
  light: {
    card: '0 1px 2px rgba(22,19,29,0.04),0 10px 30px rgba(22,19,29,0.06)',
    pop: '0 2px 6px rgba(22,19,29,0.06),0 24px 48px rgba(22,19,29,0.14)',
    primary: '0 8px 20px rgba(106,59,255,0.28)',
  },
  dark: {
    card: '0 0 0 1px rgba(170,150,255,0.05),0 24px 48px rgba(0,0,0,0.40)',
    pop: '0 0 0 1px rgba(170,150,255,0.12),0 24px 64px rgba(0,0,0,0.60)',
    primary: '0 0 0 1px rgba(160,135,255,0.4),0 10px 30px rgba(123,92,255,0.45)',
  },
} as const;

/** Radii by role: tags 8, controls 14, tiles and rows 18, cards 24, panels and the sidebar 28. */
export const radius = {
  tag: '8px',
  control: '14px',
  tile: '18px',
  card: '24px',
  panel: '28px',
  pill: '9999px',
} as const;

/** 8-pt spacing (4 for hairline adjustments). Tailwind's 0.25rem step covers these. */
export const space = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80] as const;

/** Motion: short and calm; `prefers-reduced-motion` turns transitions and animations off. */
export const motion = {
  fast: '150ms',
  base: '200ms',
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/**
 * Manrope (Latin, Cyrillic, Greek) with per-script fallbacks (ADR 0016, ADR 0022): Arabic → IBM
 * Plex Sans Arabic, Devanagari → Noto Sans Devanagari, CJK → Noto Sans JP / SC / TC. All are
 * self-hosted; the CSS variables come from next/font in each app's root layout.
 */
export const font = {
  sans: 'var(--font-manrope, "Manrope"), var(--font-manrope-ext, "Manrope"), var(--font-manrope-cyrillic, "Manrope"), var(--font-arabic, "IBM Plex Sans Arabic"), var(--font-devanagari, "Noto Sans Devanagari"), "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", "PingFang SC", "Microsoft YaHei", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif',
  mono: "ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, monospace",
} as const;

/**
 * Email-safe font stacks for campaign emails (M3.6b brand kit): email clients can't load web
 * fonts reliably, so each choice falls back through system fonts and the Noto scripts.
 */
export const emailFont = {
  sans: "'Helvetica Neue',Arial,'Noto Sans Arabic','Noto Sans Devanagari','Noto Sans SC','Noto Sans TC','Noto Sans JP',sans-serif",
  serif: "Georgia,'Times New Roman','Noto Serif','Noto Naskh Arabic',serif",
  rounded: "'Trebuchet MS','Segoe UI',Verdana,'Noto Sans Arabic','Noto Sans JP',sans-serif",
} as const;

/** Type scale (px / line-height / weight / tracking). Headings are 800 with tight tracking. */
export const type = {
  display: { size: 56, lineHeight: 1.0, weight: 800, tracking: '-0.045em' },
  title: { size: 40, lineHeight: 1.05, weight: 800, tracking: '-0.035em' },
  section: { size: 22, lineHeight: 1.25, weight: 800, tracking: '-0.02em' },
  card: { size: 20, lineHeight: 1.3, weight: 800, tracking: '-0.02em' },
  prose: { size: 15, lineHeight: 1.7, weight: 400, tracking: '0' },
  body: { size: 14, lineHeight: 1.5, weight: 500, tracking: '0' },
  caption: { size: 12, lineHeight: 1.45, weight: 500, tracking: '0' },
  label: { size: 11, lineHeight: 1.2, weight: 800, tracking: '0.1em' },
  stat: { size: 38, lineHeight: 1.0, weight: 800, tracking: '-0.04em' },
} as const;

/** Status tones: always a dot plus text, never hue alone. */
export const STATUS_TONES = ['success', 'waiting', 'danger', 'info', 'neutral', 'brand'] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

/** Legacy status names (ADR 0018) still used by StatusDot callers. */
export type Status = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Avatar pastels in hash order (Avatar, AvatarStack, PersonChip). */
export const AVATAR_TONES = ['lavender', 'blush', 'sky', 'sand', 'mint'] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** Data visualisation: current = violet, then pink, mint, amber, sky; comparisons = muted ink. */
export const chart = {
  categorical: ['primary', 'brand', 'success-dot', 'warning-dot', 'sky'] as const,
  comparison: 'ink-3',
  strokeWidth: 2,
} as const;

/**
 * Seat maps and floor plans draw on a canvas (Konva) and need literal colours: they render on a
 * light "paper" in both modes, like a printed plan, so these are the light values.
 */
export const paper = {
  background: '#FFFFFF',
  floor: '#EEEAF5',
  label: '#16131D',
  muted: '#5E596A',
  outline: '#8F899C',
  free: '#FFFFFF',
  taken: '#D5D0E0',
  sold: '#2A2230',
  selected: '#6A3BFF',
  held: '#FFB020',
  blocked: '#B81F35',
  reserved: '#E7E4EE',
  focus: '#16131D',
} as const;

/**
 * Printed badges (M5.5a) are always on white stock, whatever the screen theme: the ink, the
 * paper and the ribbon colours (keys are stored in badge designs; every pair is ≥4.5:1).
 */
export const print = {
  paper: constant.white,
  ink: light.ink,
  ribbon: {
    ink: { fill: light.ink, text: constant.white },
    zinc: { fill: light.tag, text: constant.white },
    orange: { fill: light.warning, text: constant.white },
    pink: { fill: light.brandStrong, text: constant.white },
    green: { fill: light.successDot, text: light.ink },
    yellow: { fill: light.warningDot, text: light.ink },
    peach: { fill: light.sand, text: light.ink },
    grey: { fill: light.ink3, text: light.ink },
  },
} as const;

/**
 * Emails are always light (mail clients ignore our theme): inline styles take these values.
 * Body text is ink at 92 % for a softer paragraph colour that still passes 4.5:1.
 */
export const email = {
  page: '#F2F1F6',
  card: '#FFFFFF',
  ink: '#16131D',
  body: '#2A2230',
  muted: '#5E596A',
  link: '#5528E8',
  line: '#E7E4EE',
  header: '#17121B',
  headerInk: '#FFFFFF',
  button: '#6A3BFF',
  buttonInk: '#FFFFFF',
  /** Notice band (test sends). */
  notice: '#FFF0D4',
} as const;

/** Minimum interactive target size (WCAG 2.2 AA, CLAUDE.md); 44 px on touch screens. */
export const MIN_TARGET_PX = 24;
export const TOUCH_TARGET_PX = 44;
