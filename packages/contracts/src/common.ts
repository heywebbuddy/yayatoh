import { z } from 'zod';

export const LOCALES = [
  'en',
  'ar',
  'de',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'nl',
  'pt',
  'ru',
  'zh-CN',
  'zh-TW',
] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);
export const DEFAULT_LOCALE: Locale = 'en';

export const Uuid = z.uuid();
export const Slug = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits and hyphens');
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
export const IanaTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'unknown IANA timezone');
export const MoneyDto = z.object({ amount: z.int(), currency: CurrencyCode });

export const ErrorDto = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
