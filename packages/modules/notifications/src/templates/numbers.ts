/**
 * Small counts spelled out (M3.2b alert copy, e.g. "Three check-in devices are offline"). The
 * rule, per locale: languages whose numerals don't agree with the noun from two up (en, de, fr,
 * es, it, nl, hi) spell out one to nine, capitalized for the start of a sentence; the others (ar,
 * pt, ru: gender and case agreement; ja, zh: numerals are the norm) and every number from ten up
 * use the locale's digits. Messages put the count first in spelled locales, and write their own
 * word for "one" where it agrees with the noun.
 */
const WORDS: Readonly<Record<string, readonly string[]>> = {
  en: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'],
  de: ['Ein', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun'],
  fr: ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf'],
  es: ['Un', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve'],
  it: ['Un', 'Due', 'Tre', 'Quattro', 'Cinque', 'Sei', 'Sette', 'Otto', 'Nove'],
  nl: ['Eén', 'Twee', 'Drie', 'Vier', 'Vijf', 'Zes', 'Zeven', 'Acht', 'Negen'],
  hi: ['एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ'],
};

export function countWords(n: number, locale: string): string {
  const words = WORDS[locale.split('-')[0] ?? 'en'];
  if (words && Number.isInteger(n) && n >= 1 && n <= 9) return words[n - 1] as string;
  return new Intl.NumberFormat(locale).format(n);
}
