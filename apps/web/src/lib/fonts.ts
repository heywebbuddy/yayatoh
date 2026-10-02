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

export const arabic = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2',
      weight: '400',
    },
    {
      path: '../../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-500-normal.woff2',
      weight: '500',
    },
    {
      path: '../../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2',
      weight: '600',
    },
    {
      path: '../../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-700-normal.woff2',
      weight: '700',
    },
  ],
  variable: '--font-arabic',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC',
    },
  ],
});

export const devanagari = localFont({
  src: '../../node_modules/@fontsource-variable/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-wght-normal.woff2',
  variable: '--font-devanagari',
  weight: '100 900',
  display: 'swap',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF',
    },
  ],
});

/** Every font variable, for the root <html> class. */
export const fontVariables = [manrope, manropeExt, manropeCyrillic, arabic, devanagari]
  .map((f) => f.variable)
  .join(' ');
