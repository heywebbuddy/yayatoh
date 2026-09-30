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

/**
 * RFC 9457 problem details. `code` is the stable machine code (kernel ErrorCode) that clients map
 * to localized messages; `detail` is developer-facing English and never shown to end users.
 */
export const ProblemDto = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int(),
  code: z.string(),
  detail: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ProblemDto = z.infer<typeof ProblemDto>;
export const PROBLEM_TYPE_BASE = 'https://docs.yayatoh.com/problems/';

/**
 * A keyset position for cursor pagination: the sort timestamp (millisecond precision, as JS
 * dates carry it) and the row id of the last row seen. /v1 wraps it in an opaque cursor.
 */
export const KeysetAfter = z.object({ at: z.coerce.date(), id: z.uuid() });
export type KeysetAfter = z.output<typeof KeysetAfter>;
