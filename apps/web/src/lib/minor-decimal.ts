import { currencyExponent } from '@yayatoh/kernel';

/** Minor units as a plain decimal for an amount field ("600.00"; "6000" for JPY). */
export function minorToDecimal(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}
