/**
 * Design tokens — ADR 0018 (Superpower style). Source of truth together with styles.css;
 * tests/tokens.test.ts keeps the two in sync. No colour, radius or font outside these files.
 */
export const color = {
  zinc: {
    50: '#FAFAFA',
    100: '#F4F4F5',
    200: '#E4E4E7',
    300: '#D4D4D8',
    400: '#A1A1AA',
    500: '#71717A',
    600: '#52525B',
    700: '#3F3F46',
    800: '#27272A',
    900: '#18181B',
  },
  ink: '#111111',
  black: '#000000',
  white: '#FFFFFF',
  accent: {
    900: '#FC5F2B',
    700: '#F7861E',
    500: '#FDBA74',
    300: '#FED7AA',
    100: '#FFEDD5',
    50: '#FFF6EA',
    /** Accessible accent text on light backgrounds (the 900 fails 4.5:1 for small text). */
    text: '#C2410C',
  },
  green: { 500: '#11C182', 700: '#26936B', 50: '#E9F9F3' },
  pink: { 500: '#FF68DE', 700: '#B90090', 50: '#FBF2F9' },
  yellow: { 500: '#D7DB0E', 700: '#938700' },
  glass: 'rgba(255,255,255,0.12)',
  navGlass: 'rgba(63,63,70,0.55)',
} as const;

export const status = {
  success: color.green[500],
  warning: color.accent[700],
  danger: color.pink[700],
  info: color.zinc[400],
  neutral: color.zinc[300],
} as const;
export type Status = keyof typeof status;

export const radius = { pill: '9999px', card: '20px', panel: '24px', control: '9999px' } as const;

export const font = {
  sans: "var(--font-geist-sans), 'Noto Sans Arabic', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans JP', system-ui, sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, 'SFMono-Regular', monospace",
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

/** Type scale (px / line-height). Headings are weight 300–400 with tight tracking. */
export const type = {
  display: { size: 60, lineHeight: 1.0, weight: 300, tracking: '-0.045em' },
  title: { size: 42, lineHeight: 1.1, weight: 300, tracking: '-0.04em' },
  section: { size: 18, lineHeight: 1.3, weight: 400, tracking: '-0.03em' },
  body: { size: 14, lineHeight: 1.45, weight: 400, tracking: '0' },
  caption: { size: 12, lineHeight: 1.4, weight: 400, tracking: '0' },
  label: { size: 11, lineHeight: 1.2, weight: 400, tracking: '0.06em' },
} as const;

/** Data-visualisation series: current = accent, comparisons = zinc. */
export const chart = {
  current: color.accent[900],
  comparison: [color.zinc[400], color.zinc[300]],
  categorical: [color.accent[900], color.green[500], color.pink[500], color.yellow[500]],
  strokeWidth: 1.75,
} as const;

/** Minimum interactive target size (WCAG 2.2 AA, CLAUDE.md). */
export const MIN_TARGET_PX = 24;
