import localFont from 'next/font/local';

/**
 * Self-hosted fonts (ADR 0022, ADR 0016): served from this app's origin, so the strict CSP
 * (`font-src 'self'`) stays intact, with size-adjusted fallbacks so text does not shift on load.
 * Manrope covers Latin and Cyrillic; Arabic and Devanagari have their own faces, loaded only when a
 * page has those characters (unicode-range). CJK uses the system's Noto Sans JP / SC / TC (or the
 * platform CJK face): self-hosting them would add megabytes per locale (ADR 0022 "Fonts").
 */
export const manrope = localFont({
  src: '../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2',
  variable: '--font-manrope',
  weight: '200 800',
  display: 'swap',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
});

export const manropeExt = localFont({
  src: '../../node_modules/@fontsource-variable/manrope/files/manrope-latin-ext-wght-normal.woff2',
  variable: '--font-manrope-ext',
  weight: '200 800',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    },
  ],
});

export const manropeCyrillic = localFont({
  src: '../../node_modules/@fontsource-variable/manrope/files/manrope-cyrillic-wght-normal.woff2',
  variable: '--font-manrope-cyrillic',
  weight: '200 800',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' }],
});

/** Every font variable, for the root <html> class (the staff console is English only). */
export const fontVariables = [manrope, manropeExt, manropeCyrillic].map((f) => f.variable).join(' ');
