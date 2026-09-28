import { identityDatabase } from '@yayatoh/db/identity';
import { eq, inArray } from 'drizzle-orm';
import { users } from './schema.ts';

/** Allowlisted user fields for display (names in member lists). Never returns credentials. */
export interface UserSummary {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** Preferred language for emails (M1.10d); null = not chosen (English). */
  readonly locale: string | null;
}

export async function getUsersByIds(ids: readonly string[]): Promise<Map<string, UserSummary>> {
  if (ids.length === 0) return new Map();
  const rows = await identityDatabase()
    .select({ id: users.id, name: users.name, email: users.email, locale: users.locale })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The languages a person can choose for their emails (the product's 13 locales). */
export const USER_LOCALES = [
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
export type UserLocale = (typeof USER_LOCALES)[number];

/** The signed-in person's own email language (identity data: written here, like Better Auth's own). */
export async function getUserLocale(userId: string): Promise<UserLocale | null> {
  const [row] = await identityDatabase()
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, userId));
  const l = row?.locale ?? null;
  return l && (USER_LOCALES as readonly string[]).includes(l) ? (l as UserLocale) : null;
}

/** Set (or clear, with null) a person's email language. The caller passes the session's user id. */
export async function setUserLocale(userId: string, locale: UserLocale | null): Promise<void> {
  if (locale !== null && !(USER_LOCALES as readonly string[]).includes(locale))
    throw new Error(`Unknown locale ${locale}`);
  await identityDatabase().update(users).set({ locale, updatedAt: new Date() }).where(eq(users.id, userId));
}
